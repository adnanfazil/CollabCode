const logger = require('../utils/logger');

class GeminiService {
  constructor() {
    this.apiKey = process.env.GEMINI_API_KEY;
    this.API_URL = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent';
    
    if (!this.apiKey || this.apiKey === 'your-gemini-api-key-here') {
      logger.warn('⚠️ GEMINI_API_KEY not configured. Gemini service will return mock responses.');
      this.isConfigured = false;
    } else {
      this.isConfigured = true;
    }
    
    // Rate limiting configuration
    this.requestQueue = [];
    this.isProcessing = false;
    this.maxRetries = 3;
    this.baseDelay = 1000; // 1 second
  }

  /**
   * Generate AI response for error resolution
   * @param {string} userQuery - The user's error query
   * @param {Object} context - Additional context (project files, terminal output, etc.)
   * @returns {Promise<Object>} - AI response with solution and metadata
   */
  async generateErrorSolution(userQuery, context = {}) {
    // Return mock response if API key not configured
    if (!this.isConfigured) {
      return {
        success: true,
        response: this.getFallbackResponse(userQuery),
        metadata: {
          timestamp: new Date().toISOString(),
          context: context,
          isMockResponse: true
        }
      };
    }

    try {
      const prompt = this.buildPrompt(userQuery, context);
      const response = await this.callGeminiWithRetry(prompt);
      
      return {
        success: true,
        response: response,
        metadata: {
          timestamp: new Date().toISOString(),
          context: context,
          promptLength: prompt.length
        }
      };
    } catch (error) {
      logger.error('Gemini API error:', error);
      return {
        success: false,
        error: error.message,
        fallbackResponse: this.getFallbackResponse(userQuery)
      };
    }
  }

  /**
   * Build comprehensive prompt for error resolution
   * @param {string} userQuery - User's query
   * @param {Object} context - Context information
   * @returns {string} - Formatted prompt
   */
  buildPrompt(userQuery, context) {
    const queryType = this.classifyQuery(userQuery);
    const systemPrompt = this.getSystemPrompt(queryType);
    const contextInfo = this.formatContext(context);
    
    return `${systemPrompt}\n\nContext:${contextInfo}\n\nUser Query: ${userQuery}\n\nPlease provide your analysis and solution:`;
  }

  /**
   * Classify the type of user query
   * @param {string} query - User's query
   * @returns {string} - Query type
   */
  classifyQuery(query) {
    const lowerQuery = query.toLowerCase();
    
    if (lowerQuery.includes('error') || lowerQuery.includes('exception') || lowerQuery.includes('failed')) {
      return 'error_resolution';
    }
    if (lowerQuery.includes('how to') || lowerQuery.includes('how do i')) {
      return 'how_to';
    }
    if (lowerQuery.includes('optimize') || lowerQuery.includes('performance') || lowerQuery.includes('slow')) {
      return 'optimization';
    }
    if (lowerQuery.includes('best practice') || lowerQuery.includes('recommend')) {
      return 'best_practices';
    }
    if (lowerQuery.includes('debug') || lowerQuery.includes('not working')) {
      return 'debugging';
    }
    
    return 'general';
  }

