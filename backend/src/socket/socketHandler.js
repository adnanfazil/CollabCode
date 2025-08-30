const jwt = require('jsonwebtoken');
const User = require('../models/User');
const Project = require('../models/Project');
const File = require('../models/File');
const logger = require('../utils/logger');
const ContainerManager = require('../runtime/ContainerManager');

// Store active connections and rooms
const activeConnections = new Map();
const projectRooms = new Map();

// Initialize container manager
const containerManager = new ContainerManager();

// Socket authentication middleware
const authenticateSocket = async (socket, next) => {
  try {
    logger.info(`🔐 WebSocket Authentication Attempt: Socket ID ${socket.id} from IP ${socket.handshake.address}`);
    
    const token = socket.handshake.auth.token || socket.handshake.headers.authorization?.replace('Bearer ', '');
    
    if (!token) {
      logger.warn(`❌ WebSocket Auth Failed: No token provided for socket ${socket.id}`);
      return next(new Error('Authentication token required'));
    }
    
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const user = await User.findById(decoded.id).select('-password');
    
    if (!user) {
      logger.warn(`❌ WebSocket Auth Failed: User not found for token from socket ${socket.id}`);
      return next(new Error('User not found'));
    }
    
    socket.user = user;
    logger.info(`✅ WebSocket Auth Success: User ${user.email} (${user.name}) authenticated for socket ${socket.id}`);
    next();
  } catch (error) {
    logger.error(`💥 WebSocket Authentication Error for socket ${socket.id}:`, error);
    next(new Error('Invalid authentication token'));
  }
};

