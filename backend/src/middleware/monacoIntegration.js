const logger = require('../utils/logger');

/**
 * Middleware to enhance completion requests with Monaco-specific context
 * This middleware processes Monaco editor data and enriches the request
 * with additional context for better code completions
 */
const enhanceMonacoContext = (req, res, next) => {
  try {
    const { code, cursorPosition, language, context = {} } = req.body;

    // Extract lines around cursor for better context
    const lines = code.split('\n');
    const currentLine = cursorPosition.line - 1; // Convert to 0-based index
    const currentColumn = cursorPosition.column;

    // Get surrounding context (5 lines before and after)
    const contextRadius = 5;
    const startLine = Math.max(0, currentLine - contextRadius);
    const endLine = Math.min(lines.length - 1, currentLine + contextRadius);
    
    const beforeCursor = lines.slice(0, currentLine + 1);
    const afterCursor = lines.slice(currentLine + 1);
    
    // Get current line and split at cursor position
    const currentLineText = lines[currentLine] || '';
    const textBeforeCursor = currentLineText.substring(0, currentColumn);
    const textAfterCursor = currentLineText.substring(currentColumn);

    // Analyze code structure
    const codeAnalysis = analyzeCodeStructure(code, cursorPosition, language);

    // Enhanced context for completion
    const enhancedContext = {
      ...context,
      monaco: {
        // Cursor context
        textBeforeCursor,
        textAfterCursor,
        currentLineText,
        currentLineNumber: currentLine + 1,
        currentColumn,
        
        // Surrounding context
        beforeCursor: beforeCursor.join('\n'),
        afterCursor: afterCursor.join('\n'),
        surroundingLines: lines.slice(startLine, endLine + 1),
        
        // Code analysis
        ...codeAnalysis,
        
        // Metadata
        totalLines: lines.length,
        codeLength: code.length,
        language,
        timestamp: Date.now()
      }
    };

    // Add enhanced context to request
    req.body.context = enhancedContext;
    req.monacoContext = enhancedContext.monaco;

    next();
  } catch (error) {
    logger.error('Error in Monaco context enhancement:', error);
    // Continue without enhanced context if there's an error
    next();
  }
};

/**
 * Analyze code structure to provide better completion context
 */
function analyzeCodeStructure(code, cursorPosition, language) {
  const lines = code.split('\n');
  const currentLine = cursorPosition.line - 1;
  const currentColumn = cursorPosition.column;
  
  try {
    const analysis = {
      // Indentation analysis
      indentation: getIndentationContext(lines, currentLine),
      
      // Scope analysis
      scope: getScopeContext(lines, currentLine, language),
      
      // Syntax context
      syntax: getSyntaxContext(lines, currentLine, currentColumn, language),
      
      // Import/require analysis
      imports: getImportContext(lines, language),
      
      // Function/class context
      structure: getStructureContext(lines, currentLine, language)
    };

    return analysis;
  } catch (error) {
    logger.error('Error analyzing code structure:', error);
    return {};
  }
}

/**
 * Get indentation context for proper code formatting
 */
function getIndentationContext(lines, currentLine) {
  const currentLineText = lines[currentLine] || '';
  const indentMatch = currentLineText.match(/^(\s*)/);
  const currentIndent = indentMatch ? indentMatch[1] : '';
  
  // Detect indentation style (spaces vs tabs)
  const hasSpaces = /^ +/.test(currentLineText);
  const hasTabs = /^\t+/.test(currentLineText);
  
  let indentSize = 2; // default
  if (hasSpaces) {
    // Try to detect space-based indentation size
    for (let i = 0; i < lines.length; i++) {
      const match = lines[i].match(/^( +)/);
      if (match && match[1].length > 0) {
        indentSize = match[1].length;
        break;
      }
    }
  }
  
  return {
    current: currentIndent,
    style: hasTabs ? 'tabs' : 'spaces',
    size: indentSize,
    level: Math.floor(currentIndent.length / (hasTabs ? 1 : indentSize))
  };
}

/**
 * Get scope context (inside function, class, etc.)
 */
