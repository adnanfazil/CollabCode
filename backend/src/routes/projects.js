const express = require('express');
const { body, query, param, validationResult } = require('express-validator');
const Project = require('../models/Project');
const File = require('../models/File');
const User = require('../models/User');
const { AppError } = require('../middleware/errorHandler');
const { protect, checkOwnership } = require('../middleware/auth');
const logger = require('../utils/logger');

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
const validateProject = [
  body('name')
    .trim()
    .isLength({ min: 1, max: 100 })
    .withMessage('Project name must be between 1 and 100 characters'),
  body('description')
    .optional()
    .trim()
    .isLength({ max: 500 })
    .withMessage('Description cannot be more than 500 characters'),
  body('programmingLanguage')
    .optional()
    .isIn([
      'js', 'jsx', 'typescript', 'python', 'java', 'cpp', 'c',
      'csharp', 'php', 'ruby', 'go', 'rust', 'swift', 'kotlin',
      'html', 'css', 'scss', 'json', 'xml', 'yaml', 'markdown',
      'sql', 'shell', 'dockerfile', 'other'
    ])
    .withMessage('Invalid language'),
  body('template')
    .optional()
    .isIn(['blank', 'react', 'vue', 'angular', 'node', 'python', 'java', 'other'])
    .withMessage('Invalid template'),
  body('isPublic')
    .optional()
    .isBoolean()
    .withMessage('isPublic must be a boolean'),
  body('tags')
    .optional()
    .isArray()
    .withMessage('Tags must be an array')
    .custom((tags) => {
      if (tags.length > 10) {
        throw new Error('Maximum 10 tags allowed');
      }
      return true;
    }),
  body('fileTree')
    .optional()
    .isArray()
    .withMessage('fileTree must be an array')
    .custom((fileTree) => {
      if (fileTree && fileTree.length > 100) {
        throw new Error('Maximum 100 files/folders allowed in file tree');
      }
      return true;
    })
];

const validateCollaborator = [
  body('email')
    .isEmail()
    .normalizeEmail()
    .withMessage('Please provide a valid email'),
  body('role')
    .optional()
    .isIn(['viewer', 'editor', 'admin'])
    .withMessage('Role must be viewer, editor, or admin')
];

// @desc    Get all projects for current user
// @route   GET /api/projects
// @access  Private
router.get('/', protect, [
  query('page')
    .optional()
    .isInt({ min: 1 })
    .withMessage('Page must be a positive integer'),
  query('limit')
    .optional()
    .isInt({ min: 1, max: 50 })
    .withMessage('Limit must be between 1 and 50'),
  query('search')
    .optional()
    .trim()
    .isLength({ min: 1 })
    .withMessage('Search term must not be empty'),
  query('programmingLanguage')
    .optional()
    .isString()
    .withMessage('Language must be a string'),
  query('includeArchived')
    .optional()
    .isBoolean()
    .withMessage('includeArchived must be a boolean')
], handleValidationErrors, async (req, res, next) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const skip = (page - 1) * limit;
    const { search, programmingLanguage, includeArchived } = req.query;
    
    // Build query
    const query = {
      $or: [
        { owner: req.user._id },
        { 'collaborators.user': req.user._id }
      ]
    };
    
    if (includeArchived !== 'true') {
      query.isArchived = { $ne: true };
    }
    
    if (search) {
      query.$and = query.$and || [];
      query.$and.push({
        $or: [
          { name: { $regex: search, $options: 'i' } },
          { description: { $regex: search, $options: 'i' } },
          { tags: { $in: [new RegExp(search, 'i')] } }
        ]
      });
    }
    
    if (programmingLanguage) {
      query.programmingLanguage = programmingLanguage;
    }
    
    // Get projects with pagination
    const projects = await Project.find(query)
      .populate('owner', 'name email avatar')
      .populate('collaborators.user', 'name email avatar')
      .sort({ 'stats.lastActivity': -1 })
      .skip(skip)
      .limit(limit);
    
    // Get total count
    const total = await Project.countDocuments(query);
    
    res.status(200).json({
      success: true,
      data: {
        projects,
        pagination: {
          page,
          limit,
          total,
          pages: Math.ceil(total / limit)
        }
      }
    });
  } catch (error) {
    logger.error('Get projects error:', error);
    next(error);
  }
});

