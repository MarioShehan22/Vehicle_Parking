const { parkingData } = require('../models/parkingModel');
const User =  require("../models/userModel");
const ParkingSession = require("../models/ParkingSession");
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

exports.getParkingSession = async (req, res, next) => {
    try {
        const limit = parseInt(req.query.limit, 20) || 20;
        const sessions = await ParkingSession.find({})
            .sort({ createdAt: -1 })
            .limit(limit)
            .lean();

        res.json({ success: true, events: sessions });
    } catch (err) {
        next(err);
    }
};

exports.getUsers = async (req, res, next) => {
    try {
        const limit = parseInt(req.query.limit, 20) || 20;
        const sessions = await User.find({})
            .sort({ createdAt: -1 })
            .limit(limit)
            .lean();

        res.json({ success: true, events: sessions });
    } catch (err) {
        next(err);
    }
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
