const mongoose = require('mongoose');

const projectSchema = new mongoose.Schema({
  name: {
    type: String,
    required: [true, 'Please provide a project name'],
    trim: true,
    maxlength: [100, 'Project name cannot be more than 100 characters']
  },
  description: {
    type: String,
    trim: true,
    maxlength: [500, 'Description cannot be more than 500 characters']
  },
  owner: {
    type: mongoose.Schema.ObjectId,
    ref: 'User',
    required: [true, 'Project must have an owner']
  },
  collaborators: [{
    user: {
      type: mongoose.Schema.ObjectId,
      ref: 'User',
      required: true
    },
    role: {
      type: String,
      enum: ['viewer', 'editor', 'admin'],
      default: 'editor'
    },
    addedAt: {
      type: Date,
      default: Date.now
    },
    addedBy: {
      type: mongoose.Schema.ObjectId,
      ref: 'User'
    }
  }],
  isPublic: {
    type: Boolean,
    default: false
  },
  programmingLanguage: {
    type: String,
    default: 'js',
    enum: [
      'js', 'jsx', 'typescript', 'python', 'java', 'cpp', 'c',
      'csharp', 'php', 'ruby', 'go', 'rust', 'swift', 'kotlin',
      'html', 'css', 'scss', 'json', 'xml', 'yaml', 'markdown',
      'sql', 'shell', 'dockerfile', 'other'
    ]
  },
  template: {
    type: String,
    enum: ['blank', 'react', 'vue', 'angular', 'node', 'python', 'java', 'other'],
    default: 'blank'
  },
  settings: {
    autoSave: {
      type: Boolean,
      default: true
    },
    autoSaveInterval: {
      type: Number,
      default: 30000, // 30 seconds
      min: 5000,
      max: 300000
    },
    theme: {
      type: String,
      enum: ['light', 'dark', 'auto'],
      default: 'auto'
    },
    fontSize: {
      type: Number,
      default: 14,
      min: 10,
      max: 24
    },
    tabSize: {
      type: Number,
      default: 2,
      min: 1,
      max: 8
    },
    wordWrap: {
      type: Boolean,
      default: true
    },
    lineNumbers: {
      type: Boolean,
      default: true
    },
    minimap: {
      type: Boolean,
      default: true
    }
  },
  stats: {
    totalFiles: {
      type: Number,
      default: 0
    },
    totalLines: {
      type: Number,
      default: 0
    },
    lastActivity: {
      type: Date,
      default: Date.now
    },
    collaborationSessions: {
      type: Number,
      default: 0
    }
  },
  tags: [{
    type: String,
    trim: true,
    maxlength: 30
  }],
  isArchived: {
    type: Boolean,
    default: false
  },
  archivedAt: {
    type: Date
  }
}, {
  timestamps: true,
  toJSON: { virtuals: true },
  toObject: { virtuals: true },
  // Removed languageOverride setting to prevent MongoDB conflicts
});

// Indexes
projectSchema.index({ owner: 1, createdAt: -1 });
projectSchema.index({ 'collaborators.user': 1 });
projectSchema.index({ isPublic: 1, createdAt: -1 });
projectSchema.index({ tags: 1 });
// Removed projectLanguage index to prevent MongoDB language override conflicts
// projectSchema.index({ projectLanguage: 1 });
projectSchema.index({ 'stats.lastActivity': -1 });

// Virtual for project files
projectSchema.virtual('files', {
  ref: 'File',
  localField: '_id',
  foreignField: 'project'
});

// Virtual for file count
projectSchema.virtual('fileCount', {
  ref: 'File',
  localField: '_id',
  foreignField: 'project',
  count: true
});

// Pre-save middleware
projectSchema.pre('save', function(next) {
  if (this.isModified('isArchived') && this.isArchived) {
    this.archivedAt = new Date();
  } else if (this.isModified('isArchived') && !this.isArchived) {
    this.archivedAt = undefined;
  }
  next();
});

// Instance method to check if user is collaborator
projectSchema.methods.isCollaborator = function(userId) {
  return this.collaborators.some(collab => 
    collab.user.toString() === userId.toString()
  );
};

// Instance method to check if user is owner
projectSchema.methods.isOwner = function(userId) {
  return this.owner.toString() === userId.toString();
};

// Instance method to check user permissions
projectSchema.methods.getUserRole = function(userId) {
  if (this.isOwner(userId)) return 'owner';
  
  const collaborator = this.collaborators.find(collab => 
    collab.user.toString() === userId.toString()
  );
  
  return collaborator ? collaborator.role : null;
};

// Instance method to check if user can edit
projectSchema.methods.canEdit = function(userId) {
  const role = this.getUserRole(userId);
  return ['owner', 'admin', 'editor'].includes(role);
};

// Instance method to check if user can view
projectSchema.methods.canView = function(userId) {
  if (this.isPublic) return true;
  const role = this.getUserRole(userId);
  return role !== null;
};

// Instance method to add collaborator
projectSchema.methods.addCollaborator = function(userId, role = 'editor', addedBy) {
  // Check if user is already a collaborator
  if (this.isCollaborator(userId) || this.isOwner(userId)) {
    throw new Error('User is already a collaborator or owner');
  }
  
  this.collaborators.push({
    user: userId,
    role: role,
    addedBy: addedBy
  });
  
  return this.save();
};

// Instance method to remove collaborator
projectSchema.methods.removeCollaborator = function(userId) {
  this.collaborators = this.collaborators.filter(collab => 
    collab.user.toString() !== userId.toString()
  );
  
  return this.save();
};

// Instance method to update collaborator role
projectSchema.methods.updateCollaboratorRole = function(userId, newRole) {
  const collaborator = this.collaborators.find(collab => 
    collab.user.toString() === userId.toString()
  );
  
  if (!collaborator) {
    throw new Error('User is not a collaborator');
  }
  
  collaborator.role = newRole;
  return this.save();
};

// Instance method to update activity
projectSchema.methods.updateActivity = function() {
  this.stats.lastActivity = new Date();
  return this.save({ validateBeforeSave: false });
};

// Static method to find user projects
projectSchema.statics.findUserProjects = function(userId, options = {}) {
  const query = {
    $or: [
      { owner: userId },
      { 'collaborators.user': userId }
    ]
  };
  
  if (options.includeArchived !== true) {
    query.isArchived = { $ne: true };
  }
  
  return this.find(query)
    .populate('owner', 'name email avatar')
    .populate('collaborators.user', 'name email avatar')
    .sort({ 'stats.lastActivity': -1 });
};

// Static method to find public projects
projectSchema.statics.findPublicProjects = function(options = {}) {
  const query = { 
    isPublic: true,
    isArchived: { $ne: true }
  };
  
  let mongoQuery = this.find(query)
    .populate('owner', 'name email avatar')
    .sort({ 'stats.lastActivity': -1 });
    
  if (options.limit) {
    mongoQuery = mongoQuery.limit(options.limit);
  }
  
  return mongoQuery;
};

// Static method to get project stats
projectSchema.statics.getProjectStats = async function() {
  const stats = await this.aggregate([
    {
      $group: {
        _id: null,
        totalProjects: { $sum: 1 },
        publicProjects: {
          $sum: {
            $cond: [{ $eq: ['$isPublic', true] }, 1, 0]
          }
        },
        archivedProjects: {
          $sum: {
            $cond: [{ $eq: ['$isArchived', true] }, 1, 0]
          }
        },
        totalCollaborators: { $sum: { $size: '$collaborators' } }
      }
    }
  ]);
  
  return stats[0] || { 
    totalProjects: 0, 
    publicProjects: 0, 
    archivedProjects: 0, 
    totalCollaborators: 0 
  };
};

module.exports = mongoose.model('Project', projectSchema);