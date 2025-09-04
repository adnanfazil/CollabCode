const http = require('http');
const fs = require('fs');

const BASE_URL = 'http://localhost:5000';
let authToken = null;

// Test user credentials (you may need to adjust these)
const testUser = {
  email: `test-${Date.now()}@example.com`,
  password: 'TestPassword123'
};

// Helper function to make HTTP requests
function makeRequest(method, path, data = null, headers = {}) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: 'localhost',
      port: 5000,
      path: path,
      method: method,
      headers: {
        'Content-Type': 'application/json',
        ...headers
      }
    };

    if (data) {
      const jsonData = JSON.stringify(data);
      options.headers['Content-Length'] = Buffer.byteLength(jsonData);
    }

    const req = http.request(options, (res) => {
      let responseData = '';
      
      res.on('data', (chunk) => {
        responseData += chunk;
      });
      
      res.on('end', () => {
        try {
          const parsedData = JSON.parse(responseData);
          if (res.statusCode >= 200 && res.statusCode < 300) {
            resolve({ data: parsedData, statusCode: res.statusCode });
          } else {
            reject({ response: { data: parsedData, status: res.statusCode } });
          }
        } catch (error) {
          reject({ message: 'Invalid JSON response', response: { data: responseData } });
        }
      });
    });

    req.on('error', (error) => {
      reject({ message: error.message });
    });

    if (data) {
      req.write(JSON.stringify(data));
    }
    
    req.end();
  });
}

async function login() {
  try {
    console.log('🔐 Attempting to login...');
    const response = await makeRequest('POST', '/api/auth/login', testUser);
    authToken = response.data.data.accessToken;
    console.log('✅ Login successful');
    return true;
  } catch (error) {
    console.log('❌ Login failed:', error.response?.data?.message || error.message);
    
    // Try to register if login fails
    try {
      console.log('🔐 Attempting to register new user...');
      const regResponse = await makeRequest('POST', '/api/auth/register', {
        ...testUser,
        name: 'Test User'
      });
      authToken = regResponse.data.data.accessToken;
      console.log('✅ Registration successful with token');
      return true;
    } catch (regError) {
      console.log('❌ Registration also failed:', regError.response?.data?.message || regError.message);
      return false;
    }
  }
}

async function createTestProject() {
  try {
    console.log('📁 Creating test project...');
    const response = await makeRequest('POST', '/api/projects', {
      name: 'Test Project for File Attachments',
      description: 'Testing file attachment functionality',
      type: 'javascript'
    }, {
      Authorization: `Bearer ${authToken}`
    });
    
    console.log('✅ Test project created:', response.data.data.project._id);
    return response.data.data.project._id;
  } catch (error) {
    console.log('❌ Failed to create project:', error.response?.data?.message || error.message);
    return null;
  }
}

async function createTestFile(projectId) {
  try {
    console.log('📄 Creating test file...');
    const response = await makeRequest('POST', '/api/files', {
      name: 'test.js',
      content: `// Test file for attachment functionality\nconsole.log('Hello, World!');\n\nfunction greet(name) {\n  return \`Hello, \${name}!\`;\n}\n\nmodule.exports = { greet };`,
      project: projectId,
      type: 'file'
    }, {
      Authorization: `Bearer ${authToken}`
    });
    
    console.log('✅ Test file created:', response.data.data.file._id);
    return response.data.data.file._id;
  } catch (error) {
    console.log('❌ Failed to create file:', error.response?.data?.message || error.message);
    return null;
  }
}

async function testFileContentEndpoint(fileId) {
  try {
    console.log('🔍 Testing GET /api/files/:id/content endpoint...');
    const response = await makeRequest('GET', `/api/files/${fileId}/content`, null, {
      Authorization: `Bearer ${authToken}`
    });
    
    console.log('✅ File content endpoint works!');
    console.log('📊 Response data:', {
      fileId: response.data.data.fileId,
      name: response.data.data.name,
      language: response.data.data.language,
      size: response.data.data.size,
      totalLines: response.data.data.totalLines,
      truncated: response.data.data.truncated
    });
    
    // Verify content is present
    if (!response.data.data.content || response.data.data.content.length === 0) {
      console.log('❌ File content endpoint failed: No content returned');
      return false;
    }
    
    console.log('📝 Content preview:', response.data.data.content.substring(0, 100) + '...');
    return true;
  } catch (error) {
    console.log('❌ File content endpoint failed:', error.response?.data?.message || error.message);
    return false;
  }
}

async function testChatbotWithAttachments(projectId, fileId) {
  try {
    console.log('🤖 Testing chatbot with file attachments...');
    
    // First create a chat session
    const sessionResponse = await makeRequest('POST', '/api/chatbot/session', {
      projectId: projectId
    }, {
      Authorization: `Bearer ${authToken}`
    });
    
    const sessionId = sessionResponse.data.data?.sessionId;
    console.log('✅ Chat session created:', sessionId);
    
    // Now send a message with file attachment
    const queryResponse = await makeRequest('POST', '/api/chatbot/query', {
      query: 'Can you explain what this attached file does?',
      sessionId: sessionId,
      attachments: [fileId]  // This is the new functionality we're testing
    }, {
      Authorization: `Bearer ${authToken}`
    });
    
    console.log('✅ Chatbot query with attachment successful!');
    console.log('🤖 Response preview:', queryResponse.data.data?.response?.substring(0, 200) + '...');
    return true;
  } catch (error) {
    console.log('❌ Chatbot with attachments failed:', error.response?.data?.message || error.message);
    if (error.response?.data) {
      console.log('Error details:', error.response.data);
    }
    return false;
  }
}

async function runTests() {
  console.log('🚀 Starting file attachment functionality tests...\n');
  
  // Step 1: Login
  const loginSuccess = await login();
  if (!loginSuccess) {
    console.log('❌ Cannot proceed without authentication');
    return;
  }
  
  // Step 2: Create test project
  const projectId = await createTestProject();
  if (!projectId) {
    console.log('❌ Cannot proceed without a project');
    return;
  }
  
  // Step 3: Create test file
  const fileId = await createTestFile(projectId);
  if (!fileId) {
    console.log('❌ Cannot proceed without a file');
    return;
  }
  
  // Step 4: Test file content endpoint
  const contentEndpointWorks = await testFileContentEndpoint(fileId);
  
  // Step 5: Test chatbot with attachments
  const chatbotWorks = await testChatbotWithAttachments(projectId, fileId);
  
  // Summary
  console.log('\n📋 Test Results Summary:');
  console.log(`✅ Authentication: ${loginSuccess ? 'PASS' : 'FAIL'}`);
  console.log(`✅ Project Creation: ${projectId ? 'PASS' : 'FAIL'}`);
  console.log(`✅ File Creation: ${fileId ? 'PASS' : 'FAIL'}`);
  console.log(`✅ File Content Endpoint: ${contentEndpointWorks ? 'PASS' : 'FAIL'}`);
  console.log(`✅ Chatbot with Attachments: ${chatbotWorks ? 'PASS' : 'FAIL'}`);
  
  if (contentEndpointWorks && chatbotWorks) {
    console.log('\n🎉 All file attachment functionality tests PASSED!');
  } else {
    console.log('\n⚠️  Some tests failed. Check the logs above for details.');
  }
}

// Run the tests
runTests().catch(console.error);