const express = require('express');
const router = express.Router();
const GeminiService = require('../services/geminiService');
const ErrorAnalysisService = require('../services/errorAnalysisService');
const ResponseProcessingService = require('../services/responseProcessingService');
const ChatSession = require('../models/ChatSession');
const { protect } = require('../middleware/auth');
const auth = protect;
const logger = require('../utils/logger');
const rateLimit = require('express-rate-limit');

// Initialize services
const geminiService = new GeminiService();
const errorAnalysisService = new ErrorAnalysisService();
const responseProcessingService = new ResponseProcessingService();

// Rate limiting for chatbot endpoints
const chatbotRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 50, // Limit each user to 50 requests per windowMs
  message: {
    error: 'Too many chatbot requests, please try again later.',
    retryAfter: '15 minutes'
  },
  standardHeaders: true,
  legacyHeaders: false
});

// Apply rate limiting to all chatbot routes
router.use(chatbotRateLimit);

/**
 * POST /api/chatbot/query
 * Handle user queries and generate AI responses
 */
router.post('/query', protect, async (req, res) => {
  try {
    const { query, sessionId, projectId, context = {} } = req.body;
    const userId = req.user.id;

    // Validate input
    if (!query || query.trim().length === 0) {
      return res.status(400).json({
        success: false,
        error: 'Query is required and cannot be empty'
      });
    }

    if (query.length > 2000) {
      return res.status(400).json({
        success: false,
        error: 'Query is too long. Please limit to 2000 characters.'
      });
    }

    // Get or create chat session
    let chatSession;
    if (sessionId) {
      chatSession = await ChatSession.findBySessionId(sessionId);
      if (!chatSession || chatSession.userId.toString() !== userId) {
        return res.status(404).json({
          success: false,
          error: 'Chat session not found or access denied'
        });
      }
    } else {
      chatSession = await ChatSession.createSession(userId, projectId);
    }

    // Add user message to session
    await chatSession.addMessage('user', query, {
      timestamp: new Date(),
      context: context
    });

    // Analyze error if present
    let errorAnalysis = null;
    if (context.terminalOutput || context.errorLogs) {
      const errorText = context.terminalOutput || context.errorLogs;
      errorAnalysis = await errorAnalysisService.analyzeError(errorText, {
        projectPath: context.projectPath,
        packageJsonPath: context.packageJsonPath,
        terminalHistory: context.terminalHistory,
        environment: context.environment
      });
    }

    // Prepare context for Gemini
    const geminiContext = {
      ...context,
      ...errorAnalysis?.context,
      errorType: errorAnalysis?.errorType,
      suggestions: errorAnalysis?.suggestions,
      conversationHistory: chatSession.getRecentMessages(5)
    };

    // Generate AI response
    const aiResponse = await geminiService.generateErrorSolution(query, geminiContext);

    let responseText;
    let responseMetadata = {};
    let processedResponse = {};

    if (aiResponse.success) {
      responseText = aiResponse.response;
      responseMetadata = {
        ...aiResponse.metadata,
        errorAnalysis: errorAnalysis,
        confidence: 'high'
      };
      
      // Process the AI response for better formatting
      processedResponse = responseProcessingService.processResponse(responseText, {
        includeCodeHighlighting: true,
        extractSuggestions: true,
        formatMarkdown: true
      });
    } else {
      responseText = aiResponse.fallbackResponse;
      responseMetadata = {
        error: aiResponse.error,
        confidence: 'low',
        fallback: true
      };
      
      // Process fallback response as well
      processedResponse = responseProcessingService.processResponse(responseText, {
        includeCodeHighlighting: false,
        extractSuggestions: false,
        formatMarkdown: true
      });
    }

    // Add AI response to session
    await chatSession.addMessage('assistant', responseText, responseMetadata);

    // Update session context
    if (errorAnalysis?.context) {
      await chatSession.updateContext(errorAnalysis.context);
    }

    res.json({
      success: true,
      data: {
        sessionId: chatSession.sessionId,
        response: responseText,
        formattedResponse: processedResponse.formattedText,
        codeBlocks: processedResponse.codeBlocks,
        responseType: processedResponse.responseType,
        metadata: responseMetadata,
        suggestions: [...(errorAnalysis?.suggestions || []), ...(processedResponse.suggestions || [])],
        links: processedResponse.links || [],
        errorType: errorAnalysis?.errorType,
        severity: errorAnalysis?.severity
      }
    });

  } catch (error) {
    logger.error('Chatbot query error:', error);
    res.status(500).json({
      success: false,
      error: 'Internal server error while processing your query'
    });
  }
});