// @desc    Get public projects
// @route   GET /api/projects/public
// @access  Public
router.get('/public', [
  query('page')
    .optional()
    .isInt({ min: 1 })
    .withMessage('Page must be a positive integer'),
  query('limit')
    .optional()
    .isInt({ min: 1, max: 50 })
    .withMessage('Limit must be between 1 and 50'),
  query('programmingLanguage')
    .optional()
    .isString()
    .withMessage('Language must be a string')
], handleValidationErrors, async (req, res, next) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const skip = (page - 1) * limit;
    const { programmingLanguage } = req.query;
    
    const query = { 
      isPublic: true,
      isArchived: { $ne: true }
    };
    
    if (programmingLanguage) {
      query.programmingLanguage = programmingLanguage;
    }
    
    const projects = await Project.find(query)
      .populate('owner', 'name email avatar')
      .sort({ 'stats.lastActivity': -1 })
      .skip(skip)
      .limit(limit);
    
    const total = await Project.countDocuments(query);
    
    res.status(200).json({
      success: true,
      data: {
        projects,
        pagination: {
          page,
          limit,
          total,
          pages: Math.ceil(total / limit)
        }
      }
    });
  } catch (error) {
    logger.error('Get public projects error:', error);
    next(error);
  }
});

// @desc    Create new project
// @route   POST /api/projects
// @access  Private
router.post('/', protect, validateProject, handleValidationErrors, async (req, res, next) => {
  try {
    const { name, description, programmingLanguage, template, isPublic, tags, settings, fileTree } = req.body;

    const project = await Project.create({
      name,
      description,
      owner: req.user._id,
      programmingLanguage: programmingLanguage || 'js',
      template: template || 'blank',
      isPublic: isPublic || false,
      tags: tags || [],
      settings: settings || {}
    });

    // Create initial files from template or fileTree
    if (fileTree && fileTree.length > 0) {
      await createFileTreeStructure(project._id, fileTree, req.user._id);
    } else if (template && template !== 'blank') {
      await createTemplateFiles(project._id, template);
    }

    const populatedProject = await Project.findById(project._id)
      .populate('owner', 'name email avatar');

    logger.info(`Project created: ${name} by ${req.user.email}`);

    res.status(201).json({
      success: true,
      message: 'Project created successfully',
      data: { project: populatedProject }
    });
  } catch (error) {
    logger.error('Create project error:', error);
    next(error);
  }
});

// @desc    Get project by ID
// @route   GET /api/projects/:id
// @access  Private
router.get('/:id', protect, [
  param('id').isMongoId().withMessage('Invalid project ID')
], handleValidationErrors, async (req, res, next) => {
  try {
    const project = await Project.findById(req.params.id)
      .populate('owner', 'name email avatar')
      .populate('collaborators.user', 'name email avatar')
      .populate('collaborators.addedBy', 'name email');
    
    if (!project) {
      return next(new AppError('Project not found', 404));
    }
    
    // Check if user can view this project
    if (!project.canView(req.user._id)) {
      return next(new AppError('Not authorized to view this project', 403));
    }
    
    // Update last activity
    await project.updateActivity();
    
    res.status(200).json({
      success: true,
      data: { project }
    });
  } catch (error) {
    logger.error('Get project error:', error);
    next(error);
  }
});

// @desc    Update project
// @route   PUT /api/projects/:id
// @access  Private
router.put('/:id', protect, [
  param('id').isMongoId().withMessage('Invalid project ID'),
  ...validateProject
], handleValidationErrors, async (req, res, next) => {
  try {
    const project = await Project.findById(req.params.id);
    
    if (!project) {
      return next(new AppError('Project not found', 404));
    }
    
    // Check if user can edit this project
    if (!project.canEdit(req.user._id)) {
      return next(new AppError('Not authorized to edit this project', 403));
    }
    
    const { name, description, programmingLanguage, isPublic, tags, settings } = req.body;
    
    const updateData = {};
    if (name) updateData.name = name;
    if (description !== undefined) updateData.description = description;
    if (programmingLanguage) updateData.programmingLanguage = programmingLanguage;
    if (isPublic !== undefined) updateData.isPublic = isPublic;
    if (tags) updateData.tags = tags;
    if (settings) updateData.settings = { ...project.settings, ...settings };
    
    const updatedProject = await Project.findByIdAndUpdate(
      req.params.id,
      updateData,
      { new: true, runValidators: true }
    ).populate('owner', 'name email avatar')
     .populate('collaborators.user', 'name email avatar');
    
    logger.info(`Project updated: ${updatedProject.name} by ${req.user.email}`);
    
    res.status(200).json({
      success: true,
      message: 'Project updated successfully',
      data: { project: updatedProject }
    });
  } catch (error) {
    logger.error('Update project error:', error);
    next(error);
  }
});

