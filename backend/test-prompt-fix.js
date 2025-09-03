const { GoogleGenerativeAI } = require('@google/generative-ai');
require('dotenv').config();

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

function buildCompletionPrompt(code, language, filename) {
  return `You are an expert ${language} developer providing code completions.

Context:
- Language: ${language}
- File: ${filename}
- Task: Complete the code naturally and concisely

Instructions:
- Use modern ES6+ syntax
- Follow best practices
- Write clean, readable code

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

async function testNewPrompt() {
  console.log('🧪 Testing new prompt format...');
  
  const model = genAI.getGenerativeModel({ model: 'gemini-1.5-flash' });
  
  const testCode = `function calculateSum(a, b) {
  return`;
  
  const prompt = buildCompletionPrompt(testCode, 'javascript', 'test.js');
  
  console.log('📝 Prompt:', prompt);
  console.log('\n🤖 Calling Gemini API...');
  
  try {
    const result = await model.generateContent(prompt);
    const response = await result.response;
    const text = response.text();
    
    console.log('✅ Response received:');
    console.log('Length:', text.length);
    console.log('Content:', JSON.stringify(text));
    console.log('First 10 chars:', JSON.stringify(text.slice(0, 10)));
    
  } catch (error) {
    console.error('❌ Error:', error);
  }
}

testNewPrompt();