/**
 * GET /api/chatbot/sessions
 * Get user's chat sessions
 */
router.get('/sessions', protect, async (req, res) => {
  try {
    const userId = req.user.id;
    const { limit = 20, projectId } = req.query;

    let sessions;
    if (projectId) {
      sessions = await ChatSession.findProjectSessions(projectId, parseInt(limit));
    } else {
      sessions = await ChatSession.findUserSessions(userId, parseInt(limit));
    }

    res.json({
      success: true,
      data: sessions
    });

  } catch (error) {
    logger.error('Get sessions error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to retrieve chat sessions'
    });
  }
});

/**
 * POST /api/chatbot/session
 * Alias route to create a new chat session (singular path)
 */
router.post('/session', protect, async (req, res) => {
  try {
    const { projectId } = req.body;
    const userId = req.user.id;

    const chatSession = await ChatSession.createSession(userId, projectId);

    res.json({
      success: true,
      data: {
        sessionId: chatSession.sessionId,
        createdAt: chatSession.createdAt
      }
    });

  } catch (error) {
    logger.error('Create session error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to create chat session'
    });
  }
});

/**
 * GET /api/chatbot/session/:sessionId
 * Alias route to get specific chat session (singular path)
 */
router.get('/session/:sessionId', protect, async (req, res) => {
  try {
    const { sessionId } = req.params;
    const userId = req.user.id;

    const session = await ChatSession.findBySessionId(sessionId);

    if (!session) {
      return res.status(404).json({
        success: false,
        error: 'Chat session not found'
      });
    }

    if (session.userId.toString() !== userId) {
      return res.status(403).json({
        success: false,
        error: 'Access denied to this chat session'
      });
    }

    res.json({
      success: true,
      data: {
        sessionId: session.sessionId,
        title: session.title,
        messages: session.getConversationHistory(true),
        context: session.context,
        createdAt: session.createdAt,
        updatedAt: session.updatedAt,
        messageCount: session.messageCount
      }
    });

  } catch (error) {
    logger.error('Get session alias error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to retrieve chat session'
    });
  }
});

/**
 * GET /api/chatbot/sessions/:sessionId
 * Get specific chat session with full message history
 */
router.get('/sessions/:sessionId', protect, async (req, res) => {
  try {
    const { sessionId } = req.params;
    const userId = req.user.id;

    const session = await ChatSession.findBySessionId(sessionId);
    
    if (!session) {
      return res.status(404).json({
        success: false,
        error: 'Chat session not found'
      });
    }

    if (session.userId.toString() !== userId) {
      return res.status(403).json({
        success: false,
        error: 'Access denied to this chat session'
      });
    }

    res.json({
      success: true,
      data: {
        sessionId: session.sessionId,
        title: session.title,
        messages: session.getConversationHistory(true),
        context: session.context,
        createdAt: session.createdAt,
        updatedAt: session.updatedAt,
        messageCount: session.messageCount
      }
    });

  } catch (error) {
    logger.error('Get session error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to retrieve chat session'
    });
  }
});

/**
 * POST /api/chatbot/sessions/:sessionId/feedback
 * Add feedback to a chat session
 */
router.post('/sessions/:sessionId/feedback', protect, async (req, res) => {
  try {
    const { sessionId } = req.params;
    const { rating, comment, helpful } = req.body;
    const userId = req.user.id;

    // Validate feedback data
    if (rating && (rating < 1 || rating > 5)) {
      return res.status(400).json({
        success: false,
        error: 'Rating must be between 1 and 5'
      });
    }

    const session = await ChatSession.findBySessionId(sessionId);
    
    if (!session) {
      return res.status(404).json({
        success: false,
        error: 'Chat session not found'
      });
    }

    if (session.userId.toString() !== userId) {
      return res.status(403).json({
        success: false,
        error: 'Access denied to this chat session'
      });
    }

    await session.addFeedback(rating, comment, helpful);

    res.json({
      success: true,
      message: 'Feedback added successfully'
    });

  } catch (error) {
    logger.error('Add feedback error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to add feedback'
    });
  }
});