// @desc    Delete project
// @route   DELETE /api/projects/:id
// @access  Private
router.delete('/:id', protect, [
  param('id').isMongoId().withMessage('Invalid project ID')
], handleValidationErrors, async (req, res, next) => {
  try {
    const project = await Project.findById(req.params.id);
    
    if (!project) {
      return next(new AppError('Project not found', 404));
    }
    
    // Only owner can delete project
    if (!project.isOwner(req.user._id)) {
      return next(new AppError('Only project owner can delete the project', 403));
    }
    
    // Delete all files in the project
    await File.deleteMany({ project: req.params.id });
    
    // Delete the project
    await Project.findByIdAndDelete(req.params.id);
    
    logger.info(`Project deleted: ${project.name} by ${req.user.email}`);
    
    res.status(200).json({
      success: true,
      message: 'Project deleted successfully'
    });
  } catch (error) {
    logger.error('Delete project error:', error);
    next(error);
  }
});

// @desc    Add collaborator to project
// @route   POST /api/projects/:id/collaborators
// @access  Private
router.post('/:id/collaborators', protect, [
  param('id').isMongoId().withMessage('Invalid project ID'),
  ...validateCollaborator
], handleValidationErrors, async (req, res, next) => {
  try {
    const { email, role = 'editor' } = req.body;
    
    const project = await Project.findById(req.params.id);
    if (!project) {
      return next(new AppError('Project not found', 404));
    }
    
    // Check if user can manage collaborators (owner or admin)
    const userRole = project.getUserRole(req.user._id);
    if (!['owner', 'admin'].includes(userRole)) {
      return next(new AppError('Not authorized to manage collaborators', 403));
    }
    
    // Find user by email
    const user = await User.findByEmail(email);
    if (!user) {
      return next(new AppError('User not found', 404));
    }
    
    // Check if user is already a collaborator or owner
    if (project.isOwner(user._id) || project.isCollaborator(user._id)) {
      return next(new AppError('User is already a collaborator or owner', 400));
    }
    
    // Add collaborator
    await project.addCollaborator(user._id, role, req.user._id);
    
    const updatedProject = await Project.findById(req.params.id)
      .populate('collaborators.user', 'name email avatar')
      .populate('collaborators.addedBy', 'name email');
    
    logger.info(`Collaborator added to project ${project.name}: ${email} as ${role}`);
    
    res.status(200).json({
      success: true,
      message: 'Collaborator added successfully',
      data: { project: updatedProject }
    });
  } catch (error) {
    logger.error('Add collaborator error:', error);
    next(error);
  }
});

// @desc    Remove collaborator from project
// @route   DELETE /api/projects/:id/collaborators/:userId
// @access  Private
router.delete('/:id/collaborators/:userId', protect, [
  param('id').isMongoId().withMessage('Invalid project ID'),
  param('userId').isMongoId().withMessage('Invalid user ID')
], handleValidationErrors, async (req, res, next) => {
  try {
    const project = await Project.findById(req.params.id);
    if (!project) {
      return next(new AppError('Project not found', 404));
    }
    
    // Check if user can manage collaborators (owner or admin)
    const userRole = project.getUserRole(req.user._id);
    if (!['owner', 'admin'].includes(userRole)) {
      return next(new AppError('Not authorized to manage collaborators', 403));
    }
    
    // Remove collaborator
    await project.removeCollaborator(req.params.userId);
    
    logger.info(`Collaborator removed from project ${project.name}: ${req.params.userId}`);
    
    res.status(200).json({
      success: true,
      message: 'Collaborator removed successfully'
    });
  } catch (error) {
    logger.error('Remove collaborator error:', error);
    next(error);
  }
});

