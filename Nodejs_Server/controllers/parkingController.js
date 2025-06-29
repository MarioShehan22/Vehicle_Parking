const { parkingData } = require('../models/parkingModel');
const { clients } = require('../services/websocketService');

exports.getStatus = (req, res) => {
    res.json({
        success: true,
        data: parkingData,
        connectedClients: {
            total: clients.size,
            arduino: Array.from(clients.values()).filter(c => c.type === 'arduino').length,
            web: Array.from(clients.values()).filter(c => c.type === 'web').length
        }
    });
};

exports.getEvents = (req, res) => {
    const limit = parseInt(req.query.limit) || 20;
    res.json({
        success: true,
        events: parkingData.recentEvents.slice(0, limit)
    });
};

exports.sendCommand = (req, res) => {
    const { command, payload } = req.body;

    const arduinoClient = Array.from(clients.values())
        .find(client => client.type === 'arduino' && client.ws.readyState === 1);

    if (!arduinoClient) {
        return res.status(503).json({ success: false, error: 'No Arduino client connected' });
    }

    try {
        arduinoClient.ws.send(JSON.stringify({ command, ...payload }));
        res.json({ success: true, message: `Command '${command}' sent to Arduino` });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
};