  /**
   * Get system prompt based on query type
   * @param {string} queryType - Type of query
   * @returns {string} - System prompt
   */
  getSystemPrompt(queryType) {
    const prompts = {
      error_resolution: `You are an expert coding assistant specializing in error resolution and debugging.
Your goal is to provide clear, actionable solutions to programming errors.

Analyze the following error and provide a comprehensive solution following this structure:

1. **Root Cause Analysis**: Identify what's causing the error
2. **Step-by-Step Solution**: Provide clear, numbered steps to fix the issue
3. **Code Examples**: Include relevant code snippets if applicable
4. **Prevention Tips**: Suggest how to avoid this error in the future
5. **Additional Resources**: Mention relevant documentation or tools if helpful

Be concise but thorough. Focus on practical solutions that can be implemented immediately.`,
      
      how_to: `You are an expert coding mentor providing step-by-step guidance.
Your goal is to teach users how to implement features or solve coding challenges.

Provide a comprehensive tutorial following this structure:

1. **Overview**: Brief explanation of what we're trying to achieve
2. **Prerequisites**: What the user should know or have installed
3. **Step-by-Step Implementation**: Clear, numbered steps with code examples
4. **Testing**: How to verify the implementation works
5. **Next Steps**: Suggestions for further learning or improvements

Use clear, beginner-friendly language with practical examples.`,
      
      optimization: `You are a performance optimization expert.
Your goal is to help users improve code performance and efficiency.

Analyze the performance issue and provide optimization strategies:

1. **Performance Analysis**: Identify bottlenecks and inefficiencies
2. **Optimization Strategies**: Specific techniques to improve performance
3. **Code Examples**: Before and after code comparisons
4. **Measurement**: How to measure and validate improvements
5. **Trade-offs**: Discuss any trade-offs or considerations

Focus on practical, measurable improvements.`,
      
      best_practices: `You are a senior software architect providing best practice guidance.
Your goal is to help users write maintainable, scalable, and robust code.

Provide best practice recommendations:

1. **Current Assessment**: Evaluate the current approach
2. **Best Practices**: Recommend industry-standard practices
3. **Implementation**: How to apply these practices
4. **Benefits**: Explain why these practices matter
5. **Common Pitfalls**: What to avoid

Emphasize long-term maintainability and team collaboration.`,
      
      debugging: `You are a debugging specialist helping users identify and fix issues.
Your goal is to guide users through systematic debugging processes.

Provide debugging guidance:

1. **Problem Identification**: Help clarify what's not working
2. **Debugging Strategy**: Systematic approach to find the issue
3. **Investigation Steps**: Specific steps to gather information
4. **Solution**: How to fix the identified issue
5. **Prevention**: How to avoid similar issues

Teach debugging methodology, not just solutions.`,
      
      general: `You are a helpful coding assistant providing comprehensive programming support.
Your goal is to assist with any coding-related questions or challenges.

Provide helpful guidance following this structure:

1. **Understanding**: Clarify the question or requirement
2. **Solution**: Provide a clear, practical answer
3. **Examples**: Include relevant code examples if applicable
4. **Context**: Explain the reasoning behind the solution
5. **Further Reading**: Suggest additional resources if helpful

Be thorough but concise, focusing on practical value.`
    };
    
    return prompts[queryType] || prompts.general;
  }

  /**
   * Format context information for the prompt
   * @param {Object} context - Context information
   * @returns {string} - Formatted context
   */
  formatContext(context) {
    let contextInfo = '';
    
    if (context.projectType) {
      contextInfo += `\nProject Type: ${context.projectType}`;
    }
    
    if (context.language) {
      contextInfo += `\nProgramming Language: ${context.language}`;
    }
    
    if (context.dependencies && context.dependencies.length > 0) {
      contextInfo += `\nKey Dependencies: ${context.dependencies.slice(0, 5).join(', ')}`;
    }
    
    if (context.recentCommands && context.recentCommands.length > 0) {
      contextInfo += `\nRecent Commands: ${context.recentCommands.join(', ')}`;
    }
    
    if (context.errorDetails) {
      contextInfo += `\nError Details: ${context.errorDetails}`;
    }
    
    if (context.stackTrace) {
      contextInfo += `\nStack Trace: ${context.stackTrace}`;
    }
    
    if (context.fileContent) {
      contextInfo += `\nRelevant Code: ${context.fileContent}`;
    }
    
    if (context.terminalOutput) {
      const recentOutput = context.terminalOutput.split('\n').slice(-10).join('\n');
      contextInfo += `\nRecent Terminal Output: ${recentOutput}`;
    }

    return contextInfo || '\nNo additional context available.';
  }

