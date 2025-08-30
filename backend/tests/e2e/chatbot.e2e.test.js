const request = require('supertest');
const app = require('../../src/server');
const mongoose = require('mongoose');
const jwt = require('jsonwebtoken');
const User = require('../../src/models/User');
const Project = require('../../src/models/Project');
const ChatSession = require('../../src/models/ChatSession');

describe('Chatbot E2E Tests', () => {
  let authToken;
  let testUser;
  let testProject;
  let server;

  beforeAll(async () => {
    // Start the server
    server = app.listen(0);
    
    // Wait for database connection
    await new Promise(resolve => {
      if (mongoose.connection.readyState === 1) {
        resolve();
      } else {
        mongoose.connection.once('connected', resolve);
      }
    });

    // Create test user
    testUser = new User({
      username: 'e2etest',
      email: 'e2etest@example.com',
      password: 'hashedpassword123'
    });
    await testUser.save();

    // Create test project
    testProject = new Project({
      name: 'E2E Test Project',
      description: 'Project for end-to-end testing',
      userId: testUser._id,
      files: [
        {
          name: 'package.json',
          content: JSON.stringify({
            name: 'test-project',
            dependencies: {
              'express': '^4.18.0',
              'react': '^18.0.0'
            }
          })
        },
        {
          name: 'src/index.js',
          content: 'console.log("Hello World");'
        }
      ]
    });
    await testProject.save();

    // Generate auth token
    authToken = jwt.sign(
      { id: testUser._id.toString() },
      process.env.JWT_SECRET || 'test-secret'
    );
  });

  afterAll(async () => {
    // Clean up test data
    await ChatSession.deleteMany({ userId: testUser._id });
    await Project.findByIdAndDelete(testProject._id);
    await User.findByIdAndDelete(testUser._id);
    
    // Close server and database connection
    if (server) {
      server.close();
    }
    await mongoose.connection.close();
  });

  describe('Complete Chatbot Workflow', () => {
    let sessionId;

    it('should create a new chat session', async () => {
      const response = await request(app)
        .post('/api/chatbot/session')
        .set('Authorization', `Bearer ${authToken}`)
        .send({ projectId: testProject._id.toString() });

      expect(response.status).toBe(201);
      expect(response.body.success).toBe(true);
      expect(response.body.data.sessionId).toBeDefined();
      
      sessionId = response.body.data.sessionId;
    });

    it('should handle a simple query without errors', async () => {
      const response = await request(app)
        .post('/api/chatbot/query')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          query: 'How do I create a React component?',
          sessionId: sessionId,
          projectId: testProject._id.toString(),
          context: {
            projectPath: '/test/project',
            files: ['src/index.js', 'package.json']
          }
        });

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data.sessionId).toBe(sessionId);
      expect(response.body.data.response).toBeDefined();
      expect(response.body.data.formattedResponse).toBeDefined();
      expect(response.body.data.responseType).toBeDefined();
    });

    it('should handle error analysis with terminal output', async () => {
      const terminalOutput = `npm ERR! code ENOENT
npm ERR! syscall open
npm ERR! path /test/project/package.json
npm ERR! errno -2
npm ERR! enoent ENOENT: no such file or directory, open '/test/project/package.json'`;

      const response = await request(app)
        .post('/api/chatbot/query')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          query: 'Fix this npm install error',
          sessionId: sessionId,
          projectId: testProject._id.toString(),
          context: {
            terminalOutput: terminalOutput,
            projectPath: '/test/project',
            environment: 'development'
          }
        });

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data.errorType).toBeDefined();
      expect(response.body.data.suggestions).toBeDefined();
      expect(Array.isArray(response.body.data.suggestions)).toBe(true);
    });

    it('should maintain conversation context across multiple queries', async () => {
      // First query
      const firstResponse = await request(app)
        .post('/api/chatbot/query')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          query: 'I want to add authentication to my app',
          sessionId: sessionId,
          projectId: testProject._id.toString()
        });

      expect(firstResponse.status).toBe(200);

      // Follow-up query that should reference the previous context
      const followUpResponse = await request(app)
        .post('/api/chatbot/query')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          query: 'What about JWT tokens for that?',
          sessionId: sessionId,
          projectId: testProject._id.toString()
        });

      expect(followUpResponse.status).toBe(200);
      expect(followUpResponse.body.success).toBe(true);
      expect(followUpResponse.body.data.response).toBeDefined();
    });

    it('should retrieve session history', async () => {
      const response = await request(app)
        .get(`/api/chatbot/sessions/${sessionId}`)
        .set('Authorization', `Bearer ${authToken}`);

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data.sessionId).toBe(sessionId);
      expect(response.body.data.messages).toBeDefined();
      expect(Array.isArray(response.body.data.messages)).toBe(true);
      expect(response.body.data.messages.length).toBeGreaterThan(0);
    });

    it('should list user sessions', async () => {
      const response = await request(app)
        .get('/api/chatbot/sessions')
        .set('Authorization', `Bearer ${authToken}`);

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(Array.isArray(response.body.data)).toBe(true);
      expect(response.body.data.length).toBeGreaterThan(0);
      
      // Check if our session is in the list
      const ourSession = response.body.data.find(s => s.sessionId === sessionId);
      expect(ourSession).toBeDefined();
    });

    it('should filter sessions by project', async () => {
      const response = await request(app)
        .get(`/api/chatbot/sessions?projectId=${testProject._id.toString()}`)
        .set('Authorization', `Bearer ${authToken}`);

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(Array.isArray(response.body.data)).toBe(true);
      
      // All sessions should belong to the specified project
      response.body.data.forEach(session => {
        expect(session.projectId).toBe(testProject._id.toString());
      });
    });
  });

  describe('Error Handling', () => {
    it('should handle invalid session ID gracefully', async () => {
      const response = await request(app)
        .post('/api/chatbot/query')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          query: 'Test query',
          sessionId: 'invalid-session-id',
          projectId: testProject._id.toString()
        });

      expect(response.status).toBe(404);
      expect(response.body.success).toBe(false);
      expect(response.body.error).toContain('Chat session not found');
    });

    it('should handle unauthorized access to sessions', async () => {
      // Create another user's token
      const otherUser = new User({
        username: 'otheruser',
        email: 'other@example.com',
        password: 'hashedpassword123'
      });
      await otherUser.save();

      const otherToken = jwt.sign(
        { id: otherUser._id.toString() },
        process.env.JWT_SECRET || 'test-secret'
      );

      // Try to access our session with the other user's token
      const response = await request(app)
        .get(`/api/chatbot/sessions/${sessionId}`)
        .set('Authorization', `Bearer ${otherToken}`);

      expect(response.status).toBe(403);
      expect(response.body.success).toBe(false);
      expect(response.body.error).toContain('Access denied');

      // Clean up
      await User.findByIdAndDelete(otherUser._id);
    });

    it('should handle missing authentication', async () => {
      const response = await request(app)
        .post('/api/chatbot/query')
        .send({
          query: 'Test query without auth',
          projectId: testProject._id.toString()
        });

      expect(response.status).toBe(401);
    });

    it('should validate query length limits', async () => {
      const longQuery = 'a'.repeat(2001);
      
      const response = await request(app)
        .post('/api/chatbot/query')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          query: longQuery,
          sessionId: sessionId,
          projectId: testProject._id.toString()
        });

      expect(response.status).toBe(400);
      expect(response.body.success).toBe(false);
      expect(response.body.error).toContain('Query is too long');
    });
  });

  describe('Rate Limiting', () => {
    it('should handle rate limiting for rapid requests', async () => {
      const promises = [];
      
      // Send multiple rapid requests
      for (let i = 0; i < 15; i++) {
        promises.push(
          request(app)
            .post('/api/chatbot/query')
            .set('Authorization', `Bearer ${authToken}`)
            .send({
              query: `Test query ${i}`,
              sessionId: sessionId,
              projectId: testProject._id.toString()
            })
        );
      }

      const responses = await Promise.all(promises);
      
      // Some requests should be rate limited
      const rateLimitedResponses = responses.filter(r => r.status === 429);
      expect(rateLimitedResponses.length).toBeGreaterThan(0);
    }, 15000); // Increase timeout for this test
  });
});