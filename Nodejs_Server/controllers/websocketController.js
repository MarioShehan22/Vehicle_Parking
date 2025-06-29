const { parkingData } = require('../models/parkingModel');
const { broadcastToWebClients } = require('../services/websocketService');
const { logEvent } = require('../utils/logger');

exports.handleMessage = (ws, data) => {
    switch (data.type) {
        case 'status_update':
            Object.assign(parkingData, {
                ...parkingData,
                availableSpaces: data.available_spaces,
                totalSpaces: data.total_spaces,
                occupancyRate: data.occupancy_rate,
                totalEntries: data.total_entries,
                totalExits: data.total_exits,
                barrierOpen: data.barrier_open,
                wifiConnected: data.wifi_connected,
                uptime: data.uptime,
                lastUpdate: new Date(),
                spaces: data.spaces || parkingData.spaces
            });
            logEvent({ type: 'status_update', availableSpaces: data.available_spaces });
            broadcastToWebClients({ type: 'parking_data_update', data: parkingData });
            break;

        case 'vehicle_entry':
            parkingData.totalEntries = data.total_entries;
            parkingData.availableSpaces = data.available_spaces;
            logEvent({ type: 'vehicle_entry', entryAllowed: data.entry_allowed });
            broadcastToWebClients({ type: 'vehicle_entry', data });
            break;

        case 'vehicle_exit':
            parkingData.totalExits = data.total_exits;
            parkingData.availableSpaces = data.available_spaces;
            logEvent({ type: 'vehicle_exit' });
            broadcastToWebClients({ type: 'vehicle_exit', data });
            break;

        case 'space_update':
            const spaceIndex = data.space_id - 1;
            if (spaceIndex >= 0 && spaceIndex < parkingData.spaces.length) {
                parkingData.spaces[spaceIndex] = {
                    id: data.space_id,
                    occupied: data.occupied,
                    status: data.status
                };
                logEvent({ type: 'space_update', spaceId: data.space_id });
                broadcastToWebClients({ type: 'space_update', ...data });
            }
            break;

        case 'barrier_status':
            parkingData.barrierOpen = data.status === 'OPEN';
            logEvent({ type: 'barrier_status', status: data.status });
            broadcastToWebClients({ type: 'barrier_status', status: data.status });
            break;

        case 'command':
            // forward to Arduino
            const { command, payload } = data;
            const arduino = Array.from(require('../services/websocket.service').clients.values())
                .find(c => c.type === 'arduino' && c.ws.readyState === 1);
            if (arduino) arduino.ws.send(JSON.stringify({ command, ...payload }));
            break;
    }
};
