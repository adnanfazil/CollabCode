// server.js
const http = require('http');

const PORT = 8010;

const server = http.createServer((req, res) => {
  res.setHeader('Content-Type', 'text/plain');

  if (req.method === 'GET' && req.url === '/') {
    res.writeHead(200);
    res.end('Welcome to the Home Page 🏠');
  }
  else if (req.method === 'GET' && req.url === '/about') {
    res.writeHead(200);
    res.end('About Page: This is a simple Node.js HTTP server 📖');
  }
  else if (req.method === 'GET' && req.url === '/contact') {
    res.writeHead(200);
    res.end('Contact Page: Email us at hello@example.com ✉️');
  }
  else {
    res.writeHead(404);
    res.end('404 Not Found ❌');
  }
});

server.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
});
