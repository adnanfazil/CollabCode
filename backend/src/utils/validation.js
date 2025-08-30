const { body, param, query } = require('express-validator');

// Common validation patterns
const patterns = {
  email: /^[^\s@]+@[^\s@]+\.[^\s@]+$/,
  password: /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])[A-Za-z\d@$!%*?&]{8,}$/,
  filename: /^[^<>:"/\\|?*]+$/,
  projectName: /^[a-zA-Z0-9\s\-_]+$/,
  mongoId: /^[0-9a-fA-F]{24}$/
};

// User validation schemas
const userValidation = {
  register: [
    body('name')
      .trim()
      .isLength({ min: 2, max: 50 })
      .withMessage('Name must be between 2 and 50 characters')
      .matches(/^[a-zA-Z\s]+$/)
      .withMessage('Name can only contain letters and spaces'),
    body('email')
      .trim()
      .toLowerCase()
      .isEmail()
      .withMessage('Please provide a valid email')
      .normalizeEmail(),
    body('password')
      .isLength({ min: 8 })
      .withMessage('Password must be at least 8 characters long')
      .matches(patterns.password)
      .withMessage('Password must contain at least one uppercase letter, one lowercase letter, one number, and one special character')
  ],
  
  login: [
    body('email')
      .trim()
      .toLowerCase()
      .isEmail()
      .withMessage('Please provide a valid email')
      .normalizeEmail(),
    body('password')
      .notEmpty()
      .withMessage('Password is required')
  ],
  
  updateProfile: [
    body('name')
      .optional()
      .trim()
      .isLength({ min: 2, max: 50 })
      .withMessage('Name must be between 2 and 50 characters')
      .matches(/^[a-zA-Z\s]+$/)
      .withMessage('Name can only contain letters and spaces'),
    body('email')
      .optional()
      .trim()
      .toLowerCase()
      .isEmail()
      .withMessage('Please provide a valid email')
      .normalizeEmail(),
    body('preferences')
      .optional()
      .isObject()
      .withMessage('Preferences must be an object'),
    body('preferences.theme')
      .optional()
      .isIn(['light', 'dark', 'auto'])
      .withMessage('Theme must be light, dark, or auto'),
    body('preferences.language')
      .optional()
      .isString()
      .withMessage('Language must be a string'),
    body('preferences.notifications')
      .optional()
      .isBoolean()
      .withMessage('Notifications must be a boolean')
  ],
  
  changePassword: [
    body('currentPassword')
      .notEmpty()
      .withMessage('Current password is required'),
    body('newPassword')
      .isLength({ min: 8 })
      .withMessage('New password must be at least 8 characters long')
      .matches(patterns.password)
      .withMessage('New password must contain at least one uppercase letter, one lowercase letter, one number, and one special character'),
    body('confirmPassword')
      .custom((value, { req }) => {
        if (value !== req.body.newPassword) {
          throw new Error('Password confirmation does not match new password');
        }
        return true;
      })
  ]
};

// Project validation schemas
const projectValidation = {
  create: [
    body('name')
      .trim()
      .isLength({ min: 1, max: 100 })
      .withMessage('Project name must be between 1 and 100 characters')
      .matches(patterns.projectName)
      .withMessage('Project name can only contain letters, numbers, spaces, hyphens, and underscores'),
    body('description')
      .optional()
      .trim()
      .isLength({ max: 500 })
      .withMessage('Description cannot exceed 500 characters'),
    body('programmingLanguage')
      .optional()
      .isIn(['js', 'jsx', 'typescript', 'python', 'java', 'cpp', 'csharp', 'go', 'rust', 'php', 'ruby', 'other'])
      .withMessage('Invalid programming language'),
    body('template')
      .optional()
      .isIn(['blank', 'react', 'node', 'python', 'html'])
      .withMessage('Invalid project template'),
    body('isPublic')
      .optional()
      .isBoolean()
      .withMessage('isPublic must be a boolean'),
    body('tags')
      .optional()
      .isArray()
      .withMessage('Tags must be an array'),
    body('tags.*')
      .optional()
      .trim()
      .isLength({ min: 1, max: 20 })
      .withMessage('Each tag must be between 1 and 20 characters')
  ],
  
  update: [
    body('name')
      .optional()
      .trim()
      .isLength({ min: 1, max: 100 })
      .withMessage('Project name must be between 1 and 100 characters')
      .matches(patterns.projectName)
      .withMessage('Project name can only contain letters, numbers, spaces, hyphens, and underscores'),
    body('description')
      .optional()
      .trim()
      .isLength({ max: 500 })
      .withMessage('Description cannot exceed 500 characters'),
    body('isPublic')
      .optional()
      .isBoolean()
      .withMessage('isPublic must be a boolean'),
    body('tags')
      .optional()
      .isArray()
      .withMessage('Tags must be an array'),
    body('tags.*')
      .optional()
      .trim()
      .isLength({ min: 1, max: 20 })
      .withMessage('Each tag must be between 1 and 20 characters'),
    body('settings')
      .optional()
      .isObject()
      .withMessage('Settings must be an object'),
    body('settings.autoSave')
      .optional()
      .isBoolean()
      .withMessage('autoSave must be a boolean'),
    body('settings.theme')
      .optional()
      .isIn(['light', 'dark', 'auto'])
      .withMessage('Theme must be light, dark, or auto'),
    body('settings.fontSize')
      .optional()
      .isInt({ min: 8, max: 24 })
      .withMessage('Font size must be between 8 and 24'),
    body('settings.tabSize')
      .optional()
      .isInt({ min: 1, max: 8 })
      .withMessage('Tab size must be between 1 and 8')
  ],
  
  addCollaborator: [
    body('email')
      .trim()
      .toLowerCase()
      .isEmail()
      .withMessage('Please provide a valid email')
      .normalizeEmail(),
    body('role')
      .isIn(['viewer', 'editor'])
      .withMessage('Role must be either viewer or editor')
  ]
};

