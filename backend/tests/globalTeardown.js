module.exports = async () => {
  // Stop the in-memory MongoDB instance
  if (global.__MONGOD__) {
    await global.__MONGOD__.stop();
    console.log('MongoDB test instance stopped');
  }

  // Clean up Redis mock
  if (global.__REDIS_MOCK__) {
    global.__REDIS_MOCK__.disconnect();
    console.log('Redis mock disconnected');
  }

  console.log('Test environment cleanup complete');
};