const mongoose = require('mongoose');
const path = require('path');

const fileSchema = new mongoose.Schema({
  name: {
    type: String,
    required: [true, 'Please provide a file name'],
    trim: true,
    maxlength: [255, 'File name cannot be more than 255 characters']
  },
  content: {
    type: String,
    default: ''
  },
  project: {
    type: mongoose.Schema.ObjectId,
    ref: 'Project',
    required: [true, 'File must belong to a project']
  },
  parent: {
    type: mongoose.Schema.ObjectId,
    ref: 'File',
    default: null // null for root files, ObjectId for files in folders
  },
  type: {
    type: String,
    enum: ['file', 'folder'],
    default: 'file'
  },
  language: {
    type: String,
    default: function() {
      if (this.type === 'folder') return null;
      return this.getLanguageFromExtension();
    }
  },
  size: {
    type: Number,
    default: 0
  },
  encoding: {
    type: String,
    default: 'utf8',
    enum: ['utf8', 'base64', 'binary']
  },
  mimeType: {
    type: String,
    default: 'text/plain'
  },
  isReadOnly: {
    type: Boolean,
    default: false
  },
  isHidden: {
    type: Boolean,
    default: false
  },
  order: {
    type: Number,
    default: 0
  },
  metadata: {
    lineCount: {
      type: Number,
      default: 0
    },
    characterCount: {
      type: Number,
      default: 0
    },
    lastEditedBy: {
      type: mongoose.Schema.ObjectId,
      ref: 'User'
    },
    lastEditedAt: {
      type: Date,
      default: Date.now
    },
    version: {
      type: Number,
      default: 1
    },
    checksum: {
      type: String
    }
  },
  permissions: {
    canRead: [{
      type: mongoose.Schema.ObjectId,
      ref: 'User'
    }],
    canWrite: [{
      type: mongoose.Schema.ObjectId,
      ref: 'User'
    }],
    canDelete: [{
      type: mongoose.Schema.ObjectId,
      ref: 'User'
    }]
  },
  tags: [{
    type: String,
    trim: true,
    maxlength: 30
  }],
  isDeleted: {
    type: Boolean,
    default: false
  },
  deletedAt: {
    type: Date
  },
  deletedBy: {
    type: mongoose.Schema.ObjectId,
    ref: 'User'
  }
}, {
  timestamps: true,
  toJSON: { virtuals: true },
  toObject: { virtuals: true },
  // Removed languageOverride setting - MongoDB language conflicts resolved
});

// Indexes
fileSchema.index({ project: 1, parent: 1, name: 1 });
fileSchema.index({ project: 1, type: 1 });
fileSchema.index({ 'metadata.lastEditedAt': -1 });
fileSchema.index({ isDeleted: 1 });
fileSchema.index({ language: 1 });

// Compound index for file tree queries
fileSchema.index({ project: 1, parent: 1, order: 1 });

// Virtual for file extension
fileSchema.virtual('extension').get(function() {
  if (this.type === 'folder') return null;
  return path.extname(this.name).toLowerCase();
});

// Virtual for file path
fileSchema.virtual('path').get(function() {
  // This would need to be populated with parent information
  return this.name;
});

// Virtual for children (for folders)
fileSchema.virtual('children', {
  ref: 'File',
  localField: '_id',
  foreignField: 'parent'
});

// Pre-save middleware
fileSchema.pre('save', function(next) {
  // Update size and metadata for files
  if (this.type === 'file' && this.isModified('content')) {
    this.size = Buffer.byteLength(this.content, this.encoding);
    this.metadata.characterCount = this.content.length;
    this.metadata.lineCount = this.content.split('\n').length;
    this.metadata.lastEditedAt = new Date();
    this.metadata.version += 1;
    
    // Generate checksum
    const crypto = require('crypto');
    this.metadata.checksum = crypto
      .createHash('md5')
      .update(this.content)
      .digest('hex');
  }
  
  // Set language based on file extension
  if (this.type === 'file' && this.isModified('name')) {
    this.language = this.getLanguageFromExtension();
    this.mimeType = this.getMimeTypeFromExtension();
  }
  
  // Handle soft delete
  if (this.isModified('isDeleted') && this.isDeleted) {
    this.deletedAt = new Date();
  } else if (this.isModified('isDeleted') && !this.isDeleted) {
    this.deletedAt = undefined;
    this.deletedBy = undefined;
  }
  
  next();
});

// Instance method to get language from file extension
fileSchema.methods.getLanguageFromExtension = function() {
  const ext = this.extension;
  const languageMap = {
    '.js': 'js',
    '.jsx': 'jsx',
    '.ts': 'typescript',
    '.tsx': 'typescript',
    '.py': 'python',
    '.java': 'java',
    '.cpp': 'cpp',
    '.c': 'c',
    '.cs': 'csharp',
    '.php': 'php',
    '.rb': 'ruby',
    '.go': 'go',
    '.rs': 'rust',
    '.swift': 'swift',
    '.kt': 'kotlin',
    '.html': 'html',
    '.htm': 'html',
    '.css': 'css',
    '.scss': 'scss',
    '.sass': 'scss',
    '.json': 'json',
    '.xml': 'xml',
    '.yaml': 'yaml',
    '.yml': 'yaml',
    '.md': 'markdown',
    '.sql': 'sql',
    '.sh': 'shell',
    '.bash': 'shell',
    '.dockerfile': 'dockerfile'
  };
  
  return languageMap[ext] || 'text';
};

