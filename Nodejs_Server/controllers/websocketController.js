let { parkingData } = require('../models/parkingModel'); // Use let instead of const
const { logEvent } = require('../utils/logger');
const { ParkingModel } = require('../models/parkingModel');

// Handle incoming WebSocket messages
exports.handleMessage = async (ws, data) => {
    console.log('Received message:', data);

    // Ensure parkingData is properly initialized
    //initializeParkingData();

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

    // Handle different message types
    switch (data.type) {
        case 'status_update':
            // Update parking data with the new status
            parkingData.availableSpaces = data.available_spaces || parkingData.availableSpaces;
            parkingData.totalSpaces = data.total_spaces || parkingData.totalSpaces;
            parkingData.totalEntries = data.total_entries || parkingData.totalEntries;
            parkingData.totalExits = data.total_exits || parkingData.totalExits;
            parkingData.barrierOpen = data.barrier_open !== undefined ? data.barrier_open : parkingData.barrierOpen;
            parkingData.wifiConnected = data.wifi_connected !== undefined ? data.wifi_connected : parkingData.wifiConnected;
            parkingData.uptime = data.uptime || parkingData.uptime;
            parkingData.occupancyRate = calculateOccupancyRate();
            parkingData.lastUpdate = new Date();

            // Update spaces if provided
            if (data.slots && Array.isArray(data.slots)) {
                parkingData.slots = data.slots.map(slot => ({
                    slotId: slot.slot,
                    occupied: slot.occupied !== undefined ? slot.occupied : false,
                    status: slot.occupied ? 'occupied' : 'available',
                }));
            }

            await saveParkingData();

            // // Log event
            // logEvent({
            //     type: 'status_update',
            //     availableSpaces: parkingData.availableSpaces,
            //     timestamp: new Date()
            // });

            // Broadcast updated parking data to web clients
            if (broadcastToWebClients) {
                broadcastToWebClients({
                    type: 'parking_data_update',
                    data: parkingData
                });
            }
            break;

        case 'vehicle_entry':
            parkingData.totalEntries = data.total_entries || parkingData.totalEntries;
            parkingData.availableSpaces = data.available_spaces !== undefined ? data.available_spaces : parkingData.availableSpaces;
            parkingData.occupancyRate = calculateOccupancyRate();
            parkingData.lastUpdate = new Date();

            // Log event
            // logEvent({
            //     type: 'vehicle_entry',
            //     entryAllowed: data.entry_allowed,
            //     timestamp: new Date()
            // });

            // Add to recent events
            parkingData.recentEvents.unshift({
                type: 'vehicle_entry',
                timestamp: new Date(),
                data: { entryAllowed: data.entry_allowed, availableSpaces: parkingData.availableSpaces }
            });

            // Keep only last 50 events
            if (parkingData.recentEvents.length > 50) {
                parkingData.recentEvents = parkingData.recentEvents.slice(0, 50);
            }

            // Broadcast to web clients
            if (broadcastToWebClients) {
                broadcastToWebClients({ type: 'vehicle_entry', data });
            }
            break;

        case 'vehicle_exit':
            parkingData.totalExits = data.total_exits || parkingData.totalExits;
            parkingData.availableSpaces = data.available_spaces !== undefined ? data.available_spaces : parkingData.availableSpaces;
            parkingData.occupancyRate = calculateOccupancyRate();
            parkingData.lastUpdate = new Date();

            // Log event
            // logEvent({
            //     type: 'vehicle_exit',
            //     timestamp: new Date()
            // });

            // Add to recent events
            parkingData.recentEvents.unshift({
                type: 'vehicle_exit',
                timestamp: new Date(),
                data: { availableSpaces: parkingData.availableSpaces }
            });

            // Keep only last 50 events
            if (parkingData.recentEvents.length > 50) {
                parkingData.recentEvents = parkingData.recentEvents.slice(0, 50);
            }

            // Broadcast to web clients
            if (broadcastToWebClients) {
                broadcastToWebClients({ type: 'vehicle_exit', data });
            }
            break;

        case 'space_update':
            const spaceIndex = (data.slot || 1) - 1;
            if (spaceIndex >= 0 && spaceIndex < parkingData.spaces.length) {
                // Update the space's status
                parkingData.spaces[spaceIndex] = {
                    slotId: data.slot,
                    occupied: data.occupied !== undefined ? data.occupied : false,
                    status: data.occupied ? 'occupied' : 'available'
                };

                parkingData.lastUpdate = new Date();

                // Log space update
                logEvent({
                    type: 'space_update',
                    slotId: data.slot,
                    timestamp: new Date()
                });

                // Broadcast space update to web clients
                if (broadcastToWebClients) {
                    broadcastToWebClients({
                        type: 'space_update',
                        slotId: data.slot,
                        occupied: data.occupied,
                        status: data.occupied ? 'occupied' : 'available'
                    });
                }
            } else {
                console.error(`Invalid space index: ${spaceIndex} for space_id: ${data.slotId}`);
            }
            break;

        case 'barrier_status':
            parkingData.barrierOpen = data.status === 'OPEN';
            parkingData.lastUpdate = new Date();

            // Log event
            // logEvent({
            //     type: 'barrier_status',
            //     status: data.status,
            //     timestamp: new Date()
            // });

            // Broadcast to web clients
            if (broadcastToWebClients) {
                broadcastToWebClients({
                    type: 'barrier_status',
                    status: data.status
                });
            }
            break;

        case 'command':
            // Forward the command to the Arduino client
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

async function saveParkingData() {
    try {
        ParkingModel.findOneAndUpdate({}, parkingData, { upsert: true, new: true });
        console.log("✅ Parking data saved to DB");
    } catch (err) {
        console.error("❌ Error saving parking data:", err);
    }
}

// Export parkingData getter function
exports.getParkingData = () => {
    //initializeParkingData();
    return parkingData;
};