// Initialize Socket.io handlers
const initializeSocketHandlers = (io) => {
  logger.info('Initializing Socket.io handlers...');
  
  // Apply authentication middleware
  io.use(authenticateSocket);
  
  io.on('connection', (socket) => {
    logger.info(`🔌 WebSocket Connection Established: ${socket.user.email} (Socket ID: ${socket.id})`);
    logger.info(`📊 Total active connections: ${activeConnections.size + 1}`);
    
    // Store active connection
    activeConnections.set(socket.id, {
      userId: socket.user._id.toString(),
      email: socket.user.email,
      name: socket.user.name,
      connectedAt: new Date()
    });
    
    logger.info(`👤 User ${socket.user.name} (${socket.user.email}) added to active connections`);

    // Handle ping for connection testing
    socket.on('ping', (data) => {
      logger.info(`🏓 Ping received from ${socket.user.email}:`, data);
      socket.emit('pong', { timestamp: Date.now(), received: data.timestamp });
    });

    // Handle joining a project room
    socket.on('join-project', async (data) => {
      try {
        logger.info(`🚪 Join Project Request: User ${socket.user.email} attempting to join project`, data);
        const { projectId } = data;
        
        if (!projectId) {
          logger.warn(`❌ Join Project Failed: No project ID provided by ${socket.user.email}`);
          socket.emit('error', { message: 'Project ID is required' });
          return;
        }
        
        // Verify user has access to the project
        const project = await Project.findById(projectId);
        if (!project) {
          logger.warn(`❌ Join Project Failed: Project ${projectId} not found for user ${socket.user.email}`);
          socket.emit('error', { message: 'Project not found' });
          return;
        }
        
        if (!project.canView(socket.user._id)) {
          logger.warn(`❌ Join Project Failed: User ${socket.user.email} not authorized for project ${projectId}`);
          socket.emit('error', { message: 'Not authorized to access this project' });
          return;
        }
        
        // Join the project room
        socket.join(`project:${projectId}`);
        logger.info(`🏠 Room Joined: User ${socket.user.email} joined room project:${projectId}`);
        
        // Track users in project room
        if (!projectRooms.has(projectId)) {
          projectRooms.set(projectId, new Set());
          logger.info(`🆕 New Project Room Created: project:${projectId}`);
        }
        projectRooms.get(projectId).add(socket.id);
        
        // Get current users in the project
        const usersInProject = Array.from(projectRooms.get(projectId))
          .map(socketId => activeConnections.get(socketId))
          .filter(Boolean);
        
        logger.info(`👥 Project Room Status: ${usersInProject.length} users in project ${projectId}`);
        logger.info(`👥 Users in room: ${usersInProject.map(u => u.name).join(', ')}`);
        
        // Notify others that user joined
        socket.to(`project:${projectId}`).emit('user-joined', {
          user: {
            id: socket.user._id,
            name: socket.user.name,
            email: socket.user.email
          }
        });
        logger.info(`📢 Broadcasting user-joined event for ${socket.user.email} to project ${projectId}`);
        
        // Send current users to the joining user
        socket.emit('project-joined', {
          projectId,
          users: usersInProject
        });
        logger.info(`📤 Sent project-joined confirmation to ${socket.user.email}`);
        
        logger.info(`✅ Join Project Success: User ${socket.user.email} successfully joined project ${projectId}`);
      } catch (error) {
        logger.error(`💥 Join Project Error for user ${socket.user.email}:`, error);
        socket.emit('error', { message: 'Failed to join project' });
      }
    });
    
    // Handle leaving a project room
    socket.on('leave-project', (data) => {
      try {
        const { projectId } = data;
        
        if (projectId) {
          socket.leave(`project:${projectId}`);
          
          // Remove from project room tracking
          if (projectRooms.has(projectId)) {
            projectRooms.get(projectId).delete(socket.id);
            if (projectRooms.get(projectId).size === 0) {
              projectRooms.delete(projectId);
            }
          }
          
          // Notify others that user left
          socket.to(`project:${projectId}`).emit('user-left', {
            user: {
              id: socket.user._id,
              name: socket.user.name,
              email: socket.user.email
            }
          });
          
          logger.info(`User ${socket.user.email} left project ${projectId}`);
        }
      } catch (error) {
        logger.error('Leave project error:', error);
      }
    });
    
    // Handle file editing events
    socket.on('file-edit-start', async (data) => {
      try {
        const { fileId, projectId } = data;
        
        // Verify file access
        const file = await File.findById(fileId).populate('project');
        if (!file || !file.project.canEdit(socket.user._id)) {
          socket.emit('error', { message: 'Not authorized to edit this file' });
          return;
        }
        
        // Notify others in the project that user started editing
        socket.to(`project:${projectId}`).emit('file-edit-started', {
          fileId,
          user: {
            id: socket.user._id,
            name: socket.user.name,
            email: socket.user.email
          }
        });
        
        logger.info(`User ${socket.user.email} started editing file ${fileId}`);
      } catch (error) {
        logger.error('File edit start error:', error);
        socket.emit('error', { message: 'Failed to start file editing' });
      }
    });
    
    // Handle file editing stop
    socket.on('file-edit-stop', (data) => {
      try {
        const { fileId, projectId } = data;
        
        // Notify others that user stopped editing
        socket.to(`project:${projectId}`).emit('file-edit-stopped', {
          fileId,
          user: {
            id: socket.user._id,
            name: socket.user.name,
            email: socket.user.email
          }
        });
        
        logger.info(`User ${socket.user.email} stopped editing file ${fileId}`);
      } catch (error) {
        logger.error('File edit stop error:', error);
      }
    });
    
    // Handle real-time code changes
    socket.on('code-change', async (data) => {
      try {
        const { fileId, projectId, changes, version } = data;
        logger.info(`📝 Code Change Event: User ${socket.user.email} editing file ${fileId} in project ${projectId}, version ${version}`);
        
        // Log detailed change information
        if (changes && changes.length > 0) {
          changes.forEach((change, index) => {
            logger.info(`📝 Change ${index + 1}:`, {
              text: change.text ? `"${change.text.substring(0, 500)}${change.text.length > 500 ? '...' : ''}"` : 'null',
              textLength: change.text ? change.text.length : 0,
              range: change.range || 'full file'
            });
          });
        }
        
        // Verify file access
        const file = await File.findById(fileId).populate('project');
        if (!file || !file.project.canEdit(socket.user._id)) {
          logger.warn(`❌ Code Change Denied: User ${socket.user.email} not authorized to edit file ${fileId}`);
          socket.emit('error', { message: 'Not authorized to edit this file' });
          return;
        }
        
        // Log current file content for comparison
        logger.info(`📄 Current file content (${file.name}):`, {
          contentLength: file.content ? file.content.length : 0,
          contentPreview: file.content ? `"${file.content.substring(0, 200)}${file.content.length > 200 ? '...' : ''}"` : 'empty'
        });
        
        // Count users in project room for broadcasting info
        const roomSize = projectRooms.get(projectId)?.size || 0;
        logger.info(`📡 Broadcasting code changes to ${roomSize - 1} other users in project ${projectId}`);
        
        // Broadcast changes to other users in the project
        socket.to(`project:${projectId}`).emit('code-changed', {
          fileId,
          changes,
          version,
          user: {
            id: socket.user._id,
            name: socket.user.name,
            email: socket.user.email
          }
        });
        
        // Optional: Save changes to database (for auto-save)
        if (file.project.settings?.autoSave) {
          logger.info(`💾 Auto-save enabled: Updating file content for ${fileId}`);
          
          // Update file content with the new changes
          if (changes && changes.length > 0 && changes[0].text !== undefined) {
            const newContent = changes[0].text;
            logger.info(`💾 Updating file content from ${file.content?.length || 0} to ${newContent.length} characters`);
            
            file.content = newContent;
            file.metadata.lastEditedBy = socket.user._id;
            file.metadata.lastEditedAt = new Date();
            await file.save();
            
            logger.info(`💾 Auto-save completed for file ${fileId} - New content: "${newContent.substring(0, 200)}${newContent.length > 200 ? '...' : ''}"}`);
          }
        }
        
        logger.info(`✅ Code Change Success: Changes broadcasted for file ${fileId}`);
      } catch (error) {
        logger.error(`💥 Code Change Error for user ${socket.user.email}:`, error);
        socket.emit('error', { message: 'Failed to process code changes' });
      }
    });
    
    // Handle cursor position updates
    socket.on('cursor-position', (data) => {
      try {
        const { fileId, projectId, position } = data;
        logger.debug(`🖱️ Cursor Update: User ${socket.user.email} moved cursor in file ${fileId} to position ${JSON.stringify(position)}`);
        
        // Count users in project room for broadcasting info
        const roomSize = projectRooms.get(projectId)?.size || 0;
        
        // Broadcast cursor position to other users
        socket.to(`project:${projectId}`).emit('cursor-updated', {
          fileId,
          position,
          user: {
            id: socket.user._id,
            name: socket.user.name,
            email: socket.user.email
          }
        });
        
        logger.debug(`🖱️ Cursor position broadcasted to ${roomSize - 1} users in project ${projectId}`);
      } catch (error) {
        logger.error(`💥 Cursor Position Error for user ${socket.user.email}:`, error);
      }
    });
    
    // Handle file selection
    socket.on('file-select', (data) => {
      try {
        const { fileId, projectId } = data;
        
        // Notify others about file selection
        socket.to(`project:${projectId}`).emit('file-selected', {
          fileId,
          user: {
            id: socket.user._id,
            name: socket.user.name,
            email: socket.user.email
          }
        });
      } catch (error) {
        logger.error('File select error:', error);
      }
    });
    
    // Handle chat messages
    socket.on('chat-message', async (data) => {
      try {
        const { projectId, message } = data;
        logger.info(`💬 Chat Message Request: User ${socket.user.email} sending message to project ${projectId}`);
        logger.debug(`💬 Message content: "${message?.substring(0, 100)}${message?.length > 100 ? '...' : ''}"`);        
        if (!message || message.trim().length === 0) {
          logger.warn(`❌ Chat Message Failed: Empty message from ${socket.user.email}`);
          socket.emit('error', { message: 'Message cannot be empty' });
          return;
        }
        
        // Verify project access
        const project = await Project.findById(projectId);
        if (!project || !project.canView(socket.user._id)) {
          logger.warn(`❌ Chat Message Failed: User ${socket.user.email} not authorized for project ${projectId}`);
          socket.emit('error', { message: 'Not authorized to send messages in this project' });
          return;
        }
        
        const chatMessage = {
          id: Date.now().toString(),
          message: message.trim(),
          user: {
            id: socket.user._id,
            name: socket.user.name,
            email: socket.user.email
          },
          timestamp: new Date()
        };
        
        // Count users in project room for broadcasting info
        const roomSize = projectRooms.get(projectId)?.size || 0;
        logger.info(`💬 Broadcasting chat message to ${roomSize} users in project ${projectId}`);
        
        // Broadcast message to all users in the project
        io.to(`project:${projectId}`).emit('chat-message', chatMessage);
        
        logger.info(`✅ Chat Message Success: Message from ${socket.user.email} broadcasted to project ${projectId}`);
      } catch (error) {
        logger.error(`💥 Chat Message Error for user ${socket.user.email}:`, error);
        socket.emit('error', { message: 'Failed to send message' });
      }
    });
    
    // Handle typing indicators
    // ---- Chat typing indicators ----
    socket.on('chat-typing-start', (data) => {
      try {
        const { projectId } = data;
        socket.to(`project:${projectId}`).emit('user-chat-typing', {
          user: {
            id: socket.user._id,
            name: socket.user.name,
            email: socket.user.email
          }
        });
      } catch (error) {
        logger.error(`💥 Chat Typing Start Error for user ${socket.user.email}:`, error);
      }
    });

    socket.on('chat-typing-stop', (data) => {
      try {
        const { projectId } = data;
        socket.to(`project:${projectId}`).emit('user-stopped-chat-typing', {
          user: {
            id: socket.user._id,
            name: socket.user.name,
            email: socket.user.email
          }
        });
      } catch (error) {
        logger.error(`💥 Chat Typing Stop Error for user ${socket.user.email}:`, error);
      }
    });

    // ---- Code typing indicators ----
    socket.on('code-typing-start', (data) => {
      try {
        const { projectId, fileId } = data;
        socket.to(`project:${projectId}`).emit('user-code-typing', {
          fileId,
          user: {
            id: socket.user._id,
            name: socket.user.name,
            email: socket.user.email
          }
        });
      } catch (error) {
        logger.error(`💥 Code Typing Start Error for user ${socket.user.email}:`, error);
      }
    });

    socket.on('code-typing-stop', (data) => {
      try {
        const { projectId, fileId } = data;
        socket.to(`project:${projectId}`).emit('user-stopped-code-typing', {
          fileId,
          user: {
            id: socket.user._id,
            name: socket.user.name,
            email: socket.user.email
          }
        });
      } catch (error) {
        logger.error(`💥 Code Typing Stop Error for user ${socket.user.email}:`, error);
      }
    });

    // Legacy typing indicators
    socket.on('typing-start', (data) => {
      try {
        const { projectId } = data;
        logger.debug(`⌨️ Typing Start: User ${socket.user.email} started typing in project ${projectId}`);
        
        const roomSize = projectRooms.get(projectId)?.size || 0;
        
        socket.to(`project:${projectId}`).emit('user-typing', {
          user: {
            id: socket.user._id,
            name: socket.user.name,
            email: socket.user.email
          }
        });
        
        logger.debug(`⌨️ Typing indicator sent to ${roomSize - 1} users in project ${projectId}`);
      } catch (error) {
        logger.error(`💥 Typing Start Error for user ${socket.user.email}:`, error);
      }
    });
    
    socket.on('typing-stop', (data) => {
      try {
        const { projectId } = data;
        logger.debug(`⌨️ Typing Stop: User ${socket.user.email} stopped typing in project ${projectId}`);
        
        const roomSize = projectRooms.get(projectId)?.size || 0;
        
        socket.to(`project:${projectId}`).emit('user-stopped-typing', {
          user: {
            id: socket.user._id,
            name: socket.user.name,
            email: socket.user.email
          }
        });
        
        logger.debug(`⌨️ Typing stop indicator sent to ${roomSize - 1} users in project ${projectId}`);
      } catch (error) {
        logger.error(`💥 Typing Stop Error for user ${socket.user.email}:`, error);
      }
    });
    
    // Handle disconnection
    socket.on('disconnect', (reason) => {
      logger.info(`🔌 WebSocket Disconnection: User ${socket.user.email} (Socket ID: ${socket.id}) - Reason: ${reason}`);
      
      // Remove from active connections
      activeConnections.delete(socket.id);
      logger.info(`👤 User ${socket.user.email} removed from active connections`);
      logger.info(`📊 Remaining active connections: ${activeConnections.size}`);
      
      let projectsLeft = 0;
      // Remove from all project rooms and notify others
      for (const [projectId, socketIds] of projectRooms.entries()) {
        if (socketIds.has(socket.id)) {
          socketIds.delete(socket.id);
          projectsLeft++;
          
          logger.info(`🚪 User ${socket.user.email} left project room ${projectId}`);
          logger.info(`👥 Remaining users in project ${projectId}: ${socketIds.size}`);
          
          // Notify others that user left
          socket.to(`project:${projectId}`).emit('user-left', {
            user: {
              id: socket.user._id,
              name: socket.user.name,
              email: socket.user.email
            }
          });
          
          // Clean up empty project rooms
          if (socketIds.size === 0) {
            projectRooms.delete(projectId);
            logger.info(`🗑️ Empty project room ${projectId} cleaned up`);
          }
        }
      }
      
      logger.info(`✅ Disconnect Cleanup Complete: User ${socket.user.email} left ${projectsLeft} project(s)`);
      logger.info(`📊 Total active project rooms: ${projectRooms.size}`);
    });
    
    // Initialize terminal command handlers
    handleTerminalCommands(socket, io);
    
    // Handle errors
    socket.on('error', (error) => {
      logger.error(`💥 Socket Error for user ${socket.user.email} (${socket.id}):`, error);
    });
  });
  
  // Handle server errors
  io.on('error', (error) => {
    logger.error('💥 Socket.io Server Error:', error);
  });
  
  logger.info('✅ Socket.io handlers successfully initialized and ready for connections');
  logger.info('🔧 WebSocket logging enhanced with detailed event tracking');
  logger.info('📡 Real-time collaboration features are now fully monitored');
};