  /**
   * Call Gemini API with retry logic using direct fetch
   * @param {string} prompt - The prompt to send
   * @returns {Promise<string>} - API response text
   */
  async callGeminiWithRetry(prompt, retryCount = 0) {
    try {
      const requestBody = {
        contents: [{
          parts: [{
            text: prompt
          }]
        }]
      };

      const response = await fetch(`${this.API_URL}?key=${this.apiKey}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(requestBody)
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`API Error: ${response.status} ${response.statusText} - ${errorText}`);
      }

      const data = await response.json();
      
      if (data.candidates && data.candidates[0] && data.candidates[0].content) {
        return data.candidates[0].content.parts[0].text;
      } else {
        throw new Error('Invalid response format from Gemini API');
      }
    } catch (error) {
      if (retryCount < this.maxRetries) {
        const delay = this.baseDelay * Math.pow(2, retryCount);
        logger.warn(`Gemini API call failed, retrying in ${delay}ms. Attempt ${retryCount + 1}/${this.maxRetries}`);
        
        await this.sleep(delay);
        return this.callGeminiWithRetry(prompt, retryCount + 1);
      }
      
      throw error;
    }
  }

  /**
   * Get fallback response when AI is unavailable
   * @param {string} userQuery - Original user query
   * @returns {string} - Fallback response
   */
  getFallbackResponse(userQuery) {
    const commonErrors = {
      'npm': 'Try clearing npm cache with `npm cache clean --force` and reinstalling dependencies with `npm install`.',
      'node': 'Check your Node.js version with `node --version`. Consider updating to the latest LTS version.',
      'syntax': 'Review your code for missing brackets, semicolons, or incorrect indentation.',
      'import': 'Verify that the module exists and the import path is correct. Check your package.json dependencies.',
      'permission': 'Try running the command with administrator privileges or check file permissions.',
      'port': 'The port might be in use. Try using a different port or kill the process using the current port.'
    };

    const query = userQuery.toLowerCase();
    for (const [keyword, suggestion] of Object.entries(commonErrors)) {
      if (query.includes(keyword)) {
        return `I'm currently unable to provide a detailed analysis, but here's a common solution for ${keyword}-related issues: ${suggestion}`;
      }
    }

    return 'I\'m currently unable to analyze this error. Please check the error message carefully, review recent changes to your code, and consult the relevant documentation. If the issue persists, consider asking for help in developer communities or forums.';
  }

  /**
   * Extract context from terminal output and project state
   * @param {Object} projectData - Current project information
   * @returns {Object} - Extracted context
   */
  extractContext(projectData) {
    const context = {};

    // Detect project type from package.json or file structure
    if (projectData.packageJson) {
      const pkg = JSON.parse(projectData.packageJson);
      context.projectType = this.detectProjectType(pkg);
      context.dependencies = Object.keys(pkg.dependencies || {});
      context.devDependencies = Object.keys(pkg.devDependencies || {});
    }

    // Extract programming language from file extensions
    if (projectData.files) {
      context.language = this.detectPrimaryLanguage(projectData.files);
    }

    // Process recent terminal commands
    if (projectData.terminalHistory) {
      context.recentCommands = projectData.terminalHistory.slice(-5);
    }

    // Extract error information from logs
    if (projectData.errorLogs) {
      context.errorDetails = this.extractErrorDetails(projectData.errorLogs);
    }

    return context;
  }

  /**
   * Detect project type from package.json
   * @param {Object} packageJson - Parsed package.json
   * @returns {string} - Project type
   */
  detectProjectType(packageJson) {
    const deps = { ...packageJson.dependencies, ...packageJson.devDependencies };
    
    if (deps.react || deps['@types/react']) return 'React';
    if (deps.vue || deps['@vue/cli']) return 'Vue.js';
    if (deps.angular || deps['@angular/core']) return 'Angular';
    if (deps.next || deps['next']) return 'Next.js';
    if (deps.express || deps.fastify) return 'Node.js Backend';
    if (deps.electron) return 'Electron';
    
    return 'Node.js';
  }

  /**
   * Detect primary programming language
   * @param {Array} files - List of project files
   * @returns {string} - Primary language
   */
  detectPrimaryLanguage(files) {
    const extensions = files.map(file => file.split('.').pop().toLowerCase());
    const counts = {};
    
    extensions.forEach(ext => {
      counts[ext] = (counts[ext] || 0) + 1;
    });
    
    const languageMap = {
      'js': 'JavaScript',
      'ts': 'TypeScript',
      'jsx': 'React JSX',
      'tsx': 'React TSX',
      'py': 'Python',
      'java': 'Java',
      'cpp': 'C++',
      'c': 'C',
      'cs': 'C#',
      'php': 'PHP',
      'rb': 'Ruby',
      'go': 'Go'
    };
    
    const mostCommon = Object.keys(counts).reduce((a, b) => counts[a] > counts[b] ? a : b);
    return languageMap[mostCommon] || 'Unknown';
  }

  /**
   * Extract error details from logs
   * @param {string} errorLogs - Error log content
   * @returns {string} - Extracted error information
   */
  extractErrorDetails(errorLogs) {
    // Extract the most recent error or the most relevant error information
    const lines = errorLogs.split('\n');
    const errorLines = lines.filter(line => 
      line.includes('Error:') || 
      line.includes('Exception:') || 
      line.includes('Failed:') ||
      line.includes('SyntaxError:') ||
      line.includes('TypeError:') ||
      line.includes('ReferenceError:')
    );
    
    return errorLines.slice(-3).join('\n'); // Return last 3 error lines
  }

  /**
   * Sleep utility for retry delays
   * @param {number} ms - Milliseconds to sleep
   * @returns {Promise} - Promise that resolves after delay
   */
  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Validate API key and connection
   * @returns {Promise<boolean>} - True if connection is valid
   */
  async validateConnection() {
    if (!this.isConfigured) {
      return false;
    }
    
    try {
      const testPrompt = 'Hello, this is a connection test.';
      await this.callGeminiWithRetry(testPrompt);
      return true;
    } catch (error) {
      logger.error('Gemini connection validation failed:', error);
      return false;
    }
  }
}

module.exports = GeminiService;