function getScopeContext(lines, currentLine, language) {
  const scopes = [];
  let braceCount = 0;
  let parenCount = 0;
  
  // Language-specific scope patterns
  const scopePatterns = {
    javascript: [
      /^\s*(function|class|if|for|while|try|catch)\s*[^{]*{?\s*$/,
      /^\s*(const|let|var)\s+\w+\s*=\s*(function|\([^)]*\)\s*=>)/
    ],
    typescript: [
      /^\s*(function|class|interface|type|if|for|while|try|catch)\s*[^{]*{?\s*$/,
      /^\s*(const|let|var)\s+\w+\s*[:=]\s*(function|\([^)]*\)\s*=>)/
    ],
    python: [
      /^\s*(def|class|if|for|while|try|except|with)\s*[^:]*:\s*$/
    ]
  };
  
  const patterns = scopePatterns[language] || scopePatterns.javascript;
  
  for (let i = 0; i <= currentLine; i++) {
    const line = lines[i];
    
    // Count braces for scope depth
    braceCount += (line.match(/{/g) || []).length;
    braceCount -= (line.match(/}/g) || []).length;
    
    // Check for scope-defining patterns
    for (const pattern of patterns) {
      if (pattern.test(line)) {
        scopes.push({
          type: 'block',
          line: i + 1,
          text: line.trim(),
          depth: braceCount
        });
      }
    }
  }
  
  return {
    current: scopes[scopes.length - 1] || null,
    all: scopes,
    depth: braceCount,
    inFunction: scopes.some(s => s.text.includes('function') || s.text.includes('=>')),
    inClass: scopes.some(s => s.text.includes('class'))
  };
}

/**
 * Get syntax context at cursor position
 */
function getSyntaxContext(lines, currentLine, currentColumn, language) {
  const currentLineText = lines[currentLine] || '';
  const textBeforeCursor = currentLineText.substring(0, currentColumn);
  const textAfterCursor = currentLineText.substring(currentColumn);
  
  // Check what's immediately before cursor
  const beforeCursorTrimmed = textBeforeCursor.trimEnd();
  const lastChar = beforeCursorTrimmed[beforeCursorTrimmed.length - 1];
  const lastTwoChars = beforeCursorTrimmed.slice(-2);
  
  return {
    lastChar,
    lastTwoChars,
    isAfterDot: lastChar === '.',
    isAfterArrow: lastTwoChars === '=>',
    isAfterColon: lastChar === ':',
    isAfterComma: lastChar === ',',
    isAfterOpenParen: lastChar === '(',
    isAfterOpenBrace: lastChar === '{',
    isAfterOpenBracket: lastChar === '[',
    isInString: isInsideString(textBeforeCursor),
    isInComment: isInsideComment(textBeforeCursor, language),
    lineIsEmpty: currentLineText.trim() === '',
    cursorAtLineEnd: currentColumn === currentLineText.length
  };
}

/**
 * Get import/require context
 */
function getImportContext(lines, language) {
  const imports = [];
  const importPatterns = {
    javascript: [
      /^\s*import\s+.*from\s+['"]([^'"]+)['"]/,
      /^\s*const\s+.*=\s*require\(['"]([^'"]+)['"]\)/
    ],
    typescript: [
      /^\s*import\s+.*from\s+['"]([^'"]+)['"]/,
      /^\s*import\s+['"]([^'"]+)['"]/
    ],
    python: [
      /^\s*import\s+([\w.]+)/,
      /^\s*from\s+([\w.]+)\s+import/
    ]
  };
  
  const patterns = importPatterns[language] || importPatterns.javascript;
  
  for (const line of lines) {
    for (const pattern of patterns) {
      const match = line.match(pattern);
      if (match) {
        imports.push({
          module: match[1],
          line: line.trim()
        });
      }
    }
  }
  
  return imports;
}

/**
 * Get code structure context (functions, classes, etc.)
 */
function getStructureContext(lines, currentLine, language) {
  const structures = [];
  
  // Language-specific structure patterns
  const structurePatterns = {
    javascript: [
      { type: 'function', pattern: /^\s*function\s+(\w+)/ },
      { type: 'class', pattern: /^\s*class\s+(\w+)/ },
      { type: 'method', pattern: /^\s*(\w+)\s*\([^)]*\)\s*{/ },
      { type: 'arrow', pattern: /^\s*const\s+(\w+)\s*=\s*\([^)]*\)\s*=>/ }
    ],
    python: [
      { type: 'function', pattern: /^\s*def\s+(\w+)/ },
      { type: 'class', pattern: /^\s*class\s+(\w+)/ }
    ]
  };
  
  const patterns = structurePatterns[language] || structurePatterns.javascript;
  
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    
    for (const { type, pattern } of patterns) {
      const match = line.match(pattern);
      if (match) {
        structures.push({
          type,
          name: match[1],
          line: i + 1,
          text: line.trim(),
          isCurrent: i <= currentLine
        });
      }
    }
  }
  
  return structures;
}

