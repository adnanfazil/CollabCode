const express = require('express');
const { body, validationResult } = require('express-validator');
const completionService = require('../services/streamingCompletionService');
const { protect } = require('../middleware/auth');
const { enhanceMonacoContext, formatMonacoResponse } = require('../middleware/monacoIntegration');
const logger = require('../utils/logger');

const router = express.Router();

// Validation middleware for completion requests
const validateCompletionRequest = [
  body('code')
    .isString()
    .isLength({ min: 1, max: 10000 })
    .withMessage('Code must be a string between 1 and 10000 characters'),
  body('language')
    .isString()
    .isIn(['javascript', 'typescript', 'python', 'java', 'cpp', 'c', 'csharp', 'go', 'rust', 'php', 'ruby', 'swift', 'kotlin', 'html', 'css', 'json', 'yaml', 'xml', 'sql', 'shell', 'dockerfile', 'markdown'])
    .withMessage('Language must be a supported programming language'),
  body('cursorPosition')
    .isObject()
    .withMessage('Cursor position must be an object'),
  body('cursorPosition.line')
    .isInt({ min: 1 })
    .withMessage('Cursor line must be a positive integer'),
  body('cursorPosition.column')
    .isInt({ min: 0 })
    .withMessage('Cursor column must be a non-negative integer'),
  body('maxTokens')
    .optional()
    .isInt({ min: 1, max: 500 })
    .withMessage('Max tokens must be between 1 and 500'),
  body('temperature')
    .optional()
    .isFloat({ min: 0, max: 2 })
    .withMessage('Temperature must be between 0 and 2'),
  body('context')
    .optional()
    .isObject()
    .withMessage('Context must be an object'),
];

// Rate limiting for completion requests
const completionRateLimit = require('express-rate-limit')({
  windowMs: 60 * 1000, // 1 minute
  max: 30, // 30 requests per minute per user
  message: {
    error: 'Too many completion requests. Please wait before requesting more completions.',
    retryAfter: 60
  },
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => req.user?.id || req.ip,
});

/**
 * @route   POST /api/completions/generate
 * @desc    Generate streaming code completion
 * @access  Private
 */
router.post('/generate', 
  protect,
  completionRateLimit,
  validateCompletionRequest,
  enhanceMonacoContext,
  formatMonacoResponse,
  async (req, res) => {
    try {
      // Check validation errors
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({
          success: false,
          message: 'Validation failed',
          errors: errors.array()
        });
      }

      const { code, language, cursorPosition, maxTokens, temperature, context } = req.body;
      const userId = req.user.id;

      // Set up Server-Sent Events (SSE) for streaming
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Cache-Control'
      });

      // Send initial connection confirmation
      res.write(`data: ${JSON.stringify({ type: 'connected', timestamp: Date.now() })}\n\n`);

      try {
        // Generate streaming completion
        const completionGenerator = completionService.generateCompletion(
          code,
          language,
          '' // filename - could be derived from context if available
        );

        let completionText = '';
        let tokenCount = 0;

        // Stream tokens to client
        for await (const chunk of completionGenerator) {
          // Check if client disconnected
          if (req.destroyed || res.destroyed) {
            logger.info(`Client disconnected during completion generation for user ${userId}`);
            break;
          }

          if (chunk && chunk.token) {
            completionText = chunk.completionText || '';
            tokenCount++;

            // Send token to client
            const data = {
              type: 'token',
              token: chunk.token,
              completionText: chunk.completionText,
              tokenCount,
              timestamp: Date.now(),
              done: chunk.done
            };

            res.write(`data: ${JSON.stringify(data)}\n\n`);

            // If completion is done or has error, break
            if (chunk.done || chunk.error) {
              break;
            }
          }
        }

        // Send completion finished event
        const finalData = {
          type: 'completed',
          completionText,
          tokenCount,
          timestamp: Date.now()
        };

        res.write(`data: ${JSON.stringify(finalData)}\n\n`);
        res.end();

        logger.info(`Completion generated successfully for user ${userId}, tokens: ${tokenCount}`);

      } catch (completionError) {
        logger.error('Error during completion generation:', completionError);
        
        const errorData = {
          type: 'error',
          message: 'Failed to generate completion',
          timestamp: Date.now()
        };

        res.write(`data: ${JSON.stringify(errorData)}\n\n`);
        res.end();
      }

    } catch (error) {
      logger.error('Error in completion route:', error);
      
      if (!res.headersSent) {
        return res.status(500).json({
          success: false,
          message: 'Internal server error during completion generation'
        });
      }
    }
  }
);

/**
 * @route   GET /api/completions/stats
 * @desc    Get completion service statistics
 * @access  Private
 */
router.get('/stats', protect, async (req, res) => {
  try {
    const stats = completionService.getStats();
    
    res.json({
      success: true,
      data: stats
    });
  } catch (error) {
    logger.error('Error fetching completion stats:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch completion statistics'
    });
  }
});

/**
 * @route   POST /api/completions/validate
 * @desc    Validate completion request without generating
 * @access  Private
 */
router.post('/validate', 
  protect,
  validateCompletionRequest,
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({
          success: false,
          message: 'Validation failed',
          errors: errors.array()
        });
      }

      const { code, language, cursorPosition } = req.body;
      
      // Validate request using service
      const validation = completionService.validateRequest({
        code,
        language,
        cursorPosition
      });

      if (!validation.isValid) {
        return res.status(400).json({
          success: false,
          message: 'Request validation failed',
          errors: validation.errors
        });
      }

      res.json({
        success: true,
        message: 'Request is valid',
        data: {
          codeLength: code.length,
          language,
          cursorPosition
        }
      });

    } catch (error) {
      logger.error('Error validating completion request:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to validate completion request'
      });
    }
  }
);

module.exports = router;