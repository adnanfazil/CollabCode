const ResponseProcessingService = require('../../src/services/responseProcessingService');

describe('ResponseProcessingService', () => {
  let responseProcessingService;

  beforeEach(() => {
    responseProcessingService = new ResponseProcessingService();
  });

  describe('processResponse', () => {
    it('should process a simple text response', () => {
      const rawResponse = 'This is a simple response without any special formatting.';
      const options = {
        formatMarkdown: true,
        includeCodeHighlighting: false,
        extractSuggestions: false
      };

      const result = responseProcessingService.processResponse(rawResponse, options);

      expect(result.formattedText).toBe(rawResponse);
      expect(result.responseType).toBe('text');
      expect(result.codeBlocks).toEqual([]);
      expect(result.suggestions).toEqual([]);
      expect(result.links).toEqual([]);
    });

    it('should extract and format code blocks', () => {
      const rawResponse = `Here's how to fix the issue:

\`\`\`javascript
const express = require('express');
const app = express();
app.listen(3000);
\`\`\`

This should resolve your problem.`;
      
      const options = {
        formatMarkdown: true,
        includeCodeHighlighting: true,
        extractSuggestions: false
      };

      const result = responseProcessingService.processResponse(rawResponse, options);

      expect(result.responseType).toBe('code_solution');
      expect(result.codeBlocks).toHaveLength(1);
      expect(result.codeBlocks[0].language).toBe('javascript');
      expect(result.codeBlocks[0].code).toContain('const express = require');
      expect(result.formattedText).toContain('Here\'s how to fix');
    });

    it('should extract suggestions from response', () => {
      const rawResponse = `To solve this issue, I suggest:

1. Update your dependencies
2. Clear the npm cache
3. Restart your development server

These steps should help resolve the problem.`;
      
      const options = {
        formatMarkdown: true,
        includeCodeHighlighting: false,
        extractSuggestions: true
      };

      const result = responseProcessingService.processResponse(rawResponse, options);

      expect(result.responseType).toBe('suggestions');
      expect(result.suggestions).toHaveLength(3);
      expect(result.suggestions[0]).toContain('Update your dependencies');
      expect(result.suggestions[1]).toContain('Clear the npm cache');
      expect(result.suggestions[2]).toContain('Restart your development server');
    });

    it('should extract links from response', () => {
      const rawResponse = `For more information, check out:
- [React Documentation](https://reactjs.org/docs)
- [Node.js Guide](https://nodejs.org/en/docs/)

You can also visit https://stackoverflow.com for community help.`;
      
      const options = {
        formatMarkdown: true,
        includeCodeHighlighting: false,
        extractSuggestions: false
      };

      const result = responseProcessingService.processResponse(rawResponse, options);

      expect(result.links).toHaveLength(3);
      expect(result.links[0]).toEqual({
        text: 'React Documentation',
        url: 'https://reactjs.org/docs'
      });
      expect(result.links[1]).toEqual({
        text: 'Node.js Guide',
        url: 'https://nodejs.org/en/docs/'
      });
      expect(result.links[2]).toEqual({
        text: 'https://stackoverflow.com',
        url: 'https://stackoverflow.com'
      });
    });

    it('should handle mixed content with code, suggestions, and links', () => {
      const rawResponse = `Here's how to fix your React component error:

\`\`\`jsx
import React, { useState } from 'react';

function MyComponent() {
  const [count, setCount] = useState(0);
  return <div>{count}</div>;
}
\`\`\`

I recommend:
1. Always import React when using JSX
2. Use functional components with hooks

For more details, see [React Hooks Guide](https://reactjs.org/docs/hooks-intro.html).`;
      
      const options = {
        formatMarkdown: true,
        includeCodeHighlighting: true,
        extractSuggestions: true
      };

      const result = responseProcessingService.processResponse(rawResponse, options);

      expect(result.responseType).toBe('comprehensive');
      expect(result.codeBlocks).toHaveLength(1);
      expect(result.codeBlocks[0].language).toBe('jsx');
      expect(result.suggestions).toHaveLength(2);
      expect(result.links).toHaveLength(1);
      expect(result.links[0].text).toBe('React Hooks Guide');
    });
  });

  describe('extractCodeBlocks', () => {
    it('should extract multiple code blocks with different languages', () => {
      const text = `\`\`\`javascript
console.log('Hello');
\`\`\`

\`\`\`css
body { margin: 0; }
\`\`\`

\`\`\`
plain code block
\`\`\``;

      const result = responseProcessingService.extractCodeBlocks(text);

      expect(result).toHaveLength(3);
      expect(result[0].language).toBe('javascript');
      expect(result[1].language).toBe('css');
      expect(result[2].language).toBe('');
    });

    it('should handle inline code blocks', () => {
      const text = 'Use `npm install` to install dependencies and `npm start` to run.';

      const result = responseProcessingService.extractCodeBlocks(text);

      expect(result).toHaveLength(2);
      expect(result[0].code).toBe('npm install');
      expect(result[1].code).toBe('npm start');
      expect(result[0].inline).toBe(true);
      expect(result[1].inline).toBe(true);
    });
  });

  describe('extractSuggestions', () => {
    it('should extract numbered suggestions', () => {
      const text = `Here are my suggestions:
1. First suggestion
2. Second suggestion
3. Third suggestion`;

      const result = responseProcessingService.extractSuggestions(text);

      expect(result).toHaveLength(3);
      expect(result[0]).toBe('First suggestion');
      expect(result[1]).toBe('Second suggestion');
      expect(result[2]).toBe('Third suggestion');
    });

    it('should extract bulleted suggestions', () => {
      const text = `Recommendations:
- Use TypeScript for better type safety
- Implement error boundaries
- Add unit tests`;

      const result = responseProcessingService.extractSuggestions(text);

      expect(result).toHaveLength(3);
      expect(result[0]).toBe('Use TypeScript for better type safety');
      expect(result[1]).toBe('Implement error boundaries');
      expect(result[2]).toBe('Add unit tests');
    });
  });

  describe('extractLinks', () => {
    it('should extract markdown links', () => {
      const text = 'Check [React Docs](https://reactjs.org) and [MDN](https://developer.mozilla.org).';

      const result = responseProcessingService.extractLinks(text);

      expect(result).toHaveLength(2);
      expect(result[0]).toEqual({ text: 'React Docs', url: 'https://reactjs.org' });
      expect(result[1]).toEqual({ text: 'MDN', url: 'https://developer.mozilla.org' });
    });

    it('should extract plain URLs', () => {
      const text = 'Visit https://example.com or http://test.org for more info.';

      const result = responseProcessingService.extractLinks(text);

      expect(result).toHaveLength(2);
      expect(result[0]).toEqual({ text: 'https://example.com', url: 'https://example.com' });
      expect(result[1]).toEqual({ text: 'http://test.org', url: 'http://test.org' });
    });
  });

  describe('determineResponseType', () => {
    it('should identify error resolution responses', () => {
      const response = 'This error occurs because of a missing dependency. To fix it, run npm install.';
      const codeBlocks = [];
      const suggestions = ['Run npm install', 'Check package.json'];

      const result = responseProcessingService.determineResponseType(response, codeBlocks, suggestions);

      expect(result).toBe('error_resolution');
    });

    it('should identify code solution responses', () => {
      const response = 'Here is the solution:';
      const codeBlocks = [{ language: 'javascript', code: 'console.log("test");' }];
      const suggestions = [];

      const result = responseProcessingService.determineResponseType(response, codeBlocks, suggestions);

      expect(result).toBe('code_solution');
    });

    it('should identify comprehensive responses', () => {
      const response = 'Here is a complete solution with code and recommendations.';
      const codeBlocks = [{ language: 'javascript', code: 'console.log("test");' }];
      const suggestions = ['Use best practices', 'Add error handling'];

      const result = responseProcessingService.determineResponseType(response, codeBlocks, suggestions);

      expect(result).toBe('comprehensive');
    });
  });
});