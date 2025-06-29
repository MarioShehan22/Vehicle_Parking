const http = require('http');
const app = require('./app');
const { setupWebSocket } = require('./services/websocketService');

const PORT = process.env.PORT || 3001;

// Create HTTP server
const server = http.createServer(app);

// Setup WebSocket
setupWebSocket(server);

// Start server
server.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 Server running on http://localhost:${PORT}`);
});
