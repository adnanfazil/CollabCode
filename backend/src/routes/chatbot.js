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
// Add File model for attachment support
const File = require('../models/File');

// Initialize services
const geminiService = new GeminiService();
const errorAnalysisService = new ErrorAnalysisService();
const responseProcessingService = new ResponseProcessingService();

// Attachment limits (configurable via env)
const MAX_ATTACH_FILES = parseInt(process.env.CHATBOT_MAX_ATTACH_FILES || '5', 10);
const MAX_ATTACH_BYTES = parseInt(process.env.CHATBOT_MAX_ATTACH_BYTES || '200000', 10); // ~200KB total
const MAX_PER_FILE_BYTES = parseInt(process.env.CHATBOT_MAX_PER_FILE_BYTES || '80000', 10); // ~80KB per file cap

// Utility to create a bounded preview string (head+tail) for large files
function createBoundedPreview(text, maxBytes) {
  if (!text) return '';
  const encoder = new TextEncoder();
  const buf = encoder.encode(text);
  if (buf.byteLength <= maxBytes) return text;
  // Take head and tail chunks
  const headBytes = Math.floor(maxBytes * 0.7);
  const tailBytes = maxBytes - headBytes;

  // Helper to slice by bytes respecting UTF-8 boundaries (approx by string slice)
  const takeHead = text.slice(0, Math.max(0, Math.floor(text.length * 0.7)));
  const takeTail = text.slice(Math.max(0, text.length - Math.floor(text.length * 0.25)));
  let head = takeHead;
  let tail = takeTail;
  // Ensure approx byte sizes
  let headBuf = encoder.encode(head);
  if (headBuf.byteLength > headBytes) {
    const ratio = headBytes / headBuf.byteLength;
    head = head.slice(0, Math.floor(head.length * ratio));
    headBuf = encoder.encode(head);
  }
  let tailBuf = encoder.encode(tail);
  if (tailBuf.byteLength > tailBytes) {
    const ratio = tailBytes / tailBuf.byteLength;
    tail = tail.slice(Math.max(0, tail.length - Math.floor(tail.length * ratio)));
    tailBuf = encoder.encode(tail);
  }

  return `${head}\n\n... [truncated ${buf.byteLength - (headBuf.byteLength + tailBuf.byteLength)} bytes omitted] ...\n\n${tail}`;
}