/**
 * Check if cursor is inside a string
 */
function isInsideString(text) {
  let inSingleQuote = false;
  let inDoubleQuote = false;
  let inTemplate = false;
  
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    const prevChar = text[i - 1];
    
    if (char === "'" && prevChar !== '\\') {
      inSingleQuote = !inSingleQuote;
    } else if (char === '"' && prevChar !== '\\') {
      inDoubleQuote = !inDoubleQuote;
    } else if (char === '`' && prevChar !== '\\') {
      inTemplate = !inTemplate;
    }
  }
  
  return inSingleQuote || inDoubleQuote || inTemplate;
}

/**
 * Check if cursor is inside a comment
 */
function isInsideComment(text, language) {
  const commentPatterns = {
    javascript: [/\/\*[^*]*$/, /\/\/.*$/],
    python: [/#.*$/],
    css: [/\/\*[^*]*$/]
  };
  
  const patterns = commentPatterns[language] || commentPatterns.javascript;
  
  return patterns.some(pattern => pattern.test(text));
}

/**
 * Format completion response for Monaco editor
 */
const formatMonacoResponse = (req, res, next) => {
  // Store original json method
  const originalJson = res.json;
  
  res.json = function(data) {
    // If this is a completion response, format it for Monaco
    if (data && data.success && req.path.includes('/completions/')) {
      const monacoContext = req.monacoContext;
      
      if (monacoContext && data.completion) {
        // Format completion for Monaco editor
        data.monaco = {
          insertText: data.completion,
          range: {
            startLineNumber: monacoContext.currentLineNumber,
            startColumn: monacoContext.currentColumn + 1,
            endLineNumber: monacoContext.currentLineNumber,
            endColumn: monacoContext.currentColumn + 1
          },
          kind: getCompletionKind(data.completion, monacoContext),
          detail: `AI Completion (${data.tokenCount || 0} tokens)`,
          documentation: 'Generated by Gemini 2.5 Flash'
        };
      }
    }
    
    // Call original json method
    return originalJson.call(this, data);
  };
  
  next();
};

/**
 * Determine Monaco completion kind based on content
 */
function getCompletionKind(completion, context) {
  // Monaco completion kinds (simplified)
  const kinds = {
    Method: 0,
    Function: 1,
    Constructor: 2,
    Field: 3,
    Variable: 4,
    Class: 5,
    Interface: 6,
    Module: 7,
    Property: 8,
    Unit: 9,
    Value: 10,
    Enum: 11,
    Keyword: 12,
    Snippet: 13,
    Text: 14,
    Color: 15,
    File: 16,
    Reference: 17
  };
  
  // Simple heuristics to determine completion kind
  if (completion.includes('function') || completion.includes('=>')) {
    return kinds.Function;
  }
  if (completion.includes('class')) {
    return kinds.Class;
  }
  if (completion.includes('const') || completion.includes('let') || completion.includes('var')) {
    return kinds.Variable;
  }
  if (context.isAfterDot) {
    return kinds.Property;
  }
  
  return kinds.Text;
}

module.exports = {
  enhanceMonacoContext,
  formatMonacoResponse
};