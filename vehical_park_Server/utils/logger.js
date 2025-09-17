const { parkingData } = require('../models/parkingModel');

function logEvent(event) {
    const timestamp = new Date().toISOString();
    const logEntry = { ...event, timestamp };
    parkingData.recentEvents.unshift(logEntry);
    parkingData.recentEvents = parkingData.recentEvents.slice(0, 50);
    console.log(`[${timestamp}] ${event.type}:`, event);
}

module.exports = { logEvent };