// Build an attachments context block string and metadata summary
async function buildAttachmentsContext(user, projectId, rawAttachments) {
  if (!rawAttachments || !Array.isArray(rawAttachments) || rawAttachments.length === 0) {
    return { contextBlock: '', meta: [], totalBytes: 0 };
  }

  // Helper to allow only text-like files
  const isTextLike = (file) => {
    const mt = (file.mimeType || '').toLowerCase();
    const lang = (file.language || '').toLowerCase();
    if (mt.startsWith('text/')) return true;
    const allowedMime = new Set([
      'application/json',
      'application/xml',
      'application/x-yaml',
      'application/yaml',
      'application/javascript',
      'application/typescript'
    ]);
    if (allowedMime.has(mt)) return true;
    const allowedLang = new Set([
      'javascript','typescript','tsx','jsx','python','java','kotlin','swift','ruby','go','rust','php','c','cpp','csharp','shell','bash','sh','html','css','scss','json','yaml','yml','xml','markdown','md','sql','dockerfile'
    ]);
    return allowedLang.has(lang);
  };

  // Normalize attachments to array of ids (MVP: whole-file only)
  const attachments = rawAttachments.map((a) => {
    if (typeof a === 'string') return { id: a };
    if (a && typeof a === 'object' && a.id) return { id: a.id, fromLine: a.fromLine, toLine: a.toLine };
    return null;
  }).filter(Boolean);

  if (attachments.length > MAX_ATTACH_FILES) {
    throw new Error(`Too many attachments. Max allowed is ${MAX_ATTACH_FILES}`);
  }

  const validIds = attachments
    .map(a => a.id)
    .filter(id => typeof id === 'string' && id.match(/^[0-9a-fA-F]{24}$/));

  if (validIds.length === 0) {
    return { contextBlock: '', meta: [], totalBytes: 0 };
  }

  const files = await File.find({ _id: { $in: validIds }, isDeleted: { $ne: true } })
    .populate('project', 'name owner collaborators');

  // Verify ownership/access, project consistency, and collect content
  let totalBytes = 0;
  const meta = [];
  const chunks = [];

  for (const file of files) {
    if (file.type !== 'file') {
      continue; // skip folders
    }

    // Check project match if provided
    if (projectId && file.project && file.project._id && file.project._id.toString() !== projectId) {
      throw new Error('One or more files do not belong to the specified project');
    }

    // Permission check
    const userRole = file.project.getUserRole(user._id);
    if (!file.canRead(user._id, userRole)) {
      throw new Error('Not authorized to read one or more attached files');
    }

    // Skip non-text-like files for context safety
    if (!isTextLike(file)) {
      meta.push({ fileId: file._id.toString(), name: file.name, size: file.size, language: file.language, skipped: true, reason: 'unsupported_type' });
      continue;
    }

    // Optional: respect future line ranges (MVP: full content)
    let content = file.content || '';

    // Per-file bounding
    const bounded = createBoundedPreview(content, Math.min(MAX_PER_FILE_BYTES, MAX_ATTACH_BYTES));
    const encoder = new TextEncoder();
    const boundedBytes = encoder.encode(bounded).byteLength;

    // Check overall budget
    if (totalBytes + boundedBytes > MAX_ATTACH_BYTES) {
      const remaining = Math.max(0, MAX_ATTACH_BYTES - totalBytes);
      if (remaining === 0) break;
      const furtherBounded = createBoundedPreview(content, remaining);
      const finalBytes = encoder.encode(furtherBounded).byteLength;
      chunks.push(`\n===== BEGIN FILE: ${file.name} (${file.language || file.mimeType || 'text'}) =====\n${furtherBounded}\n===== END FILE: ${file.name} =====\n`);
      meta.push({ fileId: file._id.toString(), name: file.name, size: file.size, language: file.language, truncated: true });
      totalBytes += finalBytes;
      break;
    } else {
      const truncated = bounded !== content;
      chunks.push(`\n===== BEGIN FILE: ${file.name} (${file.language || file.mimeType || 'text'}) =====\n${bounded}\n===== END FILE: ${file.name} =====\n`);
      meta.push({ fileId: file._id.toString(), name: file.name, size: file.size, language: file.language, truncated });
      totalBytes += boundedBytes;
    }
  }

  const contextBlock = chunks.join('\n');
  return { contextBlock, meta, totalBytes };
}

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
    const { query, sessionId, projectId, context = {}, attachments } = req.body;
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

    // Hydrate attachment files into context (if any)
    let attachContextBlock = '';
    let attachmentMeta = [];
    try {
      const { contextBlock, meta } = await buildAttachmentsContext(req.user, projectId, attachments);
      attachContextBlock = contextBlock;
      attachmentMeta = meta;
    } catch (attachErr) {
      logger.warn('Attachment processing error:', attachErr);
      return res.status(400).json({ success: false, error: attachErr.message || 'Invalid attachments' });
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

    // Add user message to session (include attachments metadata)
    await chatSession.addMessage('user', query, {
      timestamp: new Date(),
      context: context,
      attachments: attachmentMeta
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

    // Prepare context for Gemini (include attachments block)
    const geminiContext = {
      ...context,
      ...errorAnalysis?.context,
      errorType: errorAnalysis?.errorType,
      suggestions: errorAnalysis?.suggestions,
      conversationHistory: chatSession.getRecentMessages(5),
      fileContent: attachContextBlock,
      attachedFiles: attachmentMeta
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
        confidence: 'high',
        attachments: attachmentMeta
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
        fallback: true,
        attachments: attachmentMeta
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
        severity: errorAnalysis?.severity,
        attachments: attachmentMeta
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