// File validation schemas
const fileValidation = {
  create: [
    body('name')
      .trim()
      .isLength({ min: 1, max: 255 })
      .withMessage('File name must be between 1 and 255 characters')
      .matches(patterns.filename)
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
      .custom((value) => {
        if (value === null || value === '') return true;
        if (!patterns.mongoId.test(value)) {
          throw new Error('Parent must be a valid ID or null');
        }
        return true;
      }),
    body('isReadOnly')
      .optional()
      .isBoolean()
      .withMessage('isReadOnly must be a boolean')
  ],
  
  update: [
    body('name')
      .optional()
      .trim()
      .isLength({ min: 1, max: 255 })
      .withMessage('File name must be between 1 and 255 characters')
      .matches(patterns.filename)
      .withMessage('File name contains invalid characters'),
    body('content')
      .optional()
      .isString()
      .withMessage('Content must be a string'),
    body('isReadOnly')
      .optional()
      .isBoolean()
      .withMessage('isReadOnly must be a boolean')
  ],
  
  move: [
    body('parent')
      .optional()
      .custom((value) => {
        if (value === null || value === '') return true;
        if (!patterns.mongoId.test(value)) {
          throw new Error('Parent must be a valid ID or null');
        }
        return true;
      })
  ]
};

// Common parameter validations
const paramValidation = {
  mongoId: (paramName = 'id') => [
    param(paramName)
      .isMongoId()
      .withMessage(`Invalid ${paramName}`)
  ]
};

// Common query validations
const queryValidation = {
  pagination: [
    query('page')
      .optional()
      .isInt({ min: 1 })
      .withMessage('Page must be a positive integer'),
    query('limit')
      .optional()
      .isInt({ min: 1, max: 100 })
      .withMessage('Limit must be between 1 and 100')
  ],
  
  search: [
    query('q')
      .optional()
      .trim()
      .isLength({ min: 1, max: 100 })
      .withMessage('Search query must be between 1 and 100 characters')
  ],
  
  sort: [
    query('sort')
      .optional()
      .isIn(['name', 'createdAt', 'updatedAt', 'size', '-name', '-createdAt', '-updatedAt', '-size'])
      .withMessage('Invalid sort field')
  ]
};

// Custom validation functions
const customValidators = {
  // Check if email is unique (for registration)
  isEmailUnique: async (email, { req }) => {
    const User = require('../models/User');
    const existingUser = await User.findOne({ email });
    if (existingUser && (!req.user || existingUser._id.toString() !== req.user._id.toString())) {
      throw new Error('Email is already registered');
    }
    return true;
  },
  
  // Check if project name is unique for user
  isProjectNameUnique: async (name, { req }) => {
    const Project = require('../models/Project');
    const existingProject = await Project.findOne({
      name,
      owner: req.user._id,
      isArchived: false
    });
    if (existingProject && (!req.params.id || existingProject._id.toString() !== req.params.id)) {
      throw new Error('Project name already exists');
    }
    return true;
  },
  
  // Validate file size
  validateFileSize: (maxSizeInMB = 10) => {
    return (value) => {
      if (value && value.length > maxSizeInMB * 1024 * 1024) {
        throw new Error(`File content cannot exceed ${maxSizeInMB}MB`);
      }
      return true;
    };
  },
  
  // Validate array length
  validateArrayLength: (min = 0, max = 10) => {
    return (value) => {
      if (Array.isArray(value) && (value.length < min || value.length > max)) {
        throw new Error(`Array must have between ${min} and ${max} items`);
      }
      return true;
    };
  }
};

// Sanitization functions
const sanitizers = {
  // Remove HTML tags and trim whitespace
  sanitizeText: (text) => {
    if (typeof text !== 'string') return text;
    return text.replace(/<[^>]*>/g, '').trim();
  },
  
  // Normalize file name
  normalizeFileName: (fileName) => {
    if (typeof fileName !== 'string') return fileName;
    return fileName
      .trim()
      .replace(/[<>:"/\\|?*]/g, '_')
      .replace(/\s+/g, '_')
      .toLowerCase();
  },
  
  // Normalize project name
  normalizeProjectName: (projectName) => {
    if (typeof projectName !== 'string') return projectName;
    return projectName
      .trim()
      .replace(/\s+/g, ' ')
      .replace(/[^a-zA-Z0-9\s\-_]/g, '');
  }
};

module.exports = {
  patterns,
  userValidation,
  projectValidation,
  fileValidation,
  paramValidation,
  queryValidation,
  customValidators,
  sanitizers
};