/**
 * DELETE /api/chatbot/sessions/:sessionId
 * Delete a chat session
 */
router.delete('/sessions/:sessionId', protect, async (req, res) => {
  try {
    const { sessionId } = req.params;
    const userId = req.user.id;

    const session = await ChatSession.findBySessionId(sessionId);
    
    if (!session) {
      return res.status(404).json({
        success: false,
        error: 'Chat session not found'
      });
    }

    if (session.userId.toString() !== userId) {
      return res.status(403).json({
        success: false,
        error: 'Access denied to this chat session'
      });
    }

    session.status = 'deleted';
    await session.save();

    res.json({
      success: true,
      message: 'Chat session deleted successfully'
    });

  } catch (error) {
    logger.error('Delete session error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to delete chat session'
    });
  }
});

/**
 * POST /api/chatbot/analyze-error
 * Analyze error without creating a chat session
 */
router.post('/analyze-error', protect, async (req, res) => {
  try {
    const { errorText, context = {} } = req.body;

    if (!errorText || errorText.trim().length === 0) {
      return res.status(400).json({
        success: false,
        error: 'Error text is required'
      });
    }

    const analysis = await errorAnalysisService.analyzeError(errorText, context);

    res.json({
      success: true,
      data: analysis
    });

  } catch (error) {
    logger.error('Error analysis error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to analyze error'
    });
  }
});

/**
 * GET /api/chatbot/stats
 * Get user's chatbot usage statistics
 */
router.get('/stats', protect, async (req, res) => {
  try {
    const userId = req.user.id;
    const stats = await ChatSession.getSessionStats(userId);

    res.json({
      success: true,
      data: stats
    });

  } catch (error) {
    logger.error('Get stats error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to retrieve statistics'
    });
  }
});

/**
 * POST /api/chatbot/validate-connection
 * Test Gemini API connection
 */
router.post('/validate-connection', protect, async (req, res) => {
  try {
    const isValid = await geminiService.validateConnection();

    res.json({
      success: true,
      data: {
        connected: isValid,
        timestamp: new Date().toISOString()
      }
    });

  } catch (error) {
    logger.error('Connection validation error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to validate connection'
    });
  }
});

/**
 * POST /api/chatbot/sessions/:sessionId/regenerate
 * Regenerate the last AI response
 */
router.post('/sessions/:sessionId/regenerate', protect, async (req, res) => {
  try {
    const { sessionId } = req.params;
    const userId = req.user.id;

    const session = await ChatSession.findBySessionId(sessionId);
    
    if (!session) {
      return res.status(404).json({
        success: false,
        error: 'Chat session not found'
      });
    }

    if (session.userId.toString() !== userId) {
      return res.status(403).json({
        success: false,
        error: 'Access denied to this chat session'
      });
    }

    if (session.messages.length < 2) {
      return res.status(400).json({
        success: false,
        error: 'No previous conversation to regenerate'
      });
    }

    // Get the last user message
    const lastUserMessage = session.messages
      .filter(msg => msg.role === 'user')
      .pop();

    if (!lastUserMessage) {
      return res.status(400).json({
        success: false,
        error: 'No user message found to regenerate response'
      });
    }

    // Remove the last assistant message if it exists
    if (session.messages[session.messages.length - 1].role === 'assistant') {
      session.messages.pop();
    }

    // Prepare context
    const geminiContext = {
      ...session.context,
      conversationHistory: session.getRecentMessages(5)
    };

    // Generate new AI response
    const aiResponse = await geminiService.generateErrorSolution(
      lastUserMessage.content, 
      geminiContext
    );

    let responseText;
    let responseMetadata = {};

    if (aiResponse.success) {
      responseText = aiResponse.response;
      responseMetadata = {
        ...aiResponse.metadata,
        regenerated: true,
        confidence: 'high'
      };
    } else {
      responseText = aiResponse.fallbackResponse;
      responseMetadata = {
        error: aiResponse.error,
        confidence: 'low',
        fallback: true,
        regenerated: true
      };
    }

    // Add new AI response to session
    await session.addMessage('assistant', responseText, responseMetadata);

    res.json({
      success: true,
      data: {
        response: responseText,
        metadata: responseMetadata
      }
    });

  } catch (error) {
    logger.error('Regenerate response error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to regenerate response'
    });
  }
});

module.exports = router;