// Get statistics about active connections
const getConnectionStats = () => {
  return {
    totalConnections: activeConnections.size,
    activeProjects: projectRooms.size,
    connections: Array.from(activeConnections.values()),
    projectRooms: Object.fromEntries(
      Array.from(projectRooms.entries()).map(([projectId, socketIds]) => [
        projectId,
        Array.from(socketIds).map(socketId => activeConnections.get(socketId)).filter(Boolean)
      ])
    )
  };
};

// Broadcast message to all users in a project
const broadcastToProject = (io, projectId, event, data) => {
  io.to(`project:${projectId}`).emit(event, data);
};

// Broadcast message to specific user
const broadcastToUser = (io, userId, event, data) => {
  const userSockets = Array.from(activeConnections.entries())
    .filter(([_, connection]) => connection.userId === userId.toString())
    .map(([socketId]) => socketId);
  
  userSockets.forEach(socketId => {
    io.to(socketId).emit(event, data);
  });
};

// Terminal command execution handlers
const handleTerminalCommands = (socket, io) => {
  // Track terminal creation requests to prevent duplicates
  let terminalCreationInProgress = false;
  
  // Handle terminal session creation
  socket.on('terminal-create', async (data) => {
    try {
      const { projectId } = data;
      logger.info(`🖥️ Terminal Create: User ${socket.user.email} creating session for project ${projectId}`);
      
      // Prevent duplicate creation requests
      if (terminalCreationInProgress) {
        logger.warn(`⚠️ Terminal creation already in progress for socket ${socket.id}, ignoring duplicate request`);
        return;
      }
      
      terminalCreationInProgress = true;
      
      // Verify project access
      const project = await Project.findById(projectId);
      if (!project || !project.canEdit(socket.user._id)) {
        logger.warn(`❌ Terminal Access Denied: User ${socket.user.email} not authorized for project ${projectId}`);
        socket.emit('terminal-error', { error: 'Not authorized to access terminal for this project' });
        terminalCreationInProgress = false;
        return;
      }
      
      // Create container session
      const result = await containerManager.createSession(
        socket.id,
        projectId,
        // onOutput callback
        (output) => {
          socket.emit('terminal-output', { output, type: 'stdout' });
        },
        // onError callback
        (error) => {
          socket.emit('terminal-output', { output: error, type: 'stderr' });
        },
        // onPreview callback
        (previewData) => {
          socket.emit('terminal-preview', previewData);
          logger.info(`🌐 Preview URL available: ${previewData.previewUrl}`);
        }
      );
      
      if (result.success) {
        socket.emit('terminal-ready', { 
          containerId: result.containerId,
          port: result.port,
          sessionType: result.sessionType || 'container'
        });
        logger.info(`✅ Terminal session created for ${socket.user.email} in project ${projectId} (${result.sessionType || 'container'})`);
      } else {
        socket.emit('terminal-error', { error: result.error });
      }
      
    } catch (error) {
      logger.error(`💥 Terminal Create Error:`, error);
      socket.emit('terminal-error', { error: 'Failed to create terminal session' });
    } finally {
      terminalCreationInProgress = false;
    }
  });
  
  // Handle terminal command execution
  socket.on('terminal-command', async (data) => {
    try {
      const { command } = data;
      logger.debug(`🖥️ Terminal Command: ${command.trim()}`);
      
      const success = containerManager.execCommand(socket.id, command);
      if (!success) {
        socket.emit('terminal-error', { error: 'No active terminal session' });
      }
      
    } catch (error) {
      logger.error(`💥 Terminal Command Error:`, error);
      socket.emit('terminal-error', { error: 'Failed to execute command' });
    }
  });
  
  // Handle terminal interrupt (Ctrl+C)
  socket.on('terminal-interrupt', (data) => {
    try {
      logger.info(`🛑 Terminal Interrupt: User ${socket.user.email}`);
      
      const success = containerManager.interrupt(socket.id);
      if (!success) {
        socket.emit('terminal-error', { error: 'No active terminal session to interrupt' });
      }
    } catch (error) {
      logger.error(`💥 Terminal Interrupt Error:`, error);
    }
  });
  
  // Handle terminal session stop
  socket.on('terminal-stop', async (data) => {
    try {
      logger.info(`🛑 Terminal Stop: User ${socket.user.email}`);
      
      const success = await containerManager.stopSession(socket.id);
      if (success) {
        socket.emit('terminal-stopped');
      } else {
        socket.emit('terminal-error', { error: 'Failed to stop terminal session' });
      }
    } catch (error) {
      logger.error(`💥 Terminal Stop Error:`, error);
    }
  });
  
  // Clean up container sessions when socket disconnects
  socket.on('disconnect', async () => {
    try {
      // Stop container session for this socket
      await containerManager.stopSession(socket.id);
      logger.info(`🧹 Cleanup: Stopped container session for socket ${socket.id}`);
    } catch (error) {
      logger.error(`💥 Cleanup Error:`, error);
    }
  });
};

// Graceful shutdown handler
const gracefulShutdown = async () => {
  logger.info('🛑 Graceful shutdown: Cleaning up container sessions...');
  await containerManager.cleanup();
  logger.info('✅ Container cleanup completed');
};

module.exports = {
  initializeSocketHandlers,
  getConnectionStats,
  broadcastToProject,
  broadcastToUser,
  gracefulShutdown
};