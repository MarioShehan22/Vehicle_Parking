const WebSocket = require('ws');
const { parkingData } = require('../models/parkingModel');
const { logEvent } = require('../utils/logger');

const clients = new Map();

function setupWebSocket(server) {
    const wss = new WebSocket.Server({ server });

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
            ws.send(JSON.stringify({ command: 'get_status' }));
        } else {
            ws.send(JSON.stringify({ type: 'initial_data', data: parkingData }));
        }

        ws.on('message', (message) => {
            try {
                const data = JSON.parse(message.toString());
                require('../controllers/websocketController').handleMessage(ws, data);
            } catch (error) {
                ws.send(JSON.stringify({ error: 'Invalid JSON format', timestamp: new Date().toISOString() }));
            }
        });

        ws.on('close', () => {
            clients.delete(clientId);
            if (ws.clientType === 'arduino') {
                logEvent({ type: 'arduino_disconnected', clientId, ip: clientIP });
                parkingData.wifiConnected = false;
                broadcastToWebClients({ type: 'arduino_status', connected: false });
            }
        });

        ws.on('error', (error) => {
            console.error(`WebSocket error for ${ws.clientType}:`, error);
        });
    });

    function broadcastToWebClients(data) {
        wss.clients.forEach(client => {
            if (client.readyState === WebSocket.OPEN && client.clientType === 'web') {
                client.send(JSON.stringify(data));
            }
        });
    }

    return { wss, clients, broadcastToWebClients };
}

module.exports = {
    setupWebSocket,
    clients
};
