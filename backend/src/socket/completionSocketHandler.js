const streamingCompletionService = require('../services/streamingCompletionService');
const logger = require('../utils/logger');
const { protect } = require('../middleware/auth');
const jwt = require('jsonwebtoken');
const User = require('../models/User');

// Store active completion sessions
const activeCompletionSessions = new Map();

/**
 * Initialize completion WebSocket handlers
 * @param {Server} io - Socket.io server instance
 */
const initializeCompletionHandlers = (io) => {
  logger.info('Initializing streaming completion WebSocket handlers...');

  // Create a separate namespace for completions
  const completionNamespace = io.of('/completions');

  // Authentication middleware for completion namespace
  completionNamespace.use(async (socket, next) => {
    try {
      const token = socket.handshake.auth.token || 
                   socket.handshake.headers.authorization?.replace('Bearer ', '');
      
      if (!token) {
        logger.warn(`Completion WebSocket: No token provided for socket ${socket.id}`);
        return next(new Error('Authentication token required'));
      }
      
      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      const user = await User.findById(decoded.id).select('-password');
      
      if (!user) {
        logger.warn(`Completion WebSocket: User not found for socket ${socket.id}`);
        return next(new Error('User not found'));
      }
      
      socket.user = user;
      logger.info(`Completion WebSocket: User ${user.email} authenticated for socket ${socket.id}`);
      next();
    } catch (error) {
      logger.error(`Completion WebSocket authentication error for socket ${socket.id}:`, error);
      next(new Error('Invalid authentication token'));
    }
  });

  completionNamespace.on('connection', (socket) => {
    logger.info(`🤖 Completion WebSocket connected: ${socket.user.email} (Socket ID: ${socket.id})`);

    // Handle completion requests
    socket.on('request-completion', async (data) => {
      try {
        logger.info(`Completion request from ${socket.user.email}:`, {
          language: data.language,
          promptLength: data.prompt?.length || 0,
          filename: data.filename
        });

        const { prompt, language = 'javascript', filename = '', projectId } = data;

        // Validate request
        const validation = streamingCompletionService.validateRequest(prompt, language);
        if (!validation.isValid) {
          socket.emit('completion-error', {
            error: 'Validation failed',
            details: validation.errors
          });
          return;
        }

        // Cancel any existing completion for this socket
        if (activeCompletionSessions.has(socket.id)) {
          activeCompletionSessions.get(socket.id).cancelled = true;
        }

        // Create new completion session
        const session = {
          socketId: socket.id,
          userId: socket.user._id.toString(),
          startTime: Date.now(),
          cancelled: false,
          projectId,
          language,
          filename
        };

        activeCompletionSessions.set(socket.id, session);

        // Start streaming completion
        const completionGenerator = streamingCompletionService.generateCompletion(
          prompt, 
          language, 
          filename
        );

        let tokenCount = 0;
        let completionText = '';

        for await (const chunk of completionGenerator) {
          logger.info(`📥 SOCKET RECEIVED CHUNK: ${JSON.stringify(chunk)}`);
          // Check if session was cancelled
          if (session.cancelled) {
            logger.info(`Completion cancelled for socket ${socket.id}`);
            break;
          }

          // Check if socket is still connected
          if (!socket.connected) {
            logger.info(`Socket disconnected during completion: ${socket.id}`);
            break;
          }

          tokenCount++;
          completionText = chunk.completionText || '';

          const emitPayload = {
            token: chunk.token || '',
            completionText: chunk.completionText || '',
            done: chunk.done,
            error: chunk.error,
            sessionId: socket.id,
            tokenCount
          };

          logger.info(`📤 SOCKET EMITTING completion-token: ${JSON.stringify(emitPayload)}`);
          // Send token to client
          socket.emit('completion-token', emitPayload);

          // If completion is done or has error, break
          if (chunk.done || chunk.error) {
            logger.info(`🏁 Completion terminating: done=${chunk.done} error=${chunk.error}`);
            break;
          }
        }

        // Clean up session
        activeCompletionSessions.delete(socket.id);

        logger.info(`Completion finished for ${socket.user.email}: ${tokenCount} tokens, ${completionText.length} characters`);

      } catch (error) {
        logger.error(`Error handling completion request for socket ${socket.id}:`, error);
        
        socket.emit('completion-error', {
          error: 'Internal server error',
          message: error.message
        });

        // Clean up session on error
        activeCompletionSessions.delete(socket.id);
      }
    });

    // Handle completion cancellation
    socket.on('cancel-completion', () => {
      logger.info(`Completion cancellation requested by ${socket.user.email}`);
      
      if (activeCompletionSessions.has(socket.id)) {
        activeCompletionSessions.get(socket.id).cancelled = true;
        activeCompletionSessions.delete(socket.id);
        
        socket.emit('completion-cancelled', {
          message: 'Completion cancelled successfully'
        });
      }
    });

    // Handle ping for connection testing
    socket.on('ping', (data) => {
      socket.emit('pong', { 
        timestamp: Date.now(), 
        received: data.timestamp,
        type: 'completion'
      });
    });

    // Handle disconnection
    socket.on('disconnect', (reason) => {
      logger.info(`🤖 Completion WebSocket disconnected: ${socket.user.email} (${reason})`);
      
      // Cancel any active completion
      if (activeCompletionSessions.has(socket.id)) {
        activeCompletionSessions.get(socket.id).cancelled = true;
        activeCompletionSessions.delete(socket.id);
      }
    });

    // Handle errors
    socket.on('error', (error) => {
      logger.error(`Completion WebSocket error for ${socket.user.email}:`, error);
      
      // Clean up session on error
      if (activeCompletionSessions.has(socket.id)) {
        activeCompletionSessions.delete(socket.id);
      }
    });
  });

  return completionNamespace;
};

/**
 * Get completion statistics
 * @returns {Object} - Completion stats
 */
const getCompletionStats = () => {
  const activeSessions = Array.from(activeCompletionSessions.values());
  
  return {
    activeSessions: activeSessions.length,
    totalConnections: activeSessions.length,
    sessionsByLanguage: activeSessions.reduce((acc, session) => {
      acc[session.language] = (acc[session.language] || 0) + 1;
      return acc;
    }, {}),
    averageSessionDuration: activeSessions.length > 0 
      ? activeSessions.reduce((sum, session) => sum + (Date.now() - session.startTime), 0) / activeSessions.length
      : 0
  };
};

/**
 * Broadcast completion stats to admin users
 * @param {Server} io - Socket.io server instance
 */
const broadcastCompletionStats = (io) => {
  const stats = getCompletionStats();
  io.emit('completion-stats', stats);
};

/**
 * Graceful shutdown for completion handlers
 */
const gracefulCompletionShutdown = async () => {
  logger.info('Shutting down completion WebSocket handlers...');
  
  // Cancel all active sessions
  for (const session of activeCompletionSessions.values()) {
    session.cancelled = true;
  }
  
  activeCompletionSessions.clear();
  logger.info('Completion handlers shutdown complete');
};

module.exports = {
  initializeCompletionHandlers,
  getCompletionStats,
  broadcastCompletionStats,
  gracefulCompletionShutdown
};