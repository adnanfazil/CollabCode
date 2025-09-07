// main.js
    const http = require('http');

const hostname = '127.0.0.1'; // localhost
    
   

    const port = 3000;

    // Create an HTTP server
    const server = http.createServer((req, res) => {
      // Set the response HTTP header with a status code and content type
      res.setHeader('Content-Type', 'text/plain');

      // Check the request URL to determine the route
      if (req.url === '/') {
        // Default route
        res.statusCode = 200;
        res.end('Hello, World!\n');
      } else if (req.url === '/api/hello') {
        // New route: /api/hello
        res.statusCode = 200;
        res.end('Hello from API!\n');
      } else {
        // Handle 404 Not Found for other routes
        res.statusCode = 404;
        res.end('404 Not Found\n');
      }
    });

   

    // The server listens on the specified port and hostname
    server.listen(port, hostname, () => {
      console.log(`Server running at http://${hostname}:${port}/`);
    });