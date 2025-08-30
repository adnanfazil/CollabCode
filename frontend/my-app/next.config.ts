import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  async rewrites() {
    return [
      {
        source: "/api/:path*",
        destination: "http://localhost:5000/api/:path*"
      }
      // Removed socket.io rewrite - WebSocket connections should go directly to the backend
    ];
  }
};

export default nextConfig;