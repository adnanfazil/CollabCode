const { MongoMemoryServer } = require('mongodb-memory-server');
const Redis = require('ioredis-mock');

module.exports = async () => {
  // Start in-memory MongoDB for testing
  const mongod = await MongoMemoryServer.create({
    instance: {
      port: 27017,
      dbName: 'collabcode_test'
    }
  });

  const uri = mongod.getUri();
  process.env.MONGODB_URI = uri;
  
  // Store the MongoDB instance globally for cleanup
  global.__MONGOD__ = mongod;

  // Mock Redis for testing
  global.__REDIS_MOCK__ = new Redis();
  
  console.log('Test environment setup complete');
  console.log(`MongoDB URI: ${uri}`);
};