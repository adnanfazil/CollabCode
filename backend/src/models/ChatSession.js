const mongoose = require('mongoose');

const messageSchema = new mongoose.Schema({
  role: {
    type: String,
    enum: ['user', 'assistant'],
    required: true
  },
  content: {
    type: String,
    required: true
  },
  timestamp: {
    type: Date,
    default: Date.now
  },
  metadata: {
    type: mongoose.Schema.Types.Mixed,
    default: {}
  }
});

const chatSessionSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  projectId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Project',
    required: false
  },
  sessionId: {
    type: String,
    required: true,
    unique: true
  },
  title: {
    type: String,
    default: 'New Chat Session'
  },
  messages: [messageSchema],
  context: {
    projectType: String,
    language: String,
    recentCommands: [String],
    errorDetails: String,
    stackTrace: String,
    dependencies: [String],
    lastActivity: {
      type: Date,
      default: Date.now
    }
  },
  status: {
    type: String,
    enum: ['active', 'archived', 'deleted'],
    default: 'active'
  },
  feedback: {
    rating: {
      type: Number,
      min: 1,
      max: 5
    },
    comment: String,
    helpful: Boolean
  },
  createdAt: {
    type: Date,
    default: Date.now
  },
  updatedAt: {
    type: Date,
    default: Date.now
  }
});

// Update the updatedAt field before saving
chatSessionSchema.pre('save', function(next) {
  this.updatedAt = Date.now();
  next();
});

// Index for efficient queries
chatSessionSchema.index({ userId: 1, createdAt: -1 });
chatSessionSchema.index({ projectId: 1 });

// Instance methods
chatSessionSchema.methods.addMessage = function(role, content, metadata = {}) {
  this.messages.push({
    role,
    content,
    metadata,
    timestamp: new Date()
  });
  
  // Update session title based on first user message
  if (role === 'user' && this.messages.length === 1) {
    this.title = content.substring(0, 50) + (content.length > 50 ? '...' : '');
  }
  
  this.context.lastActivity = new Date();
  return this.save();
};

chatSessionSchema.methods.updateContext = function(contextData) {
  this.context = { ...this.context, ...contextData };
  return this.save();
};

chatSessionSchema.methods.addFeedback = function(rating, comment, helpful) {
  this.feedback = {
    rating,
    comment,
    helpful
  };
  return this.save();
};

chatSessionSchema.methods.getRecentMessages = function(limit = 10) {
  return this.messages.slice(-limit);
};

chatSessionSchema.methods.getConversationHistory = function(includeMetadata = false) {
  return this.messages.map(msg => ({
    role: msg.role,
    content: msg.content,
    timestamp: msg.timestamp,
    ...(includeMetadata && { metadata: msg.metadata })
  }));
};

// Static methods
chatSessionSchema.statics.createSession = async function(userId, projectId = null) {
  const sessionId = `chat_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  
  const session = new this({
    userId,
    projectId,
    sessionId,
    messages: [],
    context: {
      lastActivity: new Date()
    }
  });
  
  return await session.save();
};

chatSessionSchema.statics.findBySessionId = function(sessionId) {
  return this.findOne({ sessionId, status: 'active' });
};

chatSessionSchema.statics.findUserSessions = function(userId, limit = 20) {
  return this.find({ 
    userId, 
    status: 'active' 
  })
  .sort({ updatedAt: -1 })
  .limit(limit)
  .select('sessionId title createdAt updatedAt context.lastActivity messages');
};

chatSessionSchema.statics.findProjectSessions = function(projectId, limit = 10) {
  return this.find({ 
    projectId, 
    status: 'active' 
  })
  .sort({ updatedAt: -1 })
  .limit(limit)
  .populate('userId', 'username email')
  .select('sessionId title createdAt updatedAt context.lastActivity');
};

chatSessionSchema.statics.archiveOldSessions = async function(daysOld = 30) {
  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - daysOld);
  
  return await this.updateMany(
    { 
      'context.lastActivity': { $lt: cutoffDate },
      status: 'active'
    },
    { 
      status: 'archived' 
    }
  );
};

chatSessionSchema.statics.getSessionStats = async function(userId) {
  const stats = await this.aggregate([
    { $match: { userId: mongoose.Types.ObjectId(userId) } },
    {
      $group: {
        _id: '$status',
        count: { $sum: 1 },
        totalMessages: { $sum: { $size: '$messages' } }
      }
    }
  ]);
  
  const result = {
    active: 0,
    archived: 0,
    deleted: 0,
    totalMessages: 0
  };
  
  stats.forEach(stat => {
    result[stat._id] = stat.count;
    result.totalMessages += stat.totalMessages;
  });
  
  return result;
};

// Virtual for message count
chatSessionSchema.virtual('messageCount').get(function() {
  return this.messages.length;
});

// Virtual for last message
chatSessionSchema.virtual('lastMessage').get(function() {
  return this.messages.length > 0 ? this.messages[this.messages.length - 1] : null;
});

// Ensure virtuals are included in JSON output
chatSessionSchema.set('toJSON', { virtuals: true });
chatSessionSchema.set('toObject', { virtuals: true });

const ChatSession = mongoose.model('ChatSession', chatSessionSchema);

module.exports = ChatSession;