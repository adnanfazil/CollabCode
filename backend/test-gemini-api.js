// Gemini 2.5 Flash API Test Script
const apiKey = 'AIzaSyAkYkyazzOSJ02QmoLIlbcFKUMD6I28cuM';
const API_URL = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent';

async function testGeminiAPI() {
  console.log('🚀 Testing Gemini 2.5 Flash API...');
  console.log('📡 Sending "Hi" to Gemini...\n');

  const requestBody = {
    contents: [{
      parts: [{
        text: "Hi"
      }]
    }]
  };

  try {
    const response = await fetch(`${API_URL}?key=${apiKey}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(requestBody)
    });

    console.log('📊 Response Status:', response.status, response.statusText);
    
    if (!response.ok) {
      const errorText = await response.text();
      console.error('❌ API Error:', errorText);
      return;
    }

    const data = await response.json();
    
    console.log('✅ API Response received!');
    console.log('📝 Full Response:');
    console.log(JSON.stringify(data, null, 2));
    
    if (data.candidates && data.candidates[0] && data.candidates[0].content) {
      const responseText = data.candidates[0].content.parts[0].text;
      console.log('\n🤖 Gemini\'s Response:');
      console.log(responseText);
    }

  } catch (error) {
    console.error('❌ Network Error:', error.message);
    
    if (error.name === 'TypeError' && error.message.includes('fetch')) {
      console.log('\n💡 If running in Node.js < 18, install node-fetch:');
      console.log('npm install node-fetch');
      console.log('Then add: const fetch = require("node-fetch"); at the top');
    }
  }
}

// Alternative version using node-fetch for older Node.js versions
async function testGeminiAPIWithNodeFetch() {
  // Uncomment the line below if using Node.js < 18
  // const fetch = require('node-fetch');
  
  console.log('🚀 Testing Gemini 2.5 Flash API (with node-fetch)...');
  
  const requestBody = {
    contents: [{
      parts: [{
        text: "Hi"
      }]
    }]
  };

  try {
    const response = await fetch(`${API_URL}?key=${apiKey}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(requestBody)
    });

    const data = await response.json();
    
    if (response.ok) {
      console.log('✅ Success!');
      console.log('🤖 Gemini says:', data.candidates[0].content.parts[0].text);
    } else {
      console.error('❌ Error:', data.error?.message || 'Unknown error');
    }

  } catch (error) {
    console.error('❌ Error:', error.message);
  }
}

// Run the test
testGeminiAPI();

// Uncomment to test with node-fetch instead
 testGeminiAPIWithNodeFetch();