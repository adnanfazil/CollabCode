// Test setup file for Jest
require('dotenv').config({ path: '.env.test' });

// Mock environment variables for testing
process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test-jwt-secret-key-for-testing-only';
process.env.GEMINI_API_KEY = 'test-gemini-api-key';
process.env.MONGODB_URI = 'mongodb://localhost:27017/collabcode_test';
process.env.REDIS_URL = 'redis://localhost:6379/1';

// Global test utilities
global.testUtils = {
  // Helper to create mock user data
  createMockUser: (overrides = {}) => ({
    id: 'user123',
    email: 'test@example.com',
    username: 'testuser',
    createdAt: new Date(),
    ...overrides
  }),

  // Helper to create mock project data
  createMockProject: (overrides = {}) => ({
    id: 'project123',
    name: 'Test Project',
    description: 'A test project',
    userId: 'user123',
    createdAt: new Date(),
    ...overrides
  }),

  // Helper to create mock chat session
  createMockChatSession: (overrides = {}) => ({
    sessionId: 'session123',
    userId: 'user123',
    projectId: 'project123',
    messages: [],
    context: {},
    createdAt: new Date(),
    ...overrides
  }),

  // Helper to create mock terminal output
  createMockTerminalOutput: (type = 'error') => {
    const outputs = {
      error: 'Error: Cannot find module \'express\'\n    at Function.Module._resolveFilename (internal/modules/cjs/loader.js:815:15)',
      warning: 'npm WARN deprecated package@1.0.0: This package is deprecated',
      success: 'Server running on port 3000\nDatabase connected successfully',
      build: 'webpack 5.74.0 compiled successfully in 2341 ms'
    };
    return outputs[type] || outputs.error;
  },

  // Helper to create mock Gemini response
  createMockGeminiResponse: (success = true, overrides = {}) => {
    if (success) {
      return {
        success: true,
        response: 'This is a mock AI response with helpful suggestions.',
        metadata: {
          confidence: 0.9,
          processingTime: 1500
        },
        ...overrides
      };
    } else {
      return {
        success: false,
        error: 'Mock API error',
        fallbackResponse: 'I\'m currently unable to generate a response. Please try again later.',
        ...overrides
      };
    }
  }
};

// Mock console methods to reduce noise in tests
const originalConsole = { ...console };
beforeEach(() => {
  console.log = jest.fn();
  console.info = jest.fn();
  console.warn = jest.fn();
  console.error = jest.fn();
});

afterEach(() => {
  // Restore console methods
  Object.assign(console, originalConsole);
});

// Global test timeout
jest.setTimeout(10000);

// Suppress specific warnings during tests
const originalWarn = console.warn;
console.warn = (...args) => {
  const message = args[0];
  if (
    typeof message === 'string' &&
    (message.includes('deprecated') || message.includes('experimental'))
  ) {
    return;
  }
  originalWarn.apply(console, args);
};