// server.js
const express = require('express');
const app = express();

const PORT = 8080;

// Middleware to parse JSON bodies
app.use(express.json());

// make a route for signing up users, should be super detailed and cover all cases.
app.post('/signup', async (req, res) => {
  try {
    const { username, email, password } = req.body;

    // ... validation and database interaction ...
        if (!username || !email || !password) {
      return res.status(400).json({ error: 'All fields are required' });
    }
    // ... further validation (e.g., email format, password strength) ...
  

    res.status(201).json({ message: 'User created successfully' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});







app.get('/', (req, res) => {
  res.send('Welcome to the Home Page 🏠');
});

// About route
app.get('/about', (req, res) => {
  res.send('About Page: Built with Express.js 📖');
});

// Contact route (GET)
app.get('/contact', (req, res) => {
  res.send('Contact Page: Email us at hello@example.com ✉️');
});

// Contact route (POST) → accepts JSON data
app.post('/contact', (req, res) => {
  const { name, message } = req.body;
  res.send(`Thanks ${name}, we got your message: "${message}" ✅`);
});

// Services route
app.get('/services', (req, res) => {
  res.json({
    services: ['Web Development', 'API Development', 'AI Integration'],
  });
});

// Dynamic route example
app.get('/user/:id', (req, res) => {
  res.send(`User Profile for ID: ${req.params.id}`);
});

// 404 fallback
app.use((req, res) => {
  res.status(404).send('404 Not Found ❌');
});

// Start server
app.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
});


























