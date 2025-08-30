const express = require('express');
const { body, query, validationResult } = require('express-validator');
const User = require('../models/User');
const Project = require('../models/Project');
const { AppError } = require('../middleware/errorHandler');
const { protect, restrictTo } = require('../middleware/auth');
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

// @desc    Get all users (Admin only)
// @route   GET /api/users
// @access  Private/Admin
router.get('/', protect, restrictTo('admin'), [
  query('page')
    .optional()
    .isInt({ min: 1 })
    .withMessage('Page must be a positive integer'),
  query('limit')
    .optional()
    .isInt({ min: 1, max: 100 })
    .withMessage('Limit must be between 1 and 100'),
  query('search')
    .optional()
    .trim()
    .isLength({ min: 1 })
    .withMessage('Search term must not be empty'),
  query('role')
    .optional()
    .isIn(['user', 'admin'])
    .withMessage('Role must be either user or admin'),
  query('isActive')
    .optional()
    .isBoolean()
    .withMessage('isActive must be a boolean')
], handleValidationErrors, async (req, res, next) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const skip = (page - 1) * limit;
    const { search, role, isActive } = req.query;
    
    // Build query
    const query = {};
    
    if (search) {
      query.$or = [
        { name: { $regex: search, $options: 'i' } },
        { email: { $regex: search, $options: 'i' } }
      ];
    }
    
    if (role) {
      query.role = role;
    }
    
    if (isActive !== undefined) {
      query.isActive = isActive === 'true';
    }
    
    // Get users with pagination
    const users = await User.find(query)
      .select('-password')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .populate('projects', 'name description language');
    
    // Get total count for pagination
    const total = await User.countDocuments(query);
    
    res.status(200).json({
      success: true,
      data: {
        users,
        pagination: {
          page,
          limit,
          total,
          pages: Math.ceil(total / limit)
        }
      }
    });
  } catch (error) {
    logger.error('Get users error:', error);
    next(error);
  }
});

// @desc    Get user by ID
// @route   GET /api/users/:id
// @access  Private
router.get('/:id', protect, async (req, res, next) => {
  try {
    const user = await User.findById(req.params.id)
      .select('-password')
      .populate('projects', 'name description language createdAt');
    
    if (!user) {
      return next(new AppError('User not found', 404));
    }
    
    // Users can only view their own profile unless they're admin
    if (req.user._id.toString() !== user._id.toString() && req.user.role !== 'admin') {
      return next(new AppError('Not authorized to view this profile', 403));
    }
    
    res.status(200).json({
      success: true,
      data: { user }
    });
  } catch (error) {
    logger.error('Get user by ID error:', error);
    next(error);
  }
});

// @desc    Update user (Admin only)
// @route   PUT /api/users/:id
// @access  Private/Admin
router.put('/:id', protect, restrictTo('admin'), [
  body('name')
    .optional()
    .trim()
    .isLength({ min: 2, max: 50 })
    .withMessage('Name must be between 2 and 50 characters'),
  body('email')
    .optional()
    .isEmail()
    .normalizeEmail()
    .withMessage('Please provide a valid email'),
  body('role')
    .optional()
    .isIn(['user', 'admin'])
    .withMessage('Role must be either user or admin'),
  body('isActive')
    .optional()
    .isBoolean()
    .withMessage('isActive must be a boolean')
], handleValidationErrors, async (req, res, next) => {
  try {
    const { name, email, role, isActive } = req.body;
    
    // Check if user exists
    const user = await User.findById(req.params.id);
    if (!user) {
      return next(new AppError('User not found', 404));
    }
    
    // Check if email is already taken by another user
    if (email) {
      const existingUser = await User.findOne({ 
        email, 
        _id: { $ne: req.params.id } 
      });
      if (existingUser) {
        return next(new AppError('Email is already taken', 400));
      }
    }
    
    // Prevent admin from deactivating themselves
    if (req.user._id.toString() === user._id.toString() && isActive === false) {
      return next(new AppError('You cannot deactivate your own account', 400));
    }
    
    // Update user
    const updateData = {};
    if (name) updateData.name = name;
    if (email) updateData.email = email;
    if (role) updateData.role = role;
    if (isActive !== undefined) updateData.isActive = isActive;
    
    const updatedUser = await User.findByIdAndUpdate(
      req.params.id,
      updateData,
      { new: true, runValidators: true }
    ).select('-password');
    
    logger.info(`User updated by admin: ${updatedUser.email}`);
    
    res.status(200).json({
      success: true,
      message: 'User updated successfully',
      data: { user: updatedUser }
    });
  } catch (error) {
    logger.error('Update user error:', error);
    next(error);
  }
});

