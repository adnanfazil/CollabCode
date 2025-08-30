const fs = require('fs').promises;
const path = require('path');
const logger = require('../utils/logger');

class ErrorAnalysisService {
  constructor() {
    this.errorPatterns = {
      syntax: [
        /SyntaxError/i,
        /Unexpected token/i,
        /Missing semicolon/i,
        /Unterminated string/i,
        /Invalid or unexpected token/i
      ],
      runtime: [
        /TypeError/i,
        /ReferenceError/i,
        /RangeError/i,
        /Cannot read property/i,
        /is not defined/i,
        /Cannot access before initialization/i
      ],
      build: [
        /Module not found/i,
        /Cannot resolve module/i,
        /Failed to compile/i,
        /Build failed/i,
        /Compilation error/i
      ],
      network: [
        /ECONNREFUSED/i,
        /ENOTFOUND/i,
        /ETIMEDOUT/i,
        /Network error/i,
        /Connection refused/i
      ],
      permission: [
        /EACCES/i,
        /EPERM/i,
        /Permission denied/i,
        /Access is denied/i
      ],
      dependency: [
        /npm ERR!/i,
        /Package not found/i,
        /Version conflict/i,
        /Peer dependency/i,
        /Missing dependency/i
      ]
    };

    this.languageDetectors = {
      javascript: ['.js', '.jsx', '.mjs'],
      typescript: ['.ts', '.tsx'],
      python: ['.py', '.pyw'],
      java: ['.java'],
      cpp: ['.cpp', '.cc', '.cxx'],
      c: ['.c'],
      csharp: ['.cs'],
      php: ['.php'],
      ruby: ['.rb'],
      go: ['.go'],
      rust: ['.rs'],
      swift: ['.swift']
    };
  }

  /**
   * Analyze error from terminal output and project context
   * @param {string} errorText - Error message or terminal output
   * @param {Object} projectContext - Project information
   * @returns {Object} - Analysis results
   */
  async analyzeError(errorText, projectContext = {}) {
    try {
      const analysis = {
        errorType: this.classifyError(errorText),
        severity: this.assessSeverity(errorText),
        context: await this.extractContext(projectContext),
        suggestions: [],
        relatedFiles: [],
        stackTrace: this.extractStackTrace(errorText),
        errorDetails: this.extractErrorDetails(errorText)
      };

      // Generate contextual suggestions based on error type
      analysis.suggestions = this.generateSuggestions(analysis);

      return analysis;
    } catch (error) {
      logger.error('Error analysis failed:', error);
      return {
        errorType: 'unknown',
        severity: 'medium',
        context: {},
        suggestions: ['Unable to analyze error automatically. Please review the error message manually.'],
        relatedFiles: [],
        stackTrace: null,
        errorDetails: errorText
      };
    }
  }

  /**
   * Classify error type based on patterns
   * @param {string} errorText - Error message
   * @returns {string} - Error classification
   */
  classifyError(errorText) {
    for (const [type, patterns] of Object.entries(this.errorPatterns)) {
      if (patterns.some(pattern => pattern.test(errorText))) {
        return type;
      }
    }
    return 'unknown';
  }

  /**
   * Assess error severity
   * @param {string} errorText - Error message
   * @returns {string} - Severity level
   */
  assessSeverity(errorText) {
    const criticalKeywords = ['fatal', 'critical', 'crash', 'segmentation fault', 'out of memory'];
    const highKeywords = ['error', 'exception', 'failed', 'cannot', 'unable'];
    const mediumKeywords = ['warning', 'deprecated', 'notice'];

    const text = errorText.toLowerCase();

    if (criticalKeywords.some(keyword => text.includes(keyword))) {
      return 'critical';
    }
    if (highKeywords.some(keyword => text.includes(keyword))) {
      return 'high';
    }
    if (mediumKeywords.some(keyword => text.includes(keyword))) {
      return 'medium';
    }

    return 'low';
  }

  /**
   * Extract project context
   * @param {Object} projectContext - Raw project data
   * @returns {Object} - Processed context
   */
  async extractContext(projectContext) {
    const context = {
      projectType: 'unknown',
      language: 'unknown',
      framework: 'unknown',
      dependencies: [],
      devDependencies: [],
      scripts: {},
      recentCommands: [],
      fileStructure: []
    };

    try {
      // Analyze package.json if available
      if (projectContext.packageJsonPath) {
        const packageData = await this.analyzePackageJson(projectContext.packageJsonPath);
        Object.assign(context, packageData);
      }

      // Analyze project files
      if (projectContext.projectPath) {
        const fileAnalysis = await this.analyzeProjectFiles(projectContext.projectPath);
        Object.assign(context, fileAnalysis);
      }

      // Process terminal history
      if (projectContext.terminalHistory) {
        context.recentCommands = projectContext.terminalHistory.slice(-10);
      }

      // Extract environment information
      if (projectContext.environment) {
        context.environment = projectContext.environment;
      }

    } catch (error) {
      logger.warn('Context extraction partially failed:', error);
    }

    return context;
  }

