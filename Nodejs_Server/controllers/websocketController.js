let { parkingData } = require('../models/parkingModel'); // shared object from model
const { logEvent } = require('../utils/logger');
const { ParkingModel } = require('../models/parkingModel');

// Ensure parkingData is initialized with defaults
function ensureParkingData() {
    if (!parkingData) {
        parkingData = {
            availableSpaces: 0,
            totalSpaces: 0,
            totalEntries: 0,
            totalExits: 0,
            barrierOpen: false,
            wifiConnected: false,
            uptime: 0,
            occupancyRate: 0,
            lastUpdate: null,
            slots: [],
            spaces: [],
            recentEvents: []
        };
    }
}

// Save to DB safely
async function saveParkingData() {
    try {
        await ParkingModel.findOneAndUpdate({}, parkingData, { upsert: true, new: true });
        console.log("✅ Parking data saved to DB");
    } catch (err) {
        console.error("❌ Error saving parking data:", err);
    }
}

// Handle incoming WebSocket messages
exports.handleMessage = async (ws, data) => {
    console.log('Received message:', data);
    ensureParkingData();

    // Get broadcast function safely
    let broadcastToWebClients;
    try {
        const websocketService = require('../services/websocketService');
        broadcastToWebClients = websocketService.broadcastToWebClients;
    } catch (error) {
        console.error('Error loading websocket service:', error);
        return;
    }

    // Calculate occupancy rate
    const calculateOccupancyRate = () => {
        if (parkingData.totalSpaces === 0) return 0;
        const occupiedSpaces = parkingData.totalSpaces - parkingData.availableSpaces;
        return Math.round((occupiedSpaces / parkingData.totalSpaces) * 100);
    };

    switch (data.type) {
        case 'status_update':
            parkingData.availableSpaces = data.available_spaces ?? parkingData.availableSpaces;
            parkingData.totalSpaces = data.total_spaces ?? parkingData.totalSpaces;
            parkingData.totalEntries = data.total_entries ?? parkingData.totalEntries;
            parkingData.totalExits = data.total_exits ?? parkingData.totalExits;
            parkingData.barrierOpen = data.barrier_open ?? parkingData.barrierOpen;
            parkingData.wifiConnected = data.wifi_connected ?? parkingData.wifiConnected;
            parkingData.uptime = data.uptime ?? parkingData.uptime;
            parkingData.occupancyRate = calculateOccupancyRate();
            parkingData.lastUpdate = new Date();

            if (data.slots && Array.isArray(data.slots)) {
                parkingData.slots = data.slots.map(slot => ({
                    slotId: slot.slot,
                    occupied: slot.occupied ?? false,
                    status: slot.occupied ? 'occupied' : 'available',
                }));
            }

            await saveParkingData();

            if (broadcastToWebClients) {
                broadcastToWebClients({ type: 'parking_data_update', data: parkingData });
            }
            break;

        case 'vehicle_entry':
            parkingData.totalEntries = data.total_entries ?? parkingData.totalEntries;
            parkingData.availableSpaces = data.available_spaces ?? parkingData.availableSpaces;
            parkingData.occupancyRate = calculateOccupancyRate();
            parkingData.lastUpdate = new Date();

            parkingData.recentEvents.unshift({
                type: 'vehicle_entry',
                timestamp: new Date(),
                data: { entryAllowed: data.entry_allowed, availableSpaces: parkingData.availableSpaces }
            });

            if (parkingData.recentEvents.length > 50) {
                parkingData.recentEvents = parkingData.recentEvents.slice(0, 50);
            }

            if (broadcastToWebClients) {
                broadcastToWebClients({ type: 'vehicle_entry', data });
            }
            break;

        case 'vehicle_exit':
            parkingData.totalExits = data.total_exits ?? parkingData.totalExits;
            parkingData.availableSpaces = data.available_spaces ?? parkingData.availableSpaces;
            parkingData.occupancyRate = calculateOccupancyRate();
            parkingData.lastUpdate = new Date();

            parkingData.recentEvents.unshift({
                type: 'vehicle_exit',
                timestamp: new Date(),
                data: { availableSpaces: parkingData.availableSpaces }
            });

            if (parkingData.recentEvents.length > 50) {
                parkingData.recentEvents = parkingData.recentEvents.slice(0, 50);
            }

            if (broadcastToWebClients) {
                broadcastToWebClients({ type: 'vehicle_exit', data });
            }
            break;

        case 'parking_status_update':
            {
                const index = (data.slot || 1) - 1;

                // expand spaces array if slot number exceeds current length
                while (index >= parkingData.spaces.length) {
                    parkingData.spaces.push({
                        slotId: parkingData.spaces.length + 1,
                        occupied: false,
                        status: 'available'
                    });
                }

                parkingData.spaces[index] = {
                    slotId: data.slot,
                    occupied: data.occupied ?? false,
                    status: data.occupied ? 'occupied' : 'available'
                };

                parkingData.lastUpdate = new Date();

                // Recalculate availableSpaces & occupancy
                parkingData.availableSpaces = parkingData.spaces.filter(s => !s.occupied).length;
                parkingData.occupancyRate = parkingData.totalSpaces
                    ? Math.round(((parkingData.totalSpaces - parkingData.availableSpaces) / parkingData.totalSpaces) * 100)
                    : 0;

                await saveParkingData();

                if (broadcastToWebClients) {
                    broadcastToWebClients({
                        type: 'parking_data_update',
                        data: parkingData
                    });
                }
            }
            break;

        case 'barrier_status':
            parkingData.barrierOpen = data.status === 'OPEN';
            parkingData.lastUpdate = new Date();

            if (broadcastToWebClients) {
                broadcastToWebClients({ type: 'barrier_status', status: data.status });
            }
            break;

        case 'command':
            const { command, payload } = data;
            try {
                const websocketService = require('../services/websocketService');
                const arduino = Array.from(websocketService.clients.values())
                    .find(c => c.type === 'arduino' && c.ws.readyState === 1);

                if (arduino) {
                    arduino.ws.send(JSON.stringify({ command, ...payload }));
                    console.log(`Command '${command}' sent to Arduino`);
                } else {
                    console.error("No Arduino client connected to send the command.");
                }
            } catch (error) {
                console.error("Error forwarding command to Arduino:", error);
            }
            break;

        default:
            console.error("Unknown message type:", data.type);
            break;
    }
};

// Export parkingData getter
exports.getParkingData = () => {
    ensureParkingData();
    return parkingData;
};