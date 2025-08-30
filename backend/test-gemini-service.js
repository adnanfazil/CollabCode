// Test script for the updated GeminiService
require('dotenv').config();
const GeminiService = require('./src/services/geminiService');

async function testGeminiService() {
  console.log('🚀 Testing updated GeminiService...');
  
  const geminiService = new GeminiService();
  
  // Test connection validation
  console.log('\n📡 Testing connection validation...');
  const isValid = await geminiService.validateConnection();
  console.log('Connection valid:', isValid);
  
  if (!isValid) {
    console.log('❌ Connection validation failed. Check your GEMINI_API_KEY.');
    return;
  }
  
  // Test error solution generation
  console.log('\n🤖 Testing error solution generation...');
  const testQuery = 'Hello, can you help me with a coding question?';
  const context = {
    projectType: 'Node.js',
    language: 'JavaScript'
  };
  
  try {
    const result = await geminiService.generateErrorSolution(testQuery, context);
    
    console.log('\n✅ Result received!');
    console.log('Success:', result.success);
    
    if (result.success) {
      console.log('\n🤖 Gemini Response:');
      console.log(result.response);
      console.log('\n📊 Metadata:');
      console.log(JSON.stringify(result.metadata, null, 2));
    } else {
      console.log('❌ Error:', result.error);
      console.log('Fallback response:', result.fallbackResponse);
    }
    
  } catch (error) {
    console.error('❌ Test failed:', error.message);
  }
}

// Run the test
testGeminiService();