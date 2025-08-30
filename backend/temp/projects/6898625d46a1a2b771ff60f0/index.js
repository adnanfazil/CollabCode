// Import express
const express = require("express");

// Create an express app
const app = express();

// Define a port
const PORT = 3002;

// Define a route
app.get("/", (req, res) => {
  res.send("Hello, Waleed! 🌍");
});

// Another route
app.get("/about", (req, res) => {
  res.send("This is a small Express HTTP server.");
});

// Start the server
app.listen(PORT, () => {
  console.log(`Server is running at http://localhost:${PORT}`);
});







