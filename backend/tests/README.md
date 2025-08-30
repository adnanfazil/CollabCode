# CollabCode Backend Testing Suite

This directory contains comprehensive tests for the CollabCode backend, including unit tests, integration tests, and end-to-end tests.

## Test Structure

```
tests/
├── services/           # Unit tests for service classes
│   ├── geminiService.test.js
│   └── responseProcessingService.test.js
├── routes/            # Integration tests for API routes
│   └── chatbot.test.js
├── e2e/               # End-to-end tests
│   └── chatbot.e2e.test.js
├── setup.js           # Jest setup configuration
├── globalSetup.js     # Global test environment setup
├── globalTeardown.js  # Global test environment cleanup
└── README.md          # This file
```

## Test Types

### Unit Tests
- **Location**: `tests/services/`
- **Purpose**: Test individual service classes in isolation
- **Coverage**: GeminiService, ResponseProcessingService, ErrorAnalysisService
- **Run with**: `npm run test:unit`

### Integration Tests
- **Location**: `tests/routes/`
- **Purpose**: Test API endpoints with mocked dependencies
- **Coverage**: Chatbot routes, authentication, request/response handling
- **Run with**: `npm run test:integration`

### End-to-End Tests
- **Location**: `tests/e2e/`
- **Purpose**: Test complete workflows from API to database
- **Coverage**: Full chatbot functionality, session management, error handling
- **Run with**: `npm run test:e2e`

## Available Test Scripts

```bash
# Run all tests
npm test

# Run tests in watch mode
npm run test:watch

# Run tests with coverage report
npm run test:coverage

# Run only unit tests
npm run test:unit

# Run only integration tests
npm run test:integration

# Run only end-to-end tests
npm run test:e2e

# Run tests for CI/CD (no watch, with coverage)
npm run test:ci
```

## Test Environment Setup

### Prerequisites
1. Node.js 18+ installed
2. MongoDB (for E2E tests, or uses in-memory MongoDB)
3. Redis (mocked in tests)

### Environment Variables
Tests use `.env.test` for configuration. Key variables:
- `NODE_ENV=test`
- `JWT_SECRET=test-jwt-secret-key-for-testing-only`
- `GEMINI_API_KEY=test-gemini-api-key-for-testing-only`
- `MONGODB_URI=mongodb://localhost:27017/collabcode_test`

### Test Database
- **Unit/Integration Tests**: Use mocked dependencies
- **E2E Tests**: Use in-memory MongoDB via `mongodb-memory-server`
- **Redis**: Mocked using `ioredis-mock`

## Coverage Requirements

The test suite maintains the following coverage thresholds:
- **Branches**: 70%
- **Functions**: 70%
- **Lines**: 70%
- **Statements**: 70%

## Writing New Tests

### Unit Test Example
```javascript
const MyService = require('../../src/services/MyService');

describe('MyService', () => {
  let myService;

  beforeEach(() => {
    myService = new MyService();
  });

  describe('myMethod', () => {
    it('should return expected result', () => {
      const result = myService.myMethod('input');
      expect(result).toBe('expected');
    });
  });
});
```

### Integration Test Example
```javascript
const request = require('supertest');
const app = require('../../src/server');

describe('API Endpoint', () => {
  it('should handle valid request', async () => {
    const response = await request(app)
      .post('/api/endpoint')
      .send({ data: 'test' });

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
  });
});
```

## Test Utilities

The `setup.js` file provides global test utilities:

```javascript
// Create mock user data
const mockUser = global.testUtils.createMockUser();

// Create mock project data
const mockProject = global.testUtils.createMockProject();

// Create mock chat session
const mockSession = global.testUtils.createMockChatSession();

// Create mock terminal output
const mockOutput = global.testUtils.createMockTerminalOutput('error');

// Create mock Gemini response
const mockResponse = global.testUtils.createMockGeminiResponse(true);
```

## Mocking Strategy

### External Services
- **Google Generative AI**: Mocked in unit/integration tests
- **MongoDB**: In-memory database for E2E tests
- **Redis**: Mocked using `ioredis-mock`
- **File System**: Mocked when needed

### Internal Dependencies
- Services are mocked in route tests
- Models are mocked in service tests
- Utilities are generally not mocked

## Debugging Tests

### Common Issues
1. **Timeout Errors**: Increase timeout in Jest config or specific tests
2. **Database Connection**: Ensure MongoDB is running for E2E tests
3. **Memory Leaks**: Check for unclosed connections or timers
4. **Async Issues**: Ensure proper `await` usage and cleanup

### Debug Commands
```bash
# Run specific test file
npx jest tests/services/geminiService.test.js

# Run tests with verbose output
npx jest --verbose

# Run tests with debugging
node --inspect-brk node_modules/.bin/jest --runInBand
```

## Continuous Integration

The test suite is designed to run in CI/CD environments:
- Uses `npm run test:ci` for CI builds
- Generates coverage reports in multiple formats
- Includes proper cleanup and teardown
- Handles environment-specific configurations

## Best Practices

1. **Test Isolation**: Each test should be independent
2. **Descriptive Names**: Use clear, descriptive test names
3. **Arrange-Act-Assert**: Structure tests clearly
4. **Mock External Dependencies**: Don't rely on external services
5. **Clean Up**: Properly clean up resources after tests
6. **Coverage**: Aim for high coverage but focus on quality
7. **Performance**: Keep tests fast and efficient

## Troubleshooting

### Test Failures
1. Check environment variables in `.env.test`
2. Ensure all dependencies are installed
3. Verify database connections
4. Check for port conflicts
5. Review mock configurations

### Performance Issues
1. Use `--runInBand` for debugging
2. Check for memory leaks
3. Optimize database operations
4. Review timeout settings

For more help, check the Jest documentation or reach out to the development team.