// @desc    Delete user (Admin only)
// @route   DELETE /api/users/:id
// @access  Private/Admin
router.delete('/:id', protect, restrictTo('admin'), async (req, res, next) => {
  try {
    const user = await User.findById(req.params.id);
    if (!user) {
      return next(new AppError('User not found', 404));
    }
    
    // Prevent admin from deleting themselves
    if (req.user._id.toString() === user._id.toString()) {
      return next(new AppError('You cannot delete your own account', 400));
    }
    
    // Check if user has projects
    const projectCount = await Project.countDocuments({ owner: user._id });
    if (projectCount > 0) {
      return next(new AppError(
        `Cannot delete user. User owns ${projectCount} project(s). Please transfer or delete projects first.`,
        400
      ));
    }
    
    await User.findByIdAndDelete(req.params.id);
    
    logger.info(`User deleted by admin: ${user.email}`);
    
    res.status(200).json({
      success: true,
      message: 'User deleted successfully'
    });
  } catch (error) {
    logger.error('Delete user error:', error);
    next(error);
  }
});

// @desc    Get user statistics (Admin only)
// @route   GET /api/users/stats
// @access  Private/Admin
router.get('/admin/stats', protect, restrictTo('admin'), async (req, res, next) => {
  try {
    const stats = await User.getUserStats();
    
    // Get additional stats
    const recentUsers = await User.find()
      .select('name email createdAt')
      .sort({ createdAt: -1 })
      .limit(5);
    
    const usersByMonth = await User.aggregate([
      {
        $group: {
          _id: {
            year: { $year: '$createdAt' },
            month: { $month: '$createdAt' }
          },
          count: { $sum: 1 }
        }
      },
      {
        $sort: { '_id.year': -1, '_id.month': -1 }
      },
      {
        $limit: 12
      }
    ]);
    
    res.status(200).json({
      success: true,
      data: {
        stats,
        recentUsers,
        usersByMonth
      }
    });
  } catch (error) {
    logger.error('Get user stats error:', error);
    next(error);
  }
});

// @desc    Search users
// @route   GET /api/users/search
// @access  Private
router.get('/search/query', protect, [
  query('q')
    .notEmpty()
    .trim()
    .isLength({ min: 2 })
    .withMessage('Search query must be at least 2 characters'),
  query('limit')
    .optional()
    .isInt({ min: 1, max: 20 })
    .withMessage('Limit must be between 1 and 20')
], handleValidationErrors, async (req, res, next) => {
  try {
    const { q, limit = 10 } = req.query;
    
    const users = await User.find({
      $and: [
        {
          $or: [
            { name: { $regex: q, $options: 'i' } },
            { email: { $regex: q, $options: 'i' } }
          ]
        },
        { isActive: true },
        { _id: { $ne: req.user._id } } // Exclude current user
      ]
    })
    .select('name email avatar')
    .limit(parseInt(limit));
    
    res.status(200).json({
      success: true,
      data: { users }
    });
  } catch (error) {
    logger.error('Search users error:', error);
    next(error);
  }
});

// @desc    Get user's projects
// @route   GET /api/users/:id/projects
// @access  Private
router.get('/:id/projects', protect, [
  query('page')
    .optional()
    .isInt({ min: 1 })
    .withMessage('Page must be a positive integer'),
  query('limit')
    .optional()
    .isInt({ min: 1, max: 50 })
    .withMessage('Limit must be between 1 and 50')
], handleValidationErrors, async (req, res, next) => {
  try {
    const userId = req.params.id;
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const skip = (page - 1) * limit;
    
    // Check if user exists
    const user = await User.findById(userId);
    if (!user) {
      return next(new AppError('User not found', 404));
    }
    
    // Users can only view their own projects unless they're admin
    if (req.user._id.toString() !== userId && req.user.role !== 'admin') {
      return next(new AppError('Not authorized to view these projects', 403));
    }
    
    // Get user's projects
    const projects = await Project.findUserProjects(userId)
      .skip(skip)
      .limit(limit);
    
    // Get total count
    const total = await Project.countDocuments({
      $or: [
        { owner: userId },
        { 'collaborators.user': userId }
      ],
      isArchived: { $ne: true }
    });
    
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
    logger.error('Get user projects error:', error);
    next(error);
  }
});

module.exports = router;