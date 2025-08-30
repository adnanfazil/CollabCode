const jwt = require('jsonwebtoken');
const { AppError } = require('./errorHandler');
const User = require('../models/User');
const logger = require('../utils/logger');

// Protect routes - verify JWT token
const protect = async (req, res, next) => {
  try {
    // 1) Getting token and check if it's there
    let token;
    const authHeader = req.headers.authorization || req.headers.Authorization;
    if (authHeader && typeof authHeader === 'string') {
      const parts = authHeader.split(' ');
      if (parts.length === 2 && /^Bearer$/i.test(parts[0])) {
        token = parts[1];
      } else {
        // Allow raw token in Authorization header for flexibility
        token = authHeader;
      }
    }

    if (!token) {
      token =
        req.headers['x-access-token'] ||
        (req.query ? req.query.token : undefined) ||
        (req.body ? req.body.token : undefined);
    }

    if (typeof token === 'string') {
      token = token.trim().replace(/^"|"$/g, '');
    }

    if (!token || token === 'undefined' || token === 'null') {
      return next(
        new AppError('You are not logged in! Please log in to get access.', 401)
      );
    }

    // Basic JWT shape validation to provide clearer errors before verify
    if (typeof token !== 'string' || token.split('.').length !== 3) {
      logger.warn('Received malformed JWT in Authorization header');
      return next(new AppError('Malformed token. Expected Authorization: Bearer <jwt>', 401));
    }

    // 2) Verification token
    let decoded;
    try {
      decoded = jwt.verify(token, process.env.JWT_SECRET);
    } catch (jwtError) {
      if (jwtError.name === 'JsonWebTokenError') {
        return next(new AppError('Invalid token format. Please log in again!', 401));
      }
      if (jwtError.name === 'TokenExpiredError') {
        return next(new AppError('Token has expired. Please log in again!', 401));
      }
      throw jwtError;
    }

    // 3) Check if user still exists
    const currentUser = await User.findById(decoded.id).select('-password');
    if (!currentUser) {
      return next(
        new AppError(
          'The user belonging to this token does no longer exist.',
          401
        )
      );
    }

    // 4) Check if user changed password after the token was issued
    if (currentUser.changedPasswordAfter(decoded.iat)) {
      return next(
        new AppError('User recently changed password! Please log in again.', 401)
      );
    }

    // Grant access to protected route
    req.user = currentUser;
    next();
  } catch (error) {
    logger.error('Authentication error:', error);
    if (error.name === 'JsonWebTokenError') {
      return next(new AppError('Malformed token. Please log in again!', 401));
    }
    if (error.name === 'TokenExpiredError') {
      return next(new AppError('Token expired. Please log in again!', 401));
    }
    return next(new AppError('Authentication failed. Please log in again!', 401));
  }
};

// Restrict to certain roles
const restrictTo = (...roles) => {
  return (req, res, next) => {
    if (!roles.includes(req.user.role)) {
      return next(
        new AppError('You do not have permission to perform this action', 403)
      );
    }
    next();
  };
};

// Optional authentication - doesn't fail if no token
const optionalAuth = async (req, res, next) => {
  try {
    let token;
    if (
      req.headers.authorization &&
      req.headers.authorization.startsWith('Bearer')
    ) {
      token = req.headers.authorization.split(' ')[1];
      
      if (token) {
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        const currentUser = await User.findById(decoded.id).select('-password');
        
        if (currentUser && !currentUser.changedPasswordAfter(decoded.iat)) {
          req.user = currentUser;
        }
      }
    }
    next();
  } catch (error) {
    // Continue without authentication if token is invalid
    next();
  }
};

// Check if user owns the resource or is admin
const checkOwnership = (resourceModel, resourceIdParam = 'id') => {
  return async (req, res, next) => {
    try {
      const resource = await resourceModel.findById(req.params[resourceIdParam]);
      
      if (!resource) {
        return next(new AppError('Resource not found', 404));
      }
      
      // Check if user owns the resource or is admin
      if (
        resource.owner?.toString() !== req.user._id.toString() &&
        resource.userId?.toString() !== req.user._id.toString() &&
        req.user.role !== 'admin'
      ) {
        return next(
          new AppError('You do not have permission to access this resource', 403)
        );
      }
      
      req.resource = resource;
      next();
    } catch (error) {
      logger.error('Ownership check error:', error);
      return next(new AppError('Error checking resource ownership', 500));
    }
  };
};

module.exports = {
  protect,
  restrictTo,
  optionalAuth,
  checkOwnership
};