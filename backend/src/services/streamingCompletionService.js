const { GoogleGenerativeAI } = require('@google/generative-ai');
const logger = require('../utils/logger');

class StreamingCompletionService {
  constructor() {
    this.isMockMode = !process.env.GEMINI_API_KEY;
    
    if (this.isMockMode) {
      logger.warn('⚠️ GEMINI_API_KEY not configured. Using mock responses.');
    } else {
      this.genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
      this.model = this.genAI.getGenerativeModel({ 
        model: 'gemini-1.5-flash',
        generationConfig: {
          temperature: 0.3,
          topK: 40,
          topP: 0.95,
          maxOutputTokens: 512
          // Removed stopSequences as they were causing empty responses
        }
      });
    }
  }

  /**
   * Generate streaming code completion
   * @param {string} prompt - Code context before cursor
   * @param {string} language - Programming language
   * @param {string} filename - Current filename for context
   * @returns {AsyncGenerator} - Stream of completion tokens
   */
  async* generateCompletion(prompt, language = 'javascript', filename = '') {
    try {
      logger.info(`Generating streaming completion for language: ${language}`);
      logger.info(`🔧 Mock mode: ${this.isMockMode}, API Key exists: ${!!process.env.GEMINI_API_KEY}`);
      
      if (this.isMockMode) {
        logger.info('🎭 Using mock completion mode');
        yield* this.generateMockCompletion(prompt, language, filename);
        return;
      }
      
      const enhancedPrompt = this.buildCompletionPrompt(prompt, language, filename);
      
      logger.info(`📝 Enhanced prompt for completion (${enhancedPrompt.length} chars): ${enhancedPrompt.substring(0, 200)}...`);
      logger.info(`🤖 Calling Gemini API with model: gemini-1.5-flash`);
      
      const stream = await this.model.generateContentStream({
        contents: [{
          role: 'user',
          parts: [{ text: enhancedPrompt }]
        }]
      });
      
      logger.info(`✅ Gemini API stream created successfully`);

      let completionText = '';
      let chunkCount = 0;
      
      try {
        for await (const chunk of stream.stream) {
          chunkCount++;
          // Log the raw chunk structure for debugging
          logger.info(`🔍 RAW GEMINI CHUNK #${chunkCount}: ${JSON.stringify(chunk, null, 2)}`);
          
          // Attempt to extract token text from various possible structures
          let token = '';
          try {
            // Preferred helper if available
            if (typeof chunk.text === 'function') {
              token = chunk.text();
              logger.info(`✅ Token extracted via chunk.text(): "${token}"`);
            }
            // Fallback to direct property access (newer SDKs)
            if (!token && chunk?.candidates?.[0]?.content?.parts?.length) {
              token = chunk.candidates[0].content.parts
                .map(part => part.text || '')
                .join('');
              logger.info(`✅ Token extracted via candidates: "${token}"`);
            }
          } catch (extractErr) {
            logger.error('Token extraction error:', extractErr);
          }

          logger.info(`📊 CHUNK SUMMARY: token="${token}", hasToken=${!!token}, tokenLength=${token?.length || 0}`);
          
          if (token) {
            completionText += token;
            const yieldData = {
              token,
              completionText,
              done: false
            };
            logger.info(`🚀 YIELDING TO SOCKET: ${JSON.stringify(yieldData)}`);
            yield yieldData;
          } else {
            logger.warn(`⚠️ EMPTY TOKEN - chunk keys: ${Object.keys(chunk).join(', ')}`);
          }
        }
        
        logger.info(`🏁 Stream completed. Total chunks: ${chunkCount}, Final completion length: ${completionText.length}`);
      } catch (streamError) {
        logger.error('❌ Error reading from Gemini stream:', streamError);
        throw streamError;
      }

      // Send final completion
      yield {
        token: '',
        completionText,
        done: true
      };

      logger.info(`Completion generated successfully, total length: ${completionText.length}`);
      
    } catch (error) {
      logger.error('Error generating streaming completion:', error);
      yield {
        token: '',
        completionText: '',
        done: true,
        error: error.message
      };
    }
  }