  /**
   * Analyze package.json for project insights
   * @param {string} packageJsonPath - Path to package.json
   * @returns {Object} - Package analysis
   */
  async analyzePackageJson(packageJsonPath) {
    try {
      const packageContent = await fs.readFile(packageJsonPath, 'utf8');
      const packageJson = JSON.parse(packageContent);

      const analysis = {
        projectType: this.detectProjectType(packageJson),
        framework: this.detectFramework(packageJson),
        dependencies: Object.keys(packageJson.dependencies || {}),
        devDependencies: Object.keys(packageJson.devDependencies || {}),
        scripts: packageJson.scripts || {},
        nodeVersion: packageJson.engines?.node,
        npmVersion: packageJson.engines?.npm
      };

      return analysis;
    } catch (error) {
      logger.warn('Package.json analysis failed:', error);
      return {};
    }
  }

  /**
   * Analyze project files for language and structure
   * @param {string} projectPath - Project root path
   * @returns {Object} - File analysis
   */
  async analyzeProjectFiles(projectPath) {
    try {
      const files = await this.getProjectFiles(projectPath);
      const analysis = {
        language: this.detectLanguageFromFiles(files),
        fileStructure: files.slice(0, 50), // Limit to first 50 files
        configFiles: files.filter(file => this.isConfigFile(file))
      };

      return analysis;
    } catch (error) {
      logger.warn('File analysis failed:', error);
      return { language: 'unknown', fileStructure: [], configFiles: [] };
    }
  }

  /**
   * Get project files recursively
   * @param {string} dirPath - Directory path
   * @param {Array} fileList - Accumulator for files
   * @param {number} depth - Current depth
   * @returns {Array} - List of files
   */
  async getProjectFiles(dirPath, fileList = [], depth = 0) {
    if (depth > 3) return fileList; // Limit recursion depth

    try {
      const items = await fs.readdir(dirPath);
      
      for (const item of items) {
        if (item.startsWith('.') && !['package.json', 'tsconfig.json'].includes(item)) {
          continue; // Skip hidden files except important ones
        }

        const fullPath = path.join(dirPath, item);
        const stat = await fs.stat(fullPath);

        if (stat.isDirectory()) {
          if (!['node_modules', '.git', 'dist', 'build'].includes(item)) {
            await this.getProjectFiles(fullPath, fileList, depth + 1);
          }
        } else {
          fileList.push(fullPath);
        }
      }
    } catch (error) {
      logger.warn(`Failed to read directory ${dirPath}:`, error);
    }

    return fileList;
  }

  /**
   * Detect project type from package.json
   * @param {Object} packageJson - Parsed package.json
   * @returns {string} - Project type
   */
  detectProjectType(packageJson) {
    const deps = { ...packageJson.dependencies, ...packageJson.devDependencies };
    
    if (deps.react || deps['@types/react']) return 'React Application';
    if (deps.vue || deps['@vue/cli']) return 'Vue.js Application';
    if (deps.angular || deps['@angular/core']) return 'Angular Application';
    if (deps.next) return 'Next.js Application';
    if (deps.nuxt) return 'Nuxt.js Application';
    if (deps.express || deps.fastify || deps.koa) return 'Node.js Backend';
    if (deps.electron) return 'Electron Application';
    if (deps['react-native']) return 'React Native Application';
    if (deps.gatsby) return 'Gatsby Application';
    
    return 'Node.js Project';
  }

  /**
   * Detect framework from dependencies
   * @param {Object} packageJson - Parsed package.json
   * @returns {string} - Framework name
   */
  detectFramework(packageJson) {
    const deps = { ...packageJson.dependencies, ...packageJson.devDependencies };
    
    const frameworks = {
      'React': ['react'],
      'Vue.js': ['vue'],
      'Angular': ['@angular/core'],
      'Next.js': ['next'],
      'Nuxt.js': ['nuxt'],
      'Express.js': ['express'],
      'Fastify': ['fastify'],
      'NestJS': ['@nestjs/core'],
      'Svelte': ['svelte'],
      'Solid.js': ['solid-js']
    };

    for (const [framework, packages] of Object.entries(frameworks)) {
      if (packages.some(pkg => deps[pkg])) {
        return framework;
      }
    }

    return 'Unknown';
  }

  /**
   * Detect primary language from file extensions
   * @param {Array} files - List of file paths
   * @returns {string} - Primary language
   */
  detectLanguageFromFiles(files) {
    const extensionCounts = {};
    
    files.forEach(file => {
      const ext = path.extname(file).toLowerCase();
      extensionCounts[ext] = (extensionCounts[ext] || 0) + 1;
    });

    // Find the most common extension
    const mostCommonExt = Object.keys(extensionCounts)
      .reduce((a, b) => extensionCounts[a] > extensionCounts[b] ? a : b, '');

    // Map extension to language
    for (const [language, extensions] of Object.entries(this.languageDetectors)) {
      if (extensions.includes(mostCommonExt)) {
        return language;
      }
    }

    return 'unknown';
  }

