const { GoogleGenerativeAI } = require('@google/generative-ai');
require('dotenv').config();

async function testGeminiDirect() {
  try {
    console.log('🔧 Testing Gemini API with different configurations...');
    console.log('API Key exists:', !!process.env.GEMINI_API_KEY);
    
    const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
    
    // Test 1: Basic model without generation config
    console.log('\n🧪 Test 1: Basic model');
    const basicModel = genAI.getGenerativeModel({ model: 'gemini-1.5-flash' });
    
    const result1 = await basicModel.generateContent('Complete: function add(a, b) {');
    const response1 = await result1.response;
    const text1 = response1.text();
    
    console.log('✅ Basic model result:', JSON.stringify(text1));
    console.log('Length:', text1.length);
    
    // Test 2: Model with minimal config
    console.log('\n🧪 Test 2: Model with minimal config');
    const minimalModel = genAI.getGenerativeModel({ 
      model: 'gemini-1.5-flash',
      generationConfig: {
        maxOutputTokens: 100
      }
    });
    
    const result2 = await minimalModel.generateContent('Complete: function add(a, b) {');
    const response2 = await result2.response;
    const text2 = response2.text();
    
    console.log('✅ Minimal config result:', JSON.stringify(text2));
    console.log('Length:', text2.length);
    
    // Test 3: Different prompt style
    console.log('\n🧪 Test 3: Different prompt style');
    const result3 = await basicModel.generateContent('What comes after: function add(a, b) {');
    const response3 = await result3.response;
    const text3 = response3.text();
    
    console.log('✅ Different style result:', JSON.stringify(text3));
    console.log('Length:', text3.length);
    
    // Test 4: Check if stopSequences are the issue
    console.log('\n🧪 Test 4: Model without stopSequences');
    const noStopModel = genAI.getGenerativeModel({ 
      model: 'gemini-1.5-flash',
      generationConfig: {
        temperature: 0.3,
        topK: 40,
        topP: 0.95,
        maxOutputTokens: 512
        // Removed stopSequences
      }
    });
    
    const result4 = await noStopModel.generateContent('Complete: function add(a, b) {');
    const response4 = await result4.response;
    const text4 = response4.text();
    
    console.log('✅ No stop sequences result:', JSON.stringify(text4));
    console.log('Length:', text4.length);
    
  } catch (error) {
    console.error('❌ Error testing Gemini API:', error);
    if (error.message) {
      console.error('Error message:', error.message);
    }
    if (error.status) {
      console.error('HTTP status:', error.status);
    }
  }
}

testGeminiDirect();