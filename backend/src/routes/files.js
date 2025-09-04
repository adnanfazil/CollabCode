const express = require('express');
const { body, query, param, validationResult } = require('express-validator');
const File = require('../models/File');
const Project = require('../models/Project');
const { AppError } = require('../middleware/errorHandler');
const { protect } = require('../middleware/auth');
const logger = require('../utils/logger');
const socketService = require('../services/socketService');

const router = express.Router();

// Helper function to handle validation errors
const handleValidationErrors = (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({
      success: false,
      message: 'Validation failed',
      errors: errors.array()
    });
  }
  next();
};

// Validation schemas
const validateFile = [
  body('name')
    .trim()
    .isLength({ min: 1, max: 255 })
    .withMessage('File name must be between 1 and 255 characters')
    .matches(/^[^<>:"/\\|?*]+$/)
    .withMessage('File name contains invalid characters'),
  body('content')
    .optional()
    .isString()
    .withMessage('Content must be a string'),
  body('type')
    .optional()
    .isIn(['file', 'folder'])
    .withMessage('Type must be either file or folder'),
  body('parent')
    .optional()
    .isMongoId()
    .withMessage('Parent must be a valid ID'),
  body('isReadOnly')
    .optional()
    .isBoolean()
    .withMessage('isReadOnly must be a boolean')
];

// Middleware to check project access
const checkProjectAccess = async (req, res, next) => {
  try {
    const projectId = req.params.projectId || req.body.project;
    
    if (!projectId) {
      return next(new AppError('Project ID is required', 400));
    }
    
    const project = await Project.findById(projectId);
    if (!project) {
      return next(new AppError('Project not found', 404));
    }
    
    if (!project.canView(req.user._id)) {
      return next(new AppError('Not authorized to access this project', 403));
    }
    
    req.project = project;
    next();
  } catch (error) {
    next(error);
  }
};

// @desc    Get files in a project
// @route   GET /api/files/project/:projectId
// @access  Private
router.get('/project/:projectId', protect, [
  param('projectId').isMongoId().withMessage('Invalid project ID'),
  query('parent')
    .optional()
    .custom((value) => {
      if (value === 'null' || value === '') return true;
      if (!value.match(/^[0-9a-fA-F]{24}$/)) {
        throw new Error('Parent must be a valid ID or null');
      }
      return true;
    }),
  query('type')
    .optional()
    .isIn(['file', 'folder'])
    .withMessage('Type must be either file or folder')
], handleValidationErrors, checkProjectAccess, async (req, res, next) => {
  try {
    const { parent, type } = req.query;
    
    const options = {};
    if (parent && parent !== 'null' && parent !== '') {
      options.parent = parent;
    } else {
      options.parent = null;
    }
    
    if (type) {
      options.type = type;
    }
    
    const files = await File.findProjectFiles(req.params.projectId, options);
    
    res.status(200).json({
      success: true,
      data: { files }
    });
  } catch (error) {
    logger.error('Get project files error:', error);
    next(error);
  }
});

// @desc    Get file tree for a project
// @route   GET /api/files/project/:projectId/tree
// @access  Private
router.get('/project/:projectId/tree', protect, [
  param('projectId').isMongoId().withMessage('Invalid project ID')
], handleValidationErrors, checkProjectAccess, async (req, res, next) => {
  try {
    const fileTree = await File.buildFileTree(req.params.projectId);
    
    res.status(200).json({
      success: true,
      data: { fileTree }
    });
  } catch (error) {
    logger.error('Get file tree error:', error);
    next(error);
  }
});

// @desc    Create new file or folder
// @route   POST /api/files
// @access  Private
router.post('/', protect, [
  body('project').isMongoId().withMessage('Project ID is required'),
  ...validateFile
], handleValidationErrors, checkProjectAccess, async (req, res, next) => {
  try {
    const { name, content = '', type = 'file', parent, project, isReadOnly = false } = req.body;
    
    // Check if user can edit the project
    if (!req.project.canEdit(req.user._id)) {
      return next(new AppError('Not authorized to create files in this project', 403));
    }
    
    // Check if parent exists and is a folder
    if (parent) {
      const parentFile = await File.findById(parent);
      if (!parentFile) {
        return next(new AppError('Parent folder not found', 404));
      }
      if (parentFile.type !== 'folder') {
        return next(new AppError('Parent must be a folder', 400));
      }
      if (parentFile.project.toString() !== project) {
        return next(new AppError('Parent folder must be in the same project', 400));
      }
    }
    
    // Check if file with same name already exists in the same location
    const existingFile = await File.findOne({
      project,
      parent: parent || null,
      name,
      isDeleted: { $ne: true }
    });
    
    if (existingFile) {
      return next(new AppError('File or folder with this name already exists', 400));
    }
    
    // Create file
    const file = await File.create({
      name,
      content: type === 'file' ? content : '',
      type,
      parent: parent || null,
      project,
      isReadOnly,
      metadata: {
        lastEditedBy: req.user._id
      }
    });
    
    const populatedFile = await File.findById(file._id)
      .populate('metadata.lastEditedBy', 'name email');
    
    // Update project activity
    await req.project.updateActivity();

    logger.info(`${type} created: ${name} in project ${req.project.name} by ${req.user.email}`);

    // Broadcast file creation to other users in the project
    socketService.broadcastFileCreated(project, populatedFile, req.user);

    res.status(201).json({
      success: true,
      message: `${type.charAt(0).toUpperCase() + type.slice(1)} created successfully`,
      data: { file: populatedFile }
    });
  } catch (error) {
    logger.error('Create file error:', error);
    next(error);
  }
});

// @desc    Get file by ID
// @route   GET /api/files/:id
// @access  Private
router.get('/:id', protect, [
  param('id').isMongoId().withMessage('Invalid file ID')
], handleValidationErrors, async (req, res, next) => {
  try {
    const file = await File.findById(req.params.id)
      .populate('project', 'name owner collaborators')
      .populate('metadata.lastEditedBy', 'name email');
    
    if (!file) {
      return next(new AppError('File not found', 404));
    }
    
    if (file.isDeleted) {
      return next(new AppError('File has been deleted', 404));
    }
    
    // Check if user can view this file
    const userRole = file.project.getUserRole(req.user._id);
    if (!file.canRead(req.user._id, userRole)) {
      return next(new AppError('Not authorized to view this file', 403));
    }
    
    res.status(200).json({
      success: true,
      data: { file }
    });
  } catch (error) {
    logger.error('Get file error:', error);
    next(error);
  }
});

// @desc    Update file
// @route   PUT /api/files/:id
// @access  Private
router.put('/:id', protect, [
  param('id').isMongoId().withMessage('Invalid file ID'),
  body('name')
    .optional()
    .trim()
    .isLength({ min: 1, max: 255 })
    .withMessage('File name must be between 1 and 255 characters')
    .matches(/^[^<>:"/\\|?*]+$/)
    .withMessage('File name contains invalid characters'),
  body('content')
    .optional()
    .isString()
    .withMessage('Content must be a string'),
  body('isReadOnly')
    .optional()
    .isBoolean()
    .withMessage('isReadOnly must be a boolean')
], handleValidationErrors, async (req, res, next) => {
  try {
    const { name, content, isReadOnly } = req.body;
    
    const file = await File.findById(req.params.id)
      .populate('project', 'name owner collaborators');
    
    if (!file) {
      return next(new AppError('File not found', 404));
    }
    
    if (file.isDeleted) {
      return next(new AppError('File has been deleted', 404));
    }
    
    // Check if user can edit this file
    const userRole = file.project.getUserRole(req.user._id);
    if (!file.canWrite(req.user._id, userRole)) {
      return next(new AppError('Not authorized to edit this file', 403));
    }
    
    // Check if new name conflicts with existing files
    if (name && name !== file.name) {
      const existingFile = await File.findOne({
        project: file.project._id,
        parent: file.parent,
        name,
        _id: { $ne: file._id },
        isDeleted: { $ne: true }
      });
      
      if (existingFile) {
        return next(new AppError('File or folder with this name already exists', 400));
      }
    }
    
    // Update file
    const updateData = {};
    if (name) updateData.name = name;
    if (content !== undefined && file.type === 'file') {
      updateData.content = content;
      updateData['metadata.lastEditedBy'] = req.user._id;
    }
    if (isReadOnly !== undefined) updateData.isReadOnly = isReadOnly;
    
    const updatedFile = await File.findByIdAndUpdate(
      req.params.id,
      updateData,
      { new: true, runValidators: true }
    ).populate('metadata.lastEditedBy', 'name email');
    
    // Update project activity
    const project = await Project.findById(file.project._id);
    await project.updateActivity();

    logger.info(`File updated: ${updatedFile.name} by ${req.user.email}`);

    // Broadcast file changes to other users in the project via WebSocket
    if (content !== undefined && file.type === 'file') {
      const changes = [{
        text: content,
        range: null // Simple implementation - full file replacement
      }];

      socketService.broadcastFileChange(project._id, updatedFile._id, changes, req.user);

      // Sync updated file to container filesystem
      const { syncProjectToDisk } = require('../services/fileSync');
      try {
        await syncProjectToDisk(project._id);
        logger.info(`🔄 File synced to container filesystem for project ${project._id}`);
      } catch (syncError) {
        logger.error(`❌ Failed to sync file to container:`, syncError);
      }
    }

    res.status(200).json({
      success: true,
      message: 'File updated successfully',
      data: { file: updatedFile }
    });
  } catch (error) {
    logger.error('Update file error:', error);
    next(error);
  }
});

// @desc    Move file or folder
// @route   PATCH /api/files/:id/move
// @access  Private
router.patch('/:id/move', protect, [
  param('id').isMongoId().withMessage('Invalid file ID'),
  body('parent')
    .optional()
    .custom((value) => {
      if (value === null || value === '') return true;
      if (!value.match(/^[0-9a-fA-F]{24}$/)) {
        throw new Error('Parent must be a valid ID or null');
      }
      return true;
    })
], handleValidationErrors, async (req, res, next) => {
  try {
    const { parent } = req.body;
    
    const file = await File.findById(req.params.id)
      .populate('project', 'name owner collaborators');
    
    if (!file) {
      return next(new AppError('File not found', 404));
    }
    
    if (file.isDeleted) {
      return next(new AppError('File has been deleted', 404));
    }
    
    // Check if user can edit this file
    const userRole = file.project.getUserRole(req.user._id);
    if (!file.canWrite(req.user._id, userRole)) {
      return next(new AppError('Not authorized to move this file', 403));
    }
    
    // Check if new parent exists and is a folder
    if (parent) {
      const parentFile = await File.findById(parent);
      if (!parentFile) {
        return next(new AppError('Parent folder not found', 404));
      }
      if (parentFile.type !== 'folder') {
        return next(new AppError('Parent must be a folder', 400));
      }
      if (parentFile.project.toString() !== file.project._id.toString()) {
        return next(new AppError('Cannot move file to different project', 400));
      }
      
      // Prevent moving folder into itself or its children
      if (file.type === 'folder') {
        let currentParent = parentFile;
        while (currentParent) {
          if (currentParent._id.toString() === file._id.toString()) {
            return next(new AppError('Cannot move folder into itself or its children', 400));
          }
          if (currentParent.parent) {
            currentParent = await File.findById(currentParent.parent);
          } else {
            break;
          }
        }
      }
    }
    
    // Check if file with same name already exists in destination
    const existingFile = await File.findOne({
      project: file.project._id,
      parent: parent || null,
      name: file.name,
      _id: { $ne: file._id },
      isDeleted: { $ne: true }
    });
    
    if (existingFile) {
      return next(new AppError('File or folder with this name already exists in destination', 400));
    }
    
    // Move file
    file.parent = parent || null;
    await file.save();
    
    logger.info(`File moved: ${file.name} by ${req.user.email}`);
    
    res.status(200).json({
      success: true,
      message: 'File moved successfully',
      data: { file }
    });
  } catch (error) {
    logger.error('Move file error:', error);
    next(error);
  }
});

// @desc    Delete file or folder
// @route   DELETE /api/files/:id
// @access  Private
router.delete('/:id', protect, [
  param('id').isMongoId().withMessage('Invalid file ID')
], handleValidationErrors, async (req, res, next) => {
  try {
    const file = await File.findById(req.params.id)
      .populate('project', 'name owner collaborators');
    
    if (!file) {
      return next(new AppError('File not found', 404));
    }
    
    if (file.isDeleted) {
      return next(new AppError('File has already been deleted', 404));
    }
    
    // Check if user can delete this file
    const userRole = file.project.getUserRole(req.user._id);
    if (!file.canDelete(req.user._id, userRole)) {
      return next(new AppError('Not authorized to delete this file', 403));
    }
    
    // Soft delete the file
    await file.softDelete(req.user._id);
    
    // If it's a folder, soft delete all children recursively
    if (file.type === 'folder') {
      await softDeleteChildren(file._id, req.user._id);
    }

    logger.info(`File deleted: ${file.name} by ${req.user.email}`);

    // Broadcast file deletion to other users in the project
    socketService.broadcastFileDeleted(file.project._id, file._id, req.user);

    res.status(200).json({
      success: true,
      message: 'File deleted successfully'
    });
  } catch (error) {
    logger.error('Delete file error:', error);
    next(error);
  }
});

// @desc    Search files in project
// @route   GET /api/files/project/:projectId/search
// @access  Private
router.get('/project/:projectId/search', protect, [
  param('projectId').isMongoId().withMessage('Invalid project ID'),
  query('q')
    .notEmpty()
    .trim()
    .isLength({ min: 1 })
    .withMessage('Search query is required'),
  query('type')
    .optional()
    .isIn(['file', 'folder'])
    .withMessage('Type must be either file or folder'),
  query('language')
    .optional()
    .isString()
    .withMessage('Language must be a string'),
  query('limit')
    .optional()
    .isInt({ min: 1, max: 100 })
    .withMessage('Limit must be between 1 and 100')
], handleValidationErrors, checkProjectAccess, async (req, res, next) => {
  try {
    const { q, type, language, limit } = req.query;
    
    const files = await File.searchFiles(req.params.projectId, q, {
      type,
      language,
      limit: parseInt(limit) || 50
    });
    
    res.status(200).json({
      success: true,
      data: { files }
    });
  } catch (error) {
    logger.error('Search files error:', error);
    next(error);
  }
});

// @desc    Restore deleted file
// @route   PATCH /api/files/:id/restore
// @access  Private
router.patch('/:id/restore', protect, [
  param('id').isMongoId().withMessage('Invalid file ID')
], handleValidationErrors, async (req, res, next) => {
  try {
    const file = await File.findById(req.params.id)
      .populate('project', 'name owner collaborators');
    
    if (!file) {
      return next(new AppError('File not found', 404));
    }
    
    if (!file.isDeleted) {
      return next(new AppError('File is not deleted', 400));
    }
    
    // Check if user can edit the project
    if (!file.project.canEdit(req.user._id)) {
      return next(new AppError('Not authorized to restore files in this project', 403));
    }
    
    // Check if file with same name already exists in the same location
    const existingFile = await File.findOne({
      project: file.project._id,
      parent: file.parent,
      name: file.name,
      _id: { $ne: file._id },
      isDeleted: { $ne: true }
    });
    
    if (existingFile) {
      return next(new AppError('File or folder with this name already exists', 400));
    }
    
    // Restore file
    await file.restore();
    
    logger.info(`File restored: ${file.name} by ${req.user.email}`);
    
    res.status(200).json({
      success: true,
      message: 'File restored successfully',
      data: { file }
    });
  } catch (error) {
    logger.error('Restore file error:', error);
    next(error);
  }
});

// Helper function to recursively soft delete children
const softDeleteChildren = async (parentId, userId) => {
  const children = await File.find({ parent: parentId, isDeleted: { $ne: true } });
  
  for (const child of children) {
    await child.softDelete(userId);
    
    if (child.type === 'folder') {
      await softDeleteChildren(child._id, userId);
    }
  }
};

// Test endpoint to manually broadcast a message
router.post('/test-broadcast/:projectId', protect, async (req, res) => {
  try {
    const { projectId } = req.params;
    const { message } = req.body;

    logger.info(`🧪 Test broadcast requested by ${req.user.email} for project ${projectId}`);

    // Test broadcast using socket service
    const testData = {
      fileId: 'test-file-id',
      changes: [{ text: message || 'Test broadcast message' }],
      version: Date.now(),
      user: req.user
    };

    socketService.broadcastFileChange(projectId, 'test-file-id', testData.changes, req.user);

    res.json({
      success: true,
      message: 'Test broadcast sent',
      data: testData
    });
  } catch (error) {
    logger.error('Test broadcast error:', error);
    res.status(500).json({
      success: false,
      message: 'Test broadcast failed'
    });
  }
});

module.exports = router;
// @desc    Get file content (optional line range) with byte-size cap
// @route   GET /api/files/:id/content
// @access  Private
router.get('/:id/content', protect, [
  param('id').isMongoId().withMessage('Invalid file ID'),
  query('startLine').optional().toInt().isInt({ min: 1 }).withMessage('startLine must be >= 1'),
  query('endLine').optional().toInt().isInt({ min: 1 }).withMessage('endLine must be >= 1'),
  query('maxBytes').optional().toInt().isInt({ min: 1, max: 1048576 }).withMessage('maxBytes must be between 1 and 1048576')
], handleValidationErrors, async (req, res, next) => {
  try {
    const file = await File.findById(req.params.id)
      .populate('project', 'name owner collaborators')
      .populate('metadata.lastEditedBy', 'name email');

    if (!file) {
      return next(new AppError('File not found', 404));
    }

    if (file.isDeleted) {
      return next(new AppError('File has been deleted', 404));
    }

    // Permission check
    const userRole = file.project.getUserRole(req.user._id);
    if (!file.canRead(req.user._id, userRole)) {
      return next(new AppError('Not authorized to view this file', 403));
    }

    if (file.type !== 'file') {
      return next(new AppError('Cannot retrieve content for folders', 400));
    }

    // Only support utf8 textual content in this endpoint
    if (file.encoding && file.encoding !== 'utf8') {
      return next(new AppError('File encoding not supported for text retrieval', 415));
    }

    const fullContent = typeof file.content === 'string' ? file.content : '';
    const lines = fullContent.split(/\r?\n/);
    const totalLines = lines.length;

    // Determine line range (1-indexed inclusive)
    const start = req.query.startLine ? Math.min(Math.max(1, req.query.startLine), totalLines) : 1;
    const end = req.query.endLine ? Math.min(Math.max(start, req.query.endLine), totalLines) : totalLines;

    let contentSlice = lines.slice(start - 1, end).join('\n');

    // Enforce byte-size cap with a sensible default of 200KB
    const MAX_ABSOLUTE_BYTES = 1048576; // 1MB hard cap per query param validation
    const defaultCap = 200 * 1024; // 200KB default
    const maxBytes = req.query.maxBytes ? Math.min(MAX_ABSOLUTE_BYTES, req.query.maxBytes) : defaultCap;

    const encoder = new TextEncoder();
    let buffer = encoder.encode(contentSlice);
    let truncated = false;

    if (buffer.byteLength > maxBytes) {
      truncated = true;
      // Create head+tail preview within budget
      const budget = maxBytes;
      // Reserve space for truncation marker
      const marker = `\n... [truncated to ${budget} bytes] ...\n`;
      const markerBytes = encoder.encode(marker).byteLength;
      const halfBudget = Math.max(0, Math.floor((budget - markerBytes) / 2));

      // Approximate by character counts (utf8 safe enough for ASCII code files)
      const headChars = Math.max(0, Math.min(contentSlice.length, halfBudget));
      const tailChars = Math.max(0, Math.min(contentSlice.length - headChars, halfBudget));
      const head = contentSlice.slice(0, headChars);
      const tail = contentSlice.slice(contentSlice.length - tailChars);

      contentSlice = `${head}${marker}${tail}`;
      buffer = encoder.encode(contentSlice);

      // If still somehow too large due to multibyte, hard trim
      if (buffer.byteLength > budget) {
        // Trim to exact budget in bytes
        let low = 0;
        let high = contentSlice.length;
        let best = '';
        while (low <= high) {
          const mid = Math.floor((low + high) / 2);
          const candidate = contentSlice.slice(0, mid);
          const size = encoder.encode(candidate).byteLength;
          if (size <= budget) {
            best = candidate;
            low = mid + 1;
          } else {
            high = mid - 1;
          }
        }
        contentSlice = best;
      }
    }

    res.status(200).json({
      success: true,
      data: {
        fileId: file._id,
        name: file.name,
        language: file.language,
        size: file.size,
        totalLines,
        startLine: start,
        endLine: end,
        truncated,
        content: contentSlice,
        updatedAt: file.updatedAt
      }
    });
  } catch (error) {
    logger.error('Get file content error:', error);
    next(error);
  }
});