  /**
   * Check if file is a configuration file
   * @param {string} filePath - File path
   * @returns {boolean} - True if config file
   */
  isConfigFile(filePath) {
    const configFiles = [
      'package.json', 'tsconfig.json', 'webpack.config.js', 'vite.config.js',
      'next.config.js', 'nuxt.config.js', '.eslintrc', '.prettierrc',
      'babel.config.js', 'jest.config.js', 'tailwind.config.js'
    ];
    
    const fileName = path.basename(filePath);
    return configFiles.some(config => fileName.includes(config));
  }

  /**
   * Extract stack trace from error text
   * @param {string} errorText - Error message
   * @returns {Array} - Stack trace lines
   */
  extractStackTrace(errorText) {
    const lines = errorText.split('\n');
    const stackTrace = [];
    let inStackTrace = false;

    for (const line of lines) {
      if (line.trim().startsWith('at ') || line.includes('stack trace:')) {
        inStackTrace = true;
      }
      
      if (inStackTrace && (line.trim().startsWith('at ') || line.includes('.js:') || line.includes('.ts:'))) {
        stackTrace.push(line.trim());
      }
      
      if (inStackTrace && line.trim() === '') {
        break;
      }
    }

    return stackTrace.length > 0 ? stackTrace : null;
  }

  /**
   * Extract specific error details
   * @param {string} errorText - Error message
   * @returns {Object} - Extracted error information
   */
  extractErrorDetails(errorText) {
    const details = {
      message: '',
      file: '',
      line: null,
      column: null,
      code: ''
    };

    // Extract main error message
    const errorLines = errorText.split('\n');
    const mainErrorLine = errorLines.find(line => 
      line.includes('Error:') || line.includes('Exception:') || line.includes('Failed:')
    );
    
    if (mainErrorLine) {
      details.message = mainErrorLine.trim();
    }

    // Extract file and line information
    const fileLineMatch = errorText.match(/(\S+\.\w+):(\d+):(\d+)/);
    if (fileLineMatch) {
      details.file = fileLineMatch[1];
      details.line = parseInt(fileLineMatch[2]);
      details.column = parseInt(fileLineMatch[3]);
    }

    // Extract error code if present
    const codeMatch = errorText.match(/\b([A-Z]+\d+)\b/);
    if (codeMatch) {
      details.code = codeMatch[1];
    }

    return details;
  }

  /**
   * Generate contextual suggestions based on analysis
   * @param {Object} analysis - Error analysis results
   * @returns {Array} - List of suggestions
   */
  generateSuggestions(analysis) {
    const suggestions = [];
    const { errorType, context, errorDetails } = analysis;

    switch (errorType) {
      case 'syntax':
        suggestions.push('Check for missing brackets, semicolons, or quotes');
        suggestions.push('Verify proper indentation and code structure');
        if (context.language === 'javascript' || context.language === 'typescript') {
          suggestions.push('Use a linter like ESLint to catch syntax errors');
        }
        break;

      case 'runtime':
        suggestions.push('Check for undefined variables or null references');
        suggestions.push('Verify that all required modules are imported');
        suggestions.push('Add proper error handling with try-catch blocks');
        break;

      case 'build':
        suggestions.push('Run `npm install` to ensure all dependencies are installed');
        suggestions.push('Check for version conflicts in package.json');
        suggestions.push('Clear cache and reinstall: `npm cache clean --force && npm install`');
        break;

      case 'network':
        suggestions.push('Check your internet connection');
        suggestions.push('Verify the server URL and port number');
        suggestions.push('Check if the service is running and accessible');
        break;

      case 'permission':
        suggestions.push('Run the command with administrator privileges');
        suggestions.push('Check file and directory permissions');
        suggestions.push('Ensure you have write access to the target directory');
        break;

      case 'dependency':
        suggestions.push('Update your package manager: `npm update -g npm`');
        suggestions.push('Check for conflicting package versions');
        suggestions.push('Try removing node_modules and reinstalling: `rm -rf node_modules && npm install`');
        break;

      default:
        suggestions.push('Review the error message carefully for specific details');
        suggestions.push('Check recent changes to your code');
        suggestions.push('Consult the relevant documentation or community forums');
    }

    // Add context-specific suggestions
    if (context.framework === 'React' && errorType === 'runtime') {
      suggestions.push('Check React component lifecycle and state management');
      suggestions.push('Verify prop types and component structure');
    }

    if (context.projectType.includes('Backend') && errorType === 'network') {
      suggestions.push('Check if the database connection is properly configured');
      suggestions.push('Verify API endpoint URLs and authentication');
    }

    return suggestions;
  }
}

module.exports = ErrorAnalysisService;