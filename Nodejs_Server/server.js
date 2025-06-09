const WebSocket = require('ws');
const express = require('express');
const http = require('http');
const path = require('path');

// Configuration
const PORT = 3000;
const WS_PORT = 3000;

// Create Express app
const app = express();
const server = http.createServer(app);

// Middleware
app.use(express.json());
app.use(express.static('public'));

// In-memory storage for parking system data
let parkingData = {
    totalSpaces: 5,
    availableSpaces: 5,
    occupancyRate: 0,
    totalEntries: 0,
    totalExits: 0,
    barrierOpen: false,
    wifiConnected: false,
    uptime: 0,
    lastUpdate: new Date(),
    spaces: Array.from({ length: 5 }, (_, i) => ({
        id: i + 1,
        occupied: false,
        status: 'FREE'
    })),
    recentEvents: []
};

// Store connected clients
const clients = new Map();

// Create WebSocket server
const wss = new WebSocket.Server({ server });

// Utility functions
function broadcastToWebClients(data) {
    wss.clients.forEach(client => {
        if (client.readyState === WebSocket.OPEN && client.clientType === 'web') {
            client.send(JSON.stringify(data));
        }
    });
}

function logEvent(event) {
    const timestamp = new Date().toISOString();
    const logEntry = { ...event, timestamp };

    parkingData.recentEvents.unshift(logEntry);
    if (parkingData.recentEvents.length > 50) {
        parkingData.recentEvents = parkingData.recentEvents.slice(0, 50);
    }

    console.log(`[${timestamp}] ${event.type}:`, event);

    // Broadcast to web clients
    broadcastToWebClients({
        type: 'event_log',
        event: logEntry
    });
}

// WebSocket connection handler
wss.on('connection', (ws, req) => {
    const clientId = Date.now() + Math.random();
    const clientIP = req.socket.remoteAddress;

    console.log(`New WebSocket connection from ${clientIP}`);

    // Determine client type based on user agent or custom header
    const userAgent = req.headers['user-agent'] || '';
    const isArduino = userAgent.includes('ESP8266') ||
        userAgent.includes('Arduino') ||
        req.headers['x-client-type'] === 'arduino';

    ws.clientType = isArduino ? 'arduino' : 'web';
    ws.clientId = clientId;
    ws.connectedAt = new Date();

    clients.set(clientId, {
        ws,
        type: ws.clientType,
        ip: clientIP,
        connectedAt: ws.connectedAt
    });

    console.log(`Client identified as: ${ws.clientType}`);

    // Send welcome message
    if (ws.clientType === 'arduino') {
        logEvent({
            type: 'arduino_connected',
            clientId,
            ip: clientIP
        });

        // Send initial status request to Arduino
        ws.send(JSON.stringify({ command: 'get_status' }));
    } else {
        // Send current data to web client
        ws.send(JSON.stringify({
            type: 'initial_data',
            data: parkingData
        }));
    }

    // Handle incoming messages
    ws.on('message', (message) => {
        try {
            const data = JSON.parse(message.toString());
            console.log(`Received from ${ws.clientType}:`, data);

            handleMessage(ws, data);
        } catch (error) {
            console.error('Error parsing message:', error);
            ws.send(JSON.stringify({
                error: 'Invalid JSON format',
                timestamp: new Date().toISOString()
            }));
        }
    });

    // Handle connection close
    ws.on('close', () => {
        console.log(`${ws.clientType} client disconnected`);
        clients.delete(clientId);

        if (ws.clientType === 'arduino') {
            logEvent({
                type: 'arduino_disconnected',
                clientId,
                ip: clientIP
            });

            // Update parking data to reflect disconnection
            parkingData.wifiConnected = false;
            broadcastToWebClients({
                type: 'arduino_status',
                connected: false
            });
        }
    });

    // Handle errors
    ws.on('error', (error) => {
        console.error(`WebSocket error for ${ws.clientType}:`, error);
    });
});

// Message handler
function handleMessage(ws, data) {
    const timestamp = new Date().toISOString();

    switch (data.type) {
        case 'status_update':
            handleStatusUpdate(data);
            break;

        case 'vehicle_entry':
            handleVehicleEntry(data);
            break;

        case 'vehicle_exit':
            handleVehicleExit(data);
            break;

        case 'space_update':
            handleSpaceUpdate(data);
            break;

        case 'barrier_status':
            handleBarrierStatus(data);
            break;

        // Web client commands
        case 'command':
            handleWebCommand(ws, data);
            break;

        default:
            console.log('Unknown message type:', data.type);
    }
}

