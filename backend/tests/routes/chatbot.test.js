const request = require('supertest');
const express = require('express');
const jwt = require('jsonwebtoken');
const chatbotRoutes = require('../../src/routes/chatbot');
const ChatSession = require('../../src/models/ChatSession');
const GeminiService = require('../../src/services/geminiService');
const ErrorAnalysisService = require('../../src/services/errorAnalysisService');
const ResponseProcessingService = require('../../src/services/responseProcessingService');

// Mock dependencies
jest.mock('../../src/models/ChatSession');
jest.mock('../../src/services/geminiService');
jest.mock('../../src/services/errorAnalysisService');
jest.mock('../../src/services/responseProcessingService');
jest.mock('../../src/utils/logger', () => ({
  error: jest.fn(),
  info: jest.fn(),
  warn: jest.fn()
}));

describe('Chatbot Routes', () => {
  let app;
  let mockToken;
  let mockUserId;

  beforeEach(() => {
    app = express();
    app.use(express.json());
    app.use('/api/chatbot', chatbotRoutes);

    mockUserId = 'user123';
    mockToken = jwt.sign({ id: mockUserId }, process.env.JWT_SECRET || 'test-secret');

    // Reset all mocks
    jest.clearAllMocks();
  });

  describe('POST /api/chatbot/session', () => {
    it('should create a new chat session successfully', async () => {
      const mockSession = {
        sessionId: 'session123',
        userId: mockUserId,
        projectId: 'project123',
        createdAt: new Date()
      };

      ChatSession.createSession.mockResolvedValue(mockSession);

      const response = await request(app)
        .post('/api/chatbot/session')
        .set('Authorization', `Bearer ${mockToken}`)
        .send({ projectId: 'project123' });

      expect(response.status).toBe(201);
      expect(response.body.success).toBe(true);
      expect(response.body.data.sessionId).toBe('session123');
      expect(ChatSession.createSession).toHaveBeenCalledWith(mockUserId, 'project123');
    });

    it('should return 400 for missing projectId', async () => {
      const response = await request(app)
        .post('/api/chatbot/session')
        .set('Authorization', `Bearer ${mockToken}`)
        .send({});

      expect(response.status).toBe(400);
      expect(response.body.success).toBe(false);
      expect(response.body.error).toContain('Project ID is required');
    });

    it('should return 401 for missing authorization', async () => {
      const response = await request(app)
        .post('/api/chatbot/session')
        .send({ projectId: 'project123' });

      expect(response.status).toBe(401);
    });
  });

  describe('POST /api/chatbot/query', () => {
    let mockChatSession;
    let mockGeminiService;
    let mockErrorAnalysisService;
    let mockResponseProcessingService;

    beforeEach(() => {
      mockChatSession = {
        sessionId: 'session123',
        userId: mockUserId,
        addMessage: jest.fn(),
        getRecentMessages: jest.fn().mockReturnValue([]),
        updateContext: jest.fn()
      };

      mockGeminiService = {
        generateErrorSolution: jest.fn()
      };

      mockErrorAnalysisService = {
        analyzeError: jest.fn()
      };

      mockResponseProcessingService = {
        processResponse: jest.fn()
      };

      GeminiService.mockImplementation(() => mockGeminiService);
      ErrorAnalysisService.mockImplementation(() => mockErrorAnalysisService);
      ResponseProcessingService.mockImplementation(() => mockResponseProcessingService);
    });

    it('should process a successful query with existing session', async () => {
      ChatSession.findBySessionId.mockResolvedValue(mockChatSession);
      
      mockGeminiService.generateErrorSolution.mockResolvedValue({
        success: true,
        response: 'Here is the solution to your problem.',
        metadata: { confidence: 0.9 }
      });

      mockResponseProcessingService.processResponse.mockReturnValue({
        formattedText: 'Here is the **solution** to your problem.',
        codeBlocks: [],
        suggestions: ['Try this approach'],
        links: [],
        responseType: 'text'
      });

      const response = await request(app)
        .post('/api/chatbot/query')
        .set('Authorization', `Bearer ${mockToken}`)
        .send({
          query: 'How do I fix this error?',
          sessionId: 'session123',
          projectId: 'project123',
          context: { terminalOutput: 'Error: Module not found' }
        });

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data.sessionId).toBe('session123');
      expect(response.body.data.response).toBe('Here is the solution to your problem.');
      expect(response.body.data.formattedResponse).toBe('Here is the **solution** to your problem.');
      expect(response.body.data.suggestions).toContain('Try this approach');
      expect(mockChatSession.addMessage).toHaveBeenCalledTimes(2); // user message + AI response
    });

    it('should create new session when sessionId is not provided', async () => {
      ChatSession.createSession.mockResolvedValue(mockChatSession);
      
      mockGeminiService.generateErrorSolution.mockResolvedValue({
        success: true,
        response: 'Solution for new session.',
        metadata: {}
      });

      mockResponseProcessingService.processResponse.mockReturnValue({
        formattedText: 'Solution for new session.',
        codeBlocks: [],
        suggestions: [],
        links: [],
        responseType: 'text'
      });

      const response = await request(app)
        .post('/api/chatbot/query')
        .set('Authorization', `Bearer ${mockToken}`)
        .send({
          query: 'Help me with this issue',
          projectId: 'project123'
        });

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(ChatSession.createSession).toHaveBeenCalledWith(mockUserId, 'project123');
    });

    it('should handle error analysis when terminal output is provided', async () => {
      ChatSession.findBySessionId.mockResolvedValue(mockChatSession);
      
      const mockErrorAnalysis = {
        errorType: 'MODULE_NOT_FOUND',
        severity: 'high',
        suggestions: ['Install missing dependency'],
        context: { missingModule: 'express' }
      };

      mockErrorAnalysisService.analyzeError.mockResolvedValue(mockErrorAnalysis);
      
      mockGeminiService.generateErrorSolution.mockResolvedValue({
        success: true,
        response: 'Install the missing module.',
        metadata: {}
      });

      mockResponseProcessingService.processResponse.mockReturnValue({
        formattedText: 'Install the missing module.',
        codeBlocks: [],
        suggestions: [],
        links: [],
        responseType: 'error_resolution'
      });

      const response = await request(app)
        .post('/api/chatbot/query')
        .set('Authorization', `Bearer ${mockToken}`)
        .send({
          query: 'Fix this error',
          sessionId: 'session123',
          context: {
            terminalOutput: 'Error: Cannot find module \'express\'',
            projectPath: '/path/to/project'
          }
        });

      expect(response.status).toBe(200);
      expect(response.body.data.errorType).toBe('MODULE_NOT_FOUND');
      expect(response.body.data.severity).toBe('high');
      expect(mockErrorAnalysisService.analyzeError).toHaveBeenCalledWith(
        'Error: Cannot find module \'express\'',
        expect.objectContaining({
          projectPath: '/path/to/project'
        })
      );
    });

    it('should handle Gemini API failures gracefully', async () => {
      ChatSession.findBySessionId.mockResolvedValue(mockChatSession);
      
      mockGeminiService.generateErrorSolution.mockResolvedValue({
        success: false,
        error: 'API rate limit exceeded',
        fallbackResponse: 'I\'m currently unable to generate a response. Please try again later.'
      });

      mockResponseProcessingService.processResponse.mockReturnValue({
        formattedText: 'I\'m currently unable to generate a response. Please try again later.',
        codeBlocks: [],
        suggestions: [],
        links: [],
        responseType: 'text'
      });

      const response = await request(app)
        .post('/api/chatbot/query')
        .set('Authorization', `Bearer ${mockToken}`)
        .send({
          query: 'Help me',
          sessionId: 'session123'
        });

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data.response).toContain('unable to generate');
      expect(response.body.data.metadata.fallback).toBe(true);
      expect(response.body.data.metadata.confidence).toBe('low');
    });

    it('should validate query input', async () => {
      const testCases = [
        { query: '', expectedError: 'Query is required and cannot be empty' },
        { query: '   ', expectedError: 'Query is required and cannot be empty' },
        { query: 'a'.repeat(2001), expectedError: 'Query is too long' }
      ];

      for (const testCase of testCases) {
        const response = await request(app)
          .post('/api/chatbot/query')
          .set('Authorization', `Bearer ${mockToken}`)
          .send({ query: testCase.query, sessionId: 'session123' });

        expect(response.status).toBe(400);
        expect(response.body.success).toBe(false);
        expect(response.body.error).toContain(testCase.expectedError);
      }
    });

    it('should return 404 for invalid session', async () => {
      ChatSession.findBySessionId.mockResolvedValue(null);

      const response = await request(app)
        .post('/api/chatbot/query')
        .set('Authorization', `Bearer ${mockToken}`)
        .send({
          query: 'Help me',
          sessionId: 'invalid-session'
        });

      expect(response.status).toBe(404);
      expect(response.body.success).toBe(false);
      expect(response.body.error).toContain('Chat session not found');
    });
  });

  describe('GET /api/chatbot/sessions', () => {
    it('should retrieve user sessions successfully', async () => {
      const mockSessions = [
        { sessionId: 'session1', projectId: 'project1', createdAt: new Date() },
        { sessionId: 'session2', projectId: 'project2', createdAt: new Date() }
      ];

      ChatSession.findUserSessions.mockResolvedValue(mockSessions);

      const response = await request(app)
        .get('/api/chatbot/sessions')
        .set('Authorization', `Bearer ${mockToken}`);

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data).toHaveLength(2);
      expect(ChatSession.findUserSessions).toHaveBeenCalledWith(mockUserId, 20);
    });

    it('should filter sessions by project ID', async () => {
      const mockSessions = [
        { sessionId: 'session1', projectId: 'project1', createdAt: new Date() }
      ];

      ChatSession.findProjectSessions.mockResolvedValue(mockSessions);

      const response = await request(app)
        .get('/api/chatbot/sessions?projectId=project1&limit=10')
        .set('Authorization', `Bearer ${mockToken}`);

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data).toHaveLength(1);
      expect(ChatSession.findProjectSessions).toHaveBeenCalledWith('project1', 10);
    });
  });

  describe('GET /api/chatbot/sessions/:sessionId', () => {
    it('should retrieve specific session with messages', async () => {
      const mockSession = {
        sessionId: 'session123',
        userId: mockUserId,
        messages: [
          { role: 'user', content: 'Hello', timestamp: new Date() },
          { role: 'assistant', content: 'Hi there!', timestamp: new Date() }
        ]
      };

      ChatSession.findBySessionId.mockResolvedValue(mockSession);

      const response = await request(app)
        .get('/api/chatbot/sessions/session123')
        .set('Authorization', `Bearer ${mockToken}`);

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data.sessionId).toBe('session123');
      expect(response.body.data.messages).toHaveLength(2);
    });

    it('should return 404 for non-existent session', async () => {
      ChatSession.findBySessionId.mockResolvedValue(null);

      const response = await request(app)
        .get('/api/chatbot/sessions/nonexistent')
        .set('Authorization', `Bearer ${mockToken}`);

      expect(response.status).toBe(404);
      expect(response.body.success).toBe(false);
      expect(response.body.error).toContain('Session not found');
    });

    it('should return 403 for unauthorized access to session', async () => {
      const mockSession = {
        sessionId: 'session123',
        userId: 'different-user',
        messages: []
      };

      ChatSession.findBySessionId.mockResolvedValue(mockSession);

      const response = await request(app)
        .get('/api/chatbot/sessions/session123')
        .set('Authorization', `Bearer ${mockToken}`);

      expect(response.status).toBe(403);
      expect(response.body.success).toBe(false);
      expect(response.body.error).toContain('Access denied');
    });
  });
});