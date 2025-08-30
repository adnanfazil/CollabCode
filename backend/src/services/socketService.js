const logger = require('../utils/logger');

class SocketService {
  constructor() {
    this.io = null;
  }

  setIO(io) {
    this.io = io;
    logger.info('Socket.io instance set in SocketService');
  }

  getIO() {
    return this.io;
  }

  broadcastFileChange(projectId, fileId, changes, user) {
    if (!this.io) {
      logger.warn('Socket.io not available for broadcasting file changes');
      return;
    }

    const data = {
      fileId: fileId.toString(),
      changes,
      version: Date.now(),
      user: {
        id: user._id || user.id,
        name: user.name,
        email: user.email
      }
    };

    logger.info(`📡 Broadcasting file update via WebSocket: file ${fileId} in project ${projectId}`);
    
    // Broadcast to all users in the project room
    this.io.to(`project:${projectId}`).emit('code-changed', data);
  }

  broadcastFileCreated(projectId, file, user) {
    if (!this.io) {
      logger.warn('Socket.io not available for broadcasting file creation');
      return;
    }

    logger.info(`📡 Broadcasting file creation via WebSocket: ${file.name} in project ${projectId}`);
    
    this.io.to(`project:${projectId}`).emit('file-created', {
      file,
      user: {
        id: user._id || user.id,
        name: user.name,
        email: user.email
      }
    });
  }

  broadcastFileDeleted(projectId, fileId, user) {
    if (!this.io) {
      logger.warn('Socket.io not available for broadcasting file deletion');
      return;
    }

    logger.info(`📡 Broadcasting file deletion via WebSocket: file ${fileId} in project ${projectId}`);
    
    this.io.to(`project:${projectId}`).emit('file-deleted', {
      fileId: fileId.toString(),
      user: {
        id: user._id || user.id,
        name: user.name,
        email: user.email
      }
    });
  }
}

// Create singleton instance
const socketService = new SocketService();

module.exports = socketService;