function handleStatusUpdate(data) {
    // Update parking data
    Object.assign(parkingData, {
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

    logEvent({
        type: 'status_update',
        availableSpaces: data.available_spaces,
        occupancyRate: data.occupancy_rate
    });

    // Broadcast to web clients
    broadcastToWebClients({
        type: 'parking_data_update',
        data: parkingData
    });
}

function handleVehicleEntry(data) {
    logEvent({
        type: 'vehicle_entry',
        entryAllowed: data.entry_allowed,
        availableSpaces: data.available_spaces,
        totalEntries: data.total_entries
    });

    parkingData.totalEntries = data.total_entries;
    parkingData.availableSpaces = data.available_spaces;

    broadcastToWebClients({
        type: 'vehicle_entry',
        data: {
            entryAllowed: data.entry_allowed,
            availableSpaces: data.available_spaces,
            totalEntries: data.total_entries
        }
    });
}

function handleVehicleExit(data) {
    logEvent({
        type: 'vehicle_exit',
        availableSpaces: data.available_spaces,
        totalExits: data.total_exits
    });

    parkingData.totalExits = data.total_exits;
    parkingData.availableSpaces = data.available_spaces;

    broadcastToWebClients({
        type: 'vehicle_exit',
        data: {
            availableSpaces: data.available_spaces,
            totalExits: data.total_exits
        }
    });
}

function handleSpaceUpdate(data) {
    // Update specific space
    const spaceIndex = data.space_id - 1;
    if (spaceIndex >= 0 && spaceIndex < parkingData.spaces.length) {
        parkingData.spaces[spaceIndex] = {
            id: data.space_id,
            occupied: data.occupied,
            status: data.status
        };

        logEvent({
            type: 'space_update',
            spaceId: data.space_id,
            status: data.status
        });

        broadcastToWebClients({
            type: 'space_update',
            spaceId: data.space_id,
            occupied: data.occupied,
            status: data.status
        });
    }
}

function handleBarrierStatus(data) {
    parkingData.barrierOpen = data.status === 'OPEN';

    logEvent({
        type: 'barrier_status',
        status: data.status
    });

    broadcastToWebClients({
        type: 'barrier_status',
        status: data.status,
        open: parkingData.barrierOpen
    });
}

function handleWebCommand(ws, data) {
    const { command, payload } = data;

    // Find Arduino client
    const arduinoClient = Array.from(clients.values())
        .find(client => client.type === 'arduino' && client.ws.readyState === WebSocket.OPEN);

    if (!arduinoClient) {
        ws.send(JSON.stringify({
            type: 'error',
            message: 'No Arduino client connected'
        }));
        return;
    }

    logEvent({
        type: 'web_command',
        command,
        payload
    });

    // Forward command to Arduino
    switch (command) {
        case 'open_barrier':
            arduinoClient.ws.send(JSON.stringify({ command: 'open_barrier' }));
            break;

        case 'close_barrier':
            arduinoClient.ws.send(JSON.stringify({ command: 'close_barrier' }));
            break;

        case 'get_status':
            arduinoClient.ws.send(JSON.stringify({ command: 'get_status' }));
            break;

        case 'reset_counters':
            arduinoClient.ws.send(JSON.stringify({ command: 'reset_counters' }));
            break;

        default:
            ws.send(JSON.stringify({
                type: 'error',
                message: `Unknown command: ${command}`
            }));
    }
}

// REST API endpoints
app.get('/api/status', (req, res) => {
    res.json({
        success: true,
        data: parkingData,
        connectedClients: {
            total: clients.size,
            arduino: Array.from(clients.values()).filter(c => c.type === 'arduino').length,
            web: Array.from(clients.values()).filter(c => c.type === 'web').length
        }
    });
});

app.get('/api/events', (req, res) => {
    const limit = parseInt(req.query.limit) || 20;
    res.json({
        success: true,
        events: parkingData.recentEvents.slice(0, limit)
    });
});

app.post('/api/command', (req, res) => {
    const { command, payload } = req.body;

    // Find Arduino client
    const arduinoClient = Array.from(clients.values())
        .find(client => client.type === 'arduino' && client.ws.readyState === WebSocket.OPEN);

    if (!arduinoClient) {
        return res.status(503).json({
            success: false,
            error: 'No Arduino client connected'
        });
    }

    try {
        arduinoClient.ws.send(JSON.stringify({ command, ...payload }));

        logEvent({
            type: 'api_command',
            command,
            payload
        });

        res.json({
            success: true,
            message: `Command '${command}' sent to Arduino`
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// Serve a simple test web interface
app.get('/', (req, res) => {
    res.send(`
    <!DOCTYPE html>
    <html>
    <head>
        <title>Parking System Test Interface</title>
        <style>
            body { font-family: Arial, sans-serif; margin: 20px; background: #f5f5f5; }
            .container { max-width: 1200px; margin: 0 auto; }
            .card { background: white; padding: 20px; margin: 10px 0; border-radius: 8px; box-shadow: 0 2px 4px rgba(0,0,0,0.1); }
            .status { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 15px; }
            .metric { text-align: center; padding: 15px; background: #f8f9fa; border-radius: 6px; }
            .metric h3 { margin: 0 0 10px 0; color: #666; font-size: 14px; }
            .metric .value { font-size: 24px; font-weight: bold; color: #333; }
            .spaces { display: grid; grid-template-columns: repeat(5, 1fr); gap: 10px; margin: 20px 0; }
            .space { padding: 20px; text-align: center; border-radius: 6px; font-weight: bold; }
            .space.free { background: #d4edda; color: #155724; }
            .space.occupied { background: #f8d7da; color: #721c24; }
            .controls button { margin: 5px; padding: 10px 20px; border: none; border-radius: 4px; cursor: pointer; }
            .btn-primary { background: #007bff; color: white; }
            .btn-success { background: #28a745; color: white; }
            .btn-danger { background: #dc3545; color: white; }
            .btn-secondary { background: #6c757d; color: white; }
            .events { max-height: 300px; overflow-y: auto; background: #f8f9fa; padding: 15px; border-radius: 6px; }
            .event { margin: 5px 0; padding: 8px; background: white; border-radius: 4px; font-size: 12px; }
            .connection-status { padding: 10px; text-align: center; border-radius: 4px; margin-bottom: 20px; }
            .connected { background: #d4edda; color: #155724; }
            .disconnected { background: #f8d7da; color: #721c24; }
        </style>
    </head>
    <body>
        <div class="container">
            <h1>🚗 Parking System Admin Interface</h1>
            
            <div id="connectionStatus" class="connection-status disconnected">
                Arduino: Disconnected
            </div>
            
            <div class="card">
                <h2>System Status</h2>
                <div class="status">
                    <div class="metric">
                        <h3>Available Spaces</h3>
                        <div class="value" id="availableSpaces">-</div>
                    </div>
                    <div class="metric">
                        <h3>Occupancy Rate</h3>
                        <div class="value" id="occupancyRate">-</div>
                    </div>
                    <div class="metric">
                        <h3>Total Entries</h3>
                        <div class="value" id="totalEntries">-</div>
                    </div>
                    <div class="metric">
                        <h3>Total Exits</h3>
                        <div class="value" id="totalExits">-</div>
                    </div>
                    <div class="metric">
                        <h3>Barrier Status</h3>
                        <div class="value" id="barrierStatus">-</div>
                    </div>
                </div>
            </div>
            
            <div class="card">
                <h2>Parking Spaces</h2>
                <div class="spaces" id="parkingSpaces">
                    <!-- Spaces will be populated by JavaScript -->
                </div>
            </div>
            
            <div class="card">
                <h2>Controls</h2>
                <div class="controls">
                    <button class="btn-success" onclick="sendCommand('open_barrier')">Open Barrier</button>
                    <button class="btn-danger" onclick="sendCommand('close_barrier')">Close Barrier</button>
                    <button class="btn-primary" onclick="sendCommand('get_status')">Get Status</button>
                    <button class="btn-secondary" onclick="sendCommand('reset_counters')">Reset Counters</button>
                </div>
            </div>
            
            <div class="card">
                <h2>Recent Events</h2>
                <div class="events" id="eventLog"></div>
            </div>
        </div>

        <script>
            let ws;
            let isConnected = false;
            
            function connect() {
                ws = new WebSocket('ws://localhost:3000');
                
                ws.onopen = function() {
                    console.log('Connected to server');
                    isConnected = true;
                    updateConnectionStatus();
                };
                
                ws.onmessage = function(event) {
                    const data = JSON.parse(event.data);
                    handleMessage(data);
                };
                
                ws.onclose = function() {
                    console.log('Disconnected from server');
                    isConnected = false;
                    updateConnectionStatus();
                    setTimeout(connect, 3000); // Reconnect after 3 seconds
                };
                
                ws.onerror = function(error) {
                    console.error('WebSocket error:', error);
                };
            }
            
            function handleMessage(data) {
                switch(data.type) {
                    case 'initial_data':
                    case 'parking_data_update':
                        updateParkingData(data.data);
                        break;
                    case 'event_log':
                        addEventToLog(data.event);
                        break;
                    case 'arduino_status':
                        updateConnectionStatus(data.connected);
                        break;
                }
            }
            
            function updateParkingData(data) {
                document.getElementById('availableSpaces').textContent = data.availableSpaces + '/' + data.totalSpaces;
                document.getElementById('occupancyRate').textContent = Math.round(data.occupancyRate) + '%';
                document.getElementById('totalEntries').textContent = data.totalEntries;
                document.getElementById('totalExits').textContent = data.totalExits;
                document.getElementById('barrierStatus').textContent = data.barrierOpen ? 'OPEN' : 'CLOSED';
                
                updateParkingSpaces(data.spaces);
            }
            
            function updateParkingSpaces(spaces) {
                const container = document.getElementById('parkingSpaces');
                container.innerHTML = '';
                
                spaces.forEach(space => {
                    const div = document.createElement('div');
                    div.className = 'space ' + (space.occupied ? 'occupied' : 'free');
                    div.innerHTML = \`Space \${space.id}<br><small>\${space.status}</small>\`;
                    container.appendChild(div);
                });
            }
            
            function updateConnectionStatus(arduinoConnected = false) {
                const status = document.getElementById('connectionStatus');
                if (arduinoConnected) {
                    status.className = 'connection-status connected';
                    status.textContent = 'Arduino: Connected';
                } else {
                    status.className = 'connection-status disconnected';
                    status.textContent = 'Arduino: Disconnected';
                }
            }
            
            function addEventToLog(event) {
                const log = document.getElementById('eventLog');
                const div = document.createElement('div');
                div.className = 'event';
                div.innerHTML = \`<strong>\${event.timestamp}</strong> - \${event.type}: \${JSON.stringify(event, null, 2)}\`;
                log.insertBefore(div, log.firstChild);
                
                // Keep only last 20 events
                while (log.children.length > 20) {
                    log.removeChild(log.lastChild);
                }
            }
            
            function sendCommand(command) {
                if (!isConnected) {
                    alert('Not connected to server');
                    return;
                }
                
                ws.send(JSON.stringify({
                    type: 'command',
                    command: command
                }));
            }
            
            // Start connection
            connect();
        </script>
    </body>
    </html>
  `);
});

// Error handling
process.on('uncaughtException', (error) => {
    console.error('Uncaught Exception:', error);
});

process.on('unhandledRejection', (reason, promise) => {
    console.error('Unhandled Rejection at:', promise, 'reason:', reason);
});

// Start server
server.listen(PORT, () => {
    console.log('🚗 Parking System Backend Server Started');
    console.log(`📊 Web Interface: http://localhost:${PORT}`);
    console.log(`🔌 WebSocket Server: ws://localhost:${WS_PORT}`);
    console.log(`📡 API Endpoints: http://localhost:${PORT}/api/`);
    console.log('');
    console.log('Waiting for Arduino connection...');
    console.log('Make sure your Arduino code points to: ws://YOUR_IP:3000');
});

// Graceful shutdown
process.on('SIGINT', () => {
    console.log('\n🛑 Shutting down server...');

    // Close all WebSocket connections
    wss.clients.forEach(client => {
        if (client.readyState === WebSocket.OPEN) {
            client.close();
        }
    });

    server.close(() => {
        console.log('✅ Server closed successfully');
        process.exit(0);
    });
});