  /**
   * Generate mock completion for testing
   * @param {string} prompt - Code context before cursor
   * @param {string} language - Programming language
   * @param {string} filename - Current filename for context
   * @returns {AsyncGenerator} - Stream of mock completion tokens
   */
  async* generateMockCompletion(prompt, language, filename) {
    const mockCompletions = {
      javascript: 'console.log("Hello, World!");',
      typescript: 'console.log("Hello, TypeScript!");',
      python: 'print("Hello, World!")',
      java: 'System.out.println("Hello, World!");',
      cpp: 'std::cout << "Hello, World!" << std::endl;',
      default: '// Mock completion for testing'
    };

    const completion = mockCompletions[language] || mockCompletions.default;
    let completionText = '';

    // Simulate streaming by yielding one character at a time
    for (let i = 0; i < completion.length; i++) {
      const token = completion[i];
      completionText += token;
      
      yield {
        token,
        completionText,
        done: false
      };
      
      // Add small delay to simulate real streaming
      await new Promise(resolve => setTimeout(resolve, 50));
    }

    // Send final completion
    yield {
      token: '',
      completionText,
      done: true
    };

    logger.info(`Mock completion generated: ${completionText}`);
  }

  /**
   * Build enhanced prompt for code completion
   * @param {string} code - Code before cursor
   * @param {string} language - Programming language
   * @param {string} filename - Current filename
   * @returns {string} - Enhanced prompt
   */
  buildCompletionPrompt(code, language, filename) {
    const languageInstructions = this.getLanguageInstructions(language);
    
    return `You are an expert ${language} developer providing code completions.

Context:
- Language: ${language}
- File: ${filename}
- Task: Complete the code naturally and concisely

Instructions:
${languageInstructions}

Rules:
1. Only provide the completion code, no explanations or markdown
2. Complete the current line or add the next logical line(s)
3. Maintain consistent indentation and style
4. Stop at natural breakpoints (end of statement, function, etc.)
5. Maximum 3-4 lines of completion
6. Do not wrap your response in code blocks or backticks

Current code:
${code}

Provide the completion that should come next:`;
  }

  /**
   * Get language-specific completion instructions
   * @param {string} language - Programming language
   * @returns {string} - Language instructions
   */
  getLanguageInstructions(language) {
    const instructions = {
      javascript: '- Use modern ES6+ syntax\n- Prefer const/let over var\n- Use arrow functions when appropriate',
      typescript: '- Include proper type annotations\n- Use interfaces and types\n- Follow TypeScript best practices',
      python: '- Follow PEP 8 style guidelines\n- Use type hints when helpful\n- Prefer list comprehensions when readable',
      java: '- Follow Java naming conventions\n- Use proper access modifiers\n- Include necessary imports',
      cpp: '- Use modern C++ features\n- Follow RAII principles\n- Include necessary headers',
      html: '- Use semantic HTML elements\n- Maintain proper nesting\n- Include accessibility attributes',
      css: '- Use modern CSS features\n- Follow BEM methodology when applicable\n- Prefer flexbox/grid for layouts',
      json: '- Maintain valid JSON syntax\n- Use consistent formatting\n- No trailing commas'
    };

    return instructions[language] || '- Follow language best practices\n- Maintain consistent style\n- Write clean, readable code';
  }

  /**
   * Validate completion request
   * @param {string} prompt - Code prompt
   * @param {string} language - Programming language
   * @returns {Object} - Validation result
   */
  validateRequest(prompt, language) {
    const errors = [];

    if (!prompt || typeof prompt !== 'string') {
      errors.push('Prompt is required and must be a string');
    }

    if (prompt && prompt.length > 10000) {
      errors.push('Prompt is too long (max 10000 characters)');
    }

    if (!language || typeof language !== 'string') {
      errors.push('Language is required and must be a string');
    }

    const supportedLanguages = [
      'javascript', 'typescript', 'python', 'java', 'cpp', 'c',
      'csharp', 'php', 'ruby', 'go', 'rust', 'swift', 'kotlin',
      'html', 'css', 'scss', 'json', 'xml', 'yaml', 'markdown',
      'sql', 'shell', 'dockerfile'
    ];

    if (language && !supportedLanguages.includes(language.toLowerCase())) {
      errors.push(`Unsupported language: ${language}`);
    }

    return {
      isValid: errors.length === 0,
      errors
    };
  }

  /**
   * Get completion statistics
   * @returns {Object} - Service statistics
   */
  getStats() {
    return {
      modelName: 'gemini-2.5-flash',
      maxTokens: 512,
      temperature: 0.3,
      supportedLanguages: 24,
      status: 'active'
    };
  }
}

module.exports = new StreamingCompletionService();