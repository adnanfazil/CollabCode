const { GeminiService } = require('../../src/services/geminiService');
const { GoogleGenerativeAI } = require('@google/generative-ai');

// Mock the Google Generative AI
jest.mock('@google/generative-ai');

describe('GeminiService', () => {
  let geminiService;
  let mockModel;
  let mockGenerateContent;

  beforeEach(() => {
    mockGenerateContent = jest.fn();
    mockModel = {
      generateContent: mockGenerateContent
    };
    
    const mockGoogleAI = {
      getGenerativeModel: jest.fn().mockReturnValue(mockModel)
    };
    
    GoogleGenerativeAI.mockImplementation(() => mockGoogleAI);
    
    geminiService = new GeminiService();
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('generateErrorSolution', () => {
    it('should generate a successful response for valid input', async () => {
      const mockResponse = {
        response: {
          text: () => 'This is a test solution for your error.'
        }
      };
      mockGenerateContent.mockResolvedValue(mockResponse);

      const result = await geminiService.generateErrorSolution(
        'npm install failed',
        { projectType: 'node', language: 'javascript' }
      );

      expect(result.success).toBe(true);
      expect(result.response).toBe('This is a test solution for your error.');
      expect(mockGenerateContent).toHaveBeenCalledTimes(1);
    });

    it('should handle API errors gracefully', async () => {
      mockGenerateContent.mockRejectedValue(new Error('API Error'));

      const result = await geminiService.generateErrorSolution(
        'npm install failed',
        { projectType: 'node', language: 'javascript' }
      );

      expect(result.success).toBe(false);
      expect(result.error).toBe('API Error');
      expect(result.fallbackResponse).toContain('unable to generate');
    });

    it('should retry on rate limit errors', async () => {
      const rateLimitError = new Error('Rate limit exceeded');
      rateLimitError.status = 429;
      
      mockGenerateContent
        .mockRejectedValueOnce(rateLimitError)
        .mockResolvedValue({
          response: {
            text: () => 'Success after retry'
          }
        });

      const result = await geminiService.generateErrorSolution(
        'test query',
        { projectType: 'node' }
      );

      expect(result.success).toBe(true);
      expect(result.response).toBe('Success after retry');
      expect(mockGenerateContent).toHaveBeenCalledTimes(2);
    });
  });

  describe('classifyQuery', () => {
    it('should classify error-related queries correctly', () => {
      const errorQueries = [
        'npm install failed with error',
        'getting TypeError in my code',
        'build process is failing'
      ];

      errorQueries.forEach(query => {
        const result = geminiService.classifyQuery(query);
        expect(result).toBe('error_resolution');
      });
    });

    it('should classify how-to queries correctly', () => {
      const howToQueries = [
        'how to install dependencies',
        'how do I create a component',
        'what is the best way to handle state'
      ];

      howToQueries.forEach(query => {
        const result = geminiService.classifyQuery(query);
        expect(result).toBe('how_to');
      });
    });

    it('should classify optimization queries correctly', () => {
      const optimizationQueries = [
        'optimize my React app performance',
        'improve loading speed',
        'reduce bundle size'
      ];

      optimizationQueries.forEach(query => {
        const result = geminiService.classifyQuery(query);
        expect(result).toBe('optimization');
      });
    });
  });

  describe('detectProjectType', () => {
    it('should detect React projects', () => {
      const packageJson = {
        dependencies: {
          'react': '^18.0.0',
          'react-dom': '^18.0.0'
        }
      };

      const result = geminiService.detectProjectType(packageJson);
      expect(result).toBe('react');
    });

    it('should detect Node.js projects', () => {
      const packageJson = {
        dependencies: {
          'express': '^4.18.0',
          'mongoose': '^6.0.0'
        }
      };

      const result = geminiService.detectProjectType(packageJson);
      expect(result).toBe('node');
    });

    it('should return unknown for unrecognized projects', () => {
      const packageJson = {
        dependencies: {
          'some-unknown-package': '^1.0.0'
        }
      };

      const result = geminiService.detectProjectType(packageJson);
      expect(result).toBe('unknown');
    });
  });

  describe('detectPrimaryLanguage', () => {
    it('should detect JavaScript as primary language', () => {
      const files = [
        'src/index.js',
        'src/components/App.js',
        'src/utils/helper.js',
        'package.json'
      ];

      const result = geminiService.detectPrimaryLanguage(files);
      expect(result).toBe('javascript');
    });

    it('should detect TypeScript as primary language', () => {
      const files = [
        'src/index.ts',
        'src/components/App.tsx',
        'src/types/index.ts',
        'package.json'
      ];

      const result = geminiService.detectPrimaryLanguage(files);
      expect(result).toBe('typescript');
    });

    it('should return unknown for mixed or unrecognized files', () => {
      const files = [
        'README.md',
        'package.json',
        'config.yml'
      ];

      const result = geminiService.detectPrimaryLanguage(files);
      expect(result).toBe('unknown');
    });
  });
});