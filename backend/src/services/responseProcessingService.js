const logger = require('../utils/logger');

class ResponseProcessingService {
  constructor() {
    this.codeBlockRegex = /```([a-zA-Z]*)?\n([\s\S]*?)```/g;
    this.inlineCodeRegex = /`([^`]+)`/g;
    this.boldRegex = /\*\*([^*]+)\*\*/g;
    this.italicRegex = /\*([^*]+)\*/g;
    this.linkRegex = /\[([^\]]+)\]\(([^)]+)\)/g;
  }

  /**
   * Process AI response for better formatting and presentation
   * @param {string} rawResponse - Raw AI response
   * @param {string} queryType - Type of query (error_resolution, how_to, etc.)
   * @returns {Object} - Processed response with metadata
   */
  processResponse(rawResponse, queryType = 'general') {
    try {
      const processed = {
        original: rawResponse,
        formatted: this.formatResponse(rawResponse),
        codeBlocks: this.extractCodeBlocks(rawResponse),
        suggestions: this.extractSuggestions(rawResponse),
        links: this.extractLinks(rawResponse),
        type: this.determineResponseType(rawResponse, queryType),
        metadata: {
          hasCode: this.hasCodeContent(rawResponse),
          hasSteps: this.hasStepByStep(rawResponse),
          hasWarnings: this.hasWarnings(rawResponse),
          wordCount: rawResponse.split(' ').length,
          estimatedReadTime: Math.ceil(rawResponse.split(' ').length / 200) // 200 WPM average
        }
      };

      return {
        success: true,
        data: processed
      };
    } catch (error) {
      logger.error('Response processing error:', error);
      return {
        success: false,
        error: error.message,
        data: {
          original: rawResponse,
          formatted: rawResponse,
          type: 'text'
        }
      };
    }
  }

  /**
   * Format response with improved structure and readability
   * @param {string} response - Raw response
   * @returns {string} - Formatted response
   */
  formatResponse(response) {
    let formatted = response;

    // Clean up excessive whitespace
    formatted = formatted.replace(/\n{3,}/g, '\n\n');
    
    // Ensure proper spacing around headers
    formatted = formatted.replace(/(#{1,6}\s+[^\n]+)/g, '\n$1\n');
    
    // Ensure proper spacing around code blocks
    formatted = formatted.replace(/(```[\s\S]*?```)/g, '\n$1\n');
    
    // Format numbered lists properly
    formatted = formatted.replace(/^(\d+\.)\s*/gm, '\n$1 ');
    
    // Format bullet points properly
    formatted = formatted.replace(/^[-*]\s*/gm, '\n• ');
    
    // Clean up final formatting
    formatted = formatted.trim();
    
    return formatted;
  }

  /**
   * Extract code blocks from response
   * @param {string} response - Response text
   * @returns {Array} - Array of code blocks with language and content
   */
  extractCodeBlocks(response) {
    const codeBlocks = [];
    let match;
    
    while ((match = this.codeBlockRegex.exec(response)) !== null) {
      codeBlocks.push({
        language: match[1] || 'text',
        code: match[2].trim(),
        fullMatch: match[0]
      });
    }
    
    // Reset regex for next use
    this.codeBlockRegex.lastIndex = 0;
    
    return codeBlocks;
  }

  /**
   * Extract actionable suggestions from response
   * @param {string} response - Response text
   * @returns {Array} - Array of suggestions
   */
  extractSuggestions(response) {
    const suggestions = [];
    const lines = response.split('\n');
    
    lines.forEach(line => {
      const trimmed = line.trim();
      
      // Look for numbered steps
      if (/^\d+\.\s+/.test(trimmed)) {
        suggestions.push({
          type: 'step',
          content: trimmed.replace(/^\d+\.\s+/, ''),
          priority: 'high'
        });
      }
      
      // Look for bullet points with action words
      if (/^[•-]\s+/.test(trimmed) && this.isActionable(trimmed)) {
        suggestions.push({
          type: 'action',
          content: trimmed.replace(/^[•-]\s+/, ''),
          priority: 'medium'
        });
      }
      
      // Look for commands or code snippets
      if (trimmed.startsWith('`') && trimmed.endsWith('`')) {
        suggestions.push({
          type: 'command',
          content: trimmed.slice(1, -1),
          priority: 'high'
        });
      }
    });
    
    return suggestions;
  }

  /**
   * Extract links from response
   * @param {string} response - Response text
   * @returns {Array} - Array of links
   */
  extractLinks(response) {
    const links = [];
    let match;
    
    while ((match = this.linkRegex.exec(response)) !== null) {
      links.push({
        text: match[1],
        url: match[2],
        type: this.classifyLink(match[2])
      });
    }
    
    // Reset regex for next use
    this.linkRegex.lastIndex = 0;
    
    return links;
  }

  /**
   * Determine the type of response for UI rendering
   * @param {string} response - Response text
   * @param {string} queryType - Original query type
   * @returns {string} - Response type
   */
  determineResponseType(response, queryType) {
    if (this.hasCodeContent(response)) {
      return 'code';
    }
    
    if (this.hasStepByStep(response)) {
      return 'tutorial';
    }
    
    if (this.hasWarnings(response) || queryType === 'error_resolution') {
      return 'error_solution';
    }
    
    if (queryType === 'optimization') {
      return 'optimization';
    }
    
    return 'text';
  }

  /**
   * Check if response contains code content
   * @param {string} response - Response text
   * @returns {boolean} - True if contains code
   */
  hasCodeContent(response) {
    return this.codeBlockRegex.test(response) || this.inlineCodeRegex.test(response);
  }

  /**
   * Check if response contains step-by-step instructions
   * @param {string} response - Response text
   * @returns {boolean} - True if contains steps
   */
  hasStepByStep(response) {
    const stepPatterns = [
      /\d+\./g,
      /step \d+/gi,
      /first.*second.*third/gi,
      /next.*then.*finally/gi
    ];
    
    return stepPatterns.some(pattern => pattern.test(response));
  }

  /**
   * Check if response contains warnings or important notes
   * @param {string} response - Response text
   * @returns {boolean} - True if contains warnings
   */
  hasWarnings(response) {
    const warningKeywords = [
      'warning', 'caution', 'important', 'note', 'careful',
      'avoid', 'don\'t', 'never', 'always', 'make sure'
    ];
    
    const lowerResponse = response.toLowerCase();
    return warningKeywords.some(keyword => lowerResponse.includes(keyword));
  }

  /**
   * Check if a line contains actionable content
   * @param {string} line - Line of text
   * @returns {boolean} - True if actionable
   */
  isActionable(line) {
    const actionWords = [
      'install', 'run', 'execute', 'create', 'add', 'remove',
      'update', 'modify', 'change', 'check', 'verify', 'test',
      'configure', 'set', 'enable', 'disable', 'restart'
    ];
    
    const lowerLine = line.toLowerCase();
    return actionWords.some(word => lowerLine.includes(word));
  }

  /**
   * Classify link type for better UI presentation
   * @param {string} url - URL to classify
   * @returns {string} - Link type
   */
  classifyLink(url) {
    if (url.includes('github.com')) return 'github';
    if (url.includes('stackoverflow.com')) return 'stackoverflow';
    if (url.includes('docs.') || url.includes('documentation')) return 'documentation';
    if (url.includes('npmjs.com')) return 'npm';
    if (url.includes('developer.mozilla.org')) return 'mdn';
    
    return 'external';
  }

  /**
   * Generate response summary for quick preview
   * @param {string} response - Response text
   * @returns {string} - Summary
   */
  generateSummary(response) {
    const sentences = response.split(/[.!?]+/);
    const firstSentence = sentences[0]?.trim();
    
    if (firstSentence && firstSentence.length > 10) {
      return firstSentence.length > 100 
        ? firstSentence.substring(0, 97) + '...'
        : firstSentence;
    }
    
    return 'AI response available';
  }

  /**
   * Extract key topics from response for tagging
   * @param {string} response - Response text
   * @returns {Array} - Array of topics
   */
  extractTopics(response) {
    const topics = new Set();
    const lowerResponse = response.toLowerCase();
    
    // Technology keywords
    const techKeywords = [
      'react', 'vue', 'angular', 'node', 'express', 'mongodb',
      'javascript', 'typescript', 'python', 'java', 'css', 'html',
      'npm', 'yarn', 'webpack', 'babel', 'eslint', 'git'
    ];
    
    techKeywords.forEach(keyword => {
      if (lowerResponse.includes(keyword)) {
        topics.add(keyword);
      }
    });
    
    return Array.from(topics);
  }
}

module.exports = ResponseProcessingService;