// Instance method to get MIME type from extension
fileSchema.methods.getMimeTypeFromExtension = function() {
  const ext = this.extension;
  const mimeMap = {
    '.js': 'application/javascript',
    '.jsx': 'application/javascript',
    '.ts': 'application/typescript',
    '.tsx': 'application/typescript',
    '.py': 'text/x-python',
    '.java': 'text/x-java-source',
    '.cpp': 'text/x-c++src',
    '.c': 'text/x-csrc',
    '.cs': 'text/x-csharp',
    '.php': 'application/x-httpd-php',
    '.rb': 'application/x-ruby',
    '.go': 'text/x-go',
    '.rs': 'text/x-rust',
    '.swift': 'text/x-swift',
    '.kt': 'text/x-kotlin',
    '.html': 'text/html',
    '.htm': 'text/html',
    '.css': 'text/css',
    '.scss': 'text/x-scss',
    '.sass': 'text/x-sass',
    '.json': 'application/json',
    '.xml': 'application/xml',
    '.yaml': 'application/x-yaml',
    '.yml': 'application/x-yaml',
    '.md': 'text/markdown',
    '.sql': 'application/sql',
    '.sh': 'application/x-sh',
    '.bash': 'application/x-sh'
  };
  
  return mimeMap[ext] || 'text/plain';
};

// Instance method to get full path
fileSchema.methods.getFullPath = async function() {
  const pathParts = [this.name];
  let current = this;
  
  while (current.parent) {
    current = await this.constructor.findById(current.parent);
    if (current) {
      pathParts.unshift(current.name);
    }
  }
  
  return pathParts.join('/');
};

// Instance method to check if user can read
fileSchema.methods.canRead = function(userId, userRole) {
  if (userRole === 'owner' || userRole === 'admin') return true;
  if (this.permissions.canRead.length === 0) return true; // No restrictions
  return this.permissions.canRead.includes(userId);
};

// Instance method to check if user can write
fileSchema.methods.canWrite = function(userId, userRole) {
  if (this.isReadOnly) return false;
  if (userRole === 'owner' || userRole === 'admin') return true;
  if (userRole === 'viewer') return false;
  if (this.permissions.canWrite.length === 0) return true; // No restrictions
  return this.permissions.canWrite.includes(userId);
};

// Instance method to check if user can delete
fileSchema.methods.canDelete = function(userId, userRole) {
  if (userRole === 'owner' || userRole === 'admin') return true;
  if (userRole === 'viewer') return false;
  if (this.permissions.canDelete.length === 0) return true; // No restrictions
  return this.permissions.canDelete.includes(userId);
};

// Instance method to soft delete
fileSchema.methods.softDelete = function(userId) {
  this.isDeleted = true;
  this.deletedBy = userId;
  return this.save();
};

// Instance method to restore from soft delete
fileSchema.methods.restore = function() {
  this.isDeleted = false;
  this.deletedAt = undefined;
  this.deletedBy = undefined;
  return this.save();
};

// Static method to find project files
fileSchema.statics.findProjectFiles = function(projectId, options = {}) {
  const query = { 
    project: projectId,
    isDeleted: { $ne: true }
  };
  
  if (options.parent !== undefined) {
    query.parent = options.parent;
  }
  
  if (options.type) {
    query.type = options.type;
  }
  
  return this.find(query)
    .populate('metadata.lastEditedBy', 'name email')
    .sort({ type: -1, order: 1, name: 1 }); // Folders first, then by order, then by name
};

// Static method to build file tree
fileSchema.statics.buildFileTree = async function(projectId) {
  const files = await this.find({
    project: projectId,
    isDeleted: { $ne: true }
  }).sort({ type: -1, order: 1, name: 1 });
  
  const fileMap = new Map();
  const rootFiles = [];
  
  // Create map of all files
  files.forEach(file => {
    fileMap.set(file._id.toString(), {
      ...file.toObject(),
      children: []
    });
  });
  
  // Build tree structure
  files.forEach(file => {
    const fileObj = fileMap.get(file._id.toString());
    
    if (file.parent) {
      const parent = fileMap.get(file.parent.toString());
      if (parent) {
        parent.children.push(fileObj);
      }
    } else {
      rootFiles.push(fileObj);
    }
  });
  
  return rootFiles;
};

// Static method to search files
fileSchema.statics.searchFiles = function(projectId, searchTerm, options = {}) {
  const query = {
    project: projectId,
    isDeleted: { $ne: true },
    $or: [
      { name: { $regex: searchTerm, $options: 'i' } },
      { content: { $regex: searchTerm, $options: 'i' } },
      { tags: { $in: [new RegExp(searchTerm, 'i')] } }
    ]
  };
  
  if (options.type) {
    query.type = options.type;
  }
  
  if (options.language) {
    query.language = options.language;
  }
  
  return this.find(query)
    .populate('metadata.lastEditedBy', 'name email')
    .sort({ 'metadata.lastEditedAt': -1 })
    .limit(options.limit || 50);
};

module.exports = mongoose.model('File', fileSchema);