// Simple test script to verify backend setup
const mongoose = require('mongoose');
require('dotenv').config();

const testSetup = async () => {
  console.log('🚀 Testing CollabCode Backend Setup...');
  console.log('=====================================');
  
  // Test environment variables
  console.log('\n📋 Environment Variables:');
  console.log(`PORT: ${process.env.PORT || 'Not set (will use 5000)'}`);
  console.log(`NODE_ENV: ${process.env.NODE_ENV || 'Not set (will use development)'}`);
  console.log(`MONGODB_URI: ${process.env.MONGODB_URI ? 'Set' : 'Not set'}`);
  console.log(`JWT_SECRET: ${process.env.JWT_SECRET ? 'Set' : 'Not set'}`);
  
  // Test MongoDB connection
  console.log('\n🗄️  Testing MongoDB Connection...');
  try {
    if (!process.env.MONGODB_URI) {
      console.log('❌ MONGODB_URI not set in .env file');
      console.log('💡 Please set MONGODB_URI in your .env file');
      console.log('   Example: MONGODB_URI=mongodb://localhost:27017/collabcode');
    } else {
      await mongoose.connect(process.env.MONGODB_URI);
      console.log('✅ MongoDB connection successful');
      await mongoose.connection.close();
    }
  } catch (error) {
    console.log('❌ MongoDB connection failed:', error.message);
    console.log('💡 Make sure MongoDB is running and the URI is correct');
  }
  
  // Test required modules
  console.log('\n📦 Testing Required Modules...');
  const modules = [
    'express',
    'mongoose',
    'bcryptjs',
    'jsonwebtoken',
    'express-validator',
    'helmet',
    'cors',
    'express-rate-limit',
    'winston',
    'socket.io'
  ];
  
  modules.forEach(module => {
    try {
      require(module);
      console.log(`✅ ${module}`);
    } catch (error) {
      console.log(`❌ ${module} - ${error.message}`);
    }
  });
  
  // Test file structure
  console.log('\n📁 Testing File Structure...');
  const fs = require('fs');
  const path = require('path');
  
  const requiredFiles = [
    'src/server.js',
    'src/models/User.js',
    'src/models/Project.js',
    'src/models/File.js',
    'src/routes/auth.js',
    'src/routes/users.js',
    'src/routes/projects.js',
    'src/routes/files.js',
    'src/middleware/auth.js',
    'src/middleware/errorHandler.js',
    'src/utils/logger.js',
    'src/utils/validation.js',
    'src/config/database.js',
    'src/socket/socketHandler.js',
    '.env',
    'package.json'
  ];
  
  requiredFiles.forEach(file => {
    const filePath = path.join(__dirname, file);
    if (fs.existsSync(filePath)) {
      console.log(`✅ ${file}`);
    } else {
      console.log(`❌ ${file} - File not found`);
    }
  });
  
  console.log('\n🎉 Setup test completed!');
  console.log('\n📝 Next Steps:');
  console.log('1. Make sure MongoDB is running');
  console.log('2. Update .env file with your database URI');
  console.log('3. Run: npm run dev');
  console.log('4. Test the API endpoints');
};

testSetup().catch(console.error);