// @desc    Archive/Unarchive project
// @route   PATCH /api/projects/:id/archive
// @access  Private
router.patch('/:id/archive', protect, [
  param('id').isMongoId().withMessage('Invalid project ID'),
  body('isArchived').isBoolean().withMessage('isArchived must be a boolean')
], handleValidationErrors, async (req, res, next) => {
  try {
    const { isArchived } = req.body;
    
    const project = await Project.findById(req.params.id);
    if (!project) {
      return next(new AppError('Project not found', 404));
    }
    
    // Only owner can archive/unarchive project
    if (!project.isOwner(req.user._id)) {
      return next(new AppError('Only project owner can archive/unarchive the project', 403));
    }
    
    project.isArchived = isArchived;
    await project.save();
    
    const action = isArchived ? 'archived' : 'unarchived';
    logger.info(`Project ${action}: ${project.name} by ${req.user.email}`);
    
    res.status(200).json({
      success: true,
      message: `Project ${action} successfully`,
      data: { project }
    });
  } catch (error) {
    logger.error('Archive project error:', error);
    next(error);
  }
});

// Helper function to create template files
const createTemplateFiles = async (projectId, template) => {
  const templates = {
    react: [
      { name: 'package.json', content: JSON.stringify({
        name: 'react-app',
        version: '1.0.0',
        dependencies: {
          react: '^18.0.0',
          'react-dom': '^18.0.0'
        }
      }, null, 2) },
      { name: 'src/App.js', content: `import React from 'react';

function App() {
  return (
    <div className="App">
      <h1>Hello React!</h1>
    </div>
  );
}

export default App;` },
      { name: 'src/index.js', content: `import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';

const root = ReactDOM.createRoot(document.getElementById('root'));
root.render(<App />);` },
      { name: 'public/index.html', content: `<!DOCTYPE html>
<html>
<head>
  <title>React App</title>
</head>
<body>
  <div id="root"></div>
</body>
</html>` }
    ],
    node: [
      { name: 'package.json', content: JSON.stringify({
        name: 'node-app',
        version: '1.0.0',
        main: 'index.js',
        dependencies: {
          express: '^4.18.0'
        }
      }, null, 2) },
      { name: 'index.js', content: `const express = require('express');
const app = express();
const PORT = process.env.PORT || 3000;

app.get('/', (req, res) => {
  res.json({ message: 'Hello World!' });
});

app.listen(PORT, () => {
  console.log(\`Server running on port \${PORT}\`);
});` }
    ],
    python: [
      { name: 'main.py', content: `def main():
    print("Hello Python!")

if __name__ == "__main__":
    main()` },
      { name: 'requirements.txt', content: '# Add your dependencies here' }
    ]
  };
  
  const templateFiles = templates[template] || [];
  
  for (const fileData of templateFiles) {
    await File.create({
      name: fileData.name,
      content: fileData.content,
      project: projectId,
      metadata: {
        lastEditedBy: null
      }
    });
  }
};

// Helper function to create file tree structure
const createFileTreeStructure = async (projectId, fileTree, userId) => {
  const createFileOrFolder = async (item, parentId = null) => {
    try {
      // Create the file or folder
      const fileData = {
        name: item.name,
        type: item.type,
        project: projectId,
        parent: parentId,
        metadata: {
          lastEditedBy: userId
        }
      };

      // Add content for files
      if (item.type === 'file' && item.content !== undefined) {
        fileData.content = item.content;
      }

      // Set mimeType if provided
      if (item.mimeType) {
        fileData.mimeType = item.mimeType;
      }

      const createdFile = await File.create(fileData);

      // If it's a folder with children, create them recursively
      if (item.type === 'folder' && item.children && item.children.length > 0) {
        for (const child of item.children) {
          await createFileOrFolder(child, createdFile._id);
        }
      }

      return createdFile;
    } catch (error) {
      logger.error(`Error creating file/folder ${item.name}:`, error);
      throw error;
    }
  };

  // Create all root-level items
  for (const item of fileTree) {
    await createFileOrFolder(item);
  }
};

module.exports = router;