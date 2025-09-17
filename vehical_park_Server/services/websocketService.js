const WebSocket = require('ws');
let { parkingData } = require('../models/parkingModel'); // Use let instead of const
const { logEvent } = require('../utils/logger');

const clients = new Map();
let broadcastToWebClients; // Declare this at module level

// Helper function to check if message is valid JSON
function isValidJson(message) {
    try {
        JSON.parse(message);
        return true;
    } catch (error) {
        return false;
    }
}

function setupWebSocket(server) {
    const wss = new WebSocket.Server({ server });

    // Define broadcast function
    broadcastToWebClients = (data) => {
        wss.clients.forEach(client => {
            if (client.readyState === WebSocket.OPEN && client.clientType === 'web') {
                try {
                    client.send(JSON.stringify(data));
                } catch (error) {
                    console.error('Error broadcasting to web client:', error);
                }
            }
        });
    };

    wss.on('connection', (ws, req) => {
        const clientId = Date.now() + Math.random();
        const clientIP = req.socket.remoteAddress;

        const userAgent = req.headers['user-agent'] || '';
        const isArduino = userAgent.includes('ESP8266') || userAgent.includes('Arduino') || req.headers['x-client-type'] === 'arduino';

        ws.clientType = isArduino ? 'arduino' : 'web';
        ws.clientId = clientId;
        ws.connectedAt = new Date();

        clients.set(clientId, { ws, type: ws.clientType, ip: clientIP, connectedAt: ws.connectedAt });

        if (ws.clientType === 'arduino') {
            logEvent({ type: 'arduino_connected', clientId, ip: clientIP });
            console.log(`Arduino connected from IP: ${clientIP}`);

            // Update wifi status
            parkingData.wifiConnected = true;
            broadcastToWebClients({ type: 'arduino_status', connected: true, clientId });

            // Request initial status
            try {
                ws.send(JSON.stringify({ command: 'get_status' }));
            } catch (error) {
                console.error('Error sending get_status command:', error);
            }
        } else {
            console.log(`Web client connected from IP: ${clientIP}`);
            try {
                ws.send(JSON.stringify({ type: 'initial_data', data: parkingData }));
            } catch (error) {
                console.error('Error sending initial data to web client:', error);
            }
        }

        // Handle incoming WebSocket messages from clients
        ws.on('message', (message) => {
            const messageStr = message.toString('utf-8');
            if (isValidJson(messageStr)) {
                try {
                    const data = JSON.parse(messageStr);
                    require('../controllers/websocketController').handleMessage(ws, data);
                } catch (error) {
                    console.error("Error handling message:", error);
                }
            } else {
                console.error("Invalid message format: Not JSON", messageStr);
                try {
                    ws.send(JSON.stringify({
                        error: 'Invalid JSON format',
                        timestamp: new Date().toISOString()
                    }));
                } catch (error) {
                    console.error('Error sending error message to client:', error);
                }
            }
        });

        // Handle WebSocket disconnection
        ws.on('close', () => {
            clients.delete(clientId);
            if (ws.clientType === 'arduino') {
                logEvent({ type: 'arduino_disconnected', clientId, ip: clientIP });
                parkingData.wifiConnected = false;
                broadcastToWebClients({ type: 'arduino_status', connected: false, clientId });
            }
            console.log(`${ws.clientType} client disconnected, IP: ${clientIP}`);
        });

        // Handle WebSocket error
        ws.on('error', (error) => {
            console.error(`WebSocket error for ${ws.clientType} ${ws.clientId}:`, error);
        });
    });

    return { wss, clients, broadcastToWebClients };
}

module.exports = {
    setupWebSocket,
    clients,
    broadcastToWebClients: (data) => {
        if (broadcastToWebClients) {
            broadcastToWebClients(data);
        }
    }
};