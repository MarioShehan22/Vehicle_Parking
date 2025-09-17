let { parkingData } = require('../models/parkingModel');
const { ParkingModel } = require('../models/parkingModel');
const User = require('../models/userModel');
const ParkingSession = require("../models/ParkingSession");
const {broadcastToWebClients} = require("../services/websocketService");
const path = require('path');
const { sendInvoiceEmail } = require('../utils/mailer');

// ------- in-memory auth cache (short-lived hint linking RFID->intended mode) -----
const armedAuthByCard = new Map();
const AUTH_WINDOW_MS = 60 * 1000;

// ------- utils ----------
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
            recentEvents: [],
        };
    }
}

function calcOccupancyRate() {
    if (!parkingData.totalSpaces) return 0;
    const occupied = parkingData.totalSpaces - parkingData.availableSpaces;
    return Math.round((occupied / parkingData.totalSpaces) * 100);
}

async function saveParkingData() {
    try {
        await ParkingModel.findOneAndUpdate({}, parkingData, { upsert: true, new: true });
        console.log('✅ Parking data saved to DB');
    } catch (err) {
        console.error('❌ Error saving parking data:', err);
    }
}

function broadcast(payload) {
    try {
        const { broadcastToWebClients } = require('../services/websocketService');
        if (broadcastToWebClients) broadcastToWebClients(payload);
    } catch (e) {
        console.error('Error loading websocket service:', e);
    }
}

function sendToArduino(payload) {
    try {
        const websocketService = require('../services/websocketService');
        const arduino = Array.from(websocketService.clients.values())
            .find(c => c.type === 'arduino' && c.ws.readyState === 1);
        if (arduino) {
            arduino.ws.send(JSON.stringify(payload));
            return true;
        }
    } catch (e) {
        console.error('sendToArduino error:', e);
    }
    return false;
}

function normSlotId(x) {
    const n = Number(x?.id ?? x?.slot ?? x?.slotId);
    return Number.isFinite(n) && n > 0 ? n : null;
}

function ensureSpaceExists(id) {
    while (parkingData.spaces.length < id) {
        const nextId = parkingData.spaces.length + 1;
        parkingData.spaces.push({ slotId: nextId, occupied: false, status: 'available' });
    }
}

function recomputeFromSpaces() {
    parkingData.availableSpaces = parkingData.spaces.filter(s => !s.occupied).length;
    if (!parkingData.totalSpaces) parkingData.totalSpaces = parkingData.spaces.length;
    parkingData.occupancyRate = calcOccupancyRate();
    parkingData.slots = parkingData.spaces.map(s => ({
        slot: s.slotId, occupied: s.occupied, status: s.occupied ? 'occupied' : 'available',
    }));
}

function pushEvent(evt) {
    parkingData.recentEvents.unshift(evt);
    if (parkingData.recentEvents.length > 100) parkingData.recentEvents.length = 100;
}

// ------- core: handle messages from ESP / browser ------
exports.handleMessage = async (_ws, data) => {
    ensureParkingData();
    const now = new Date();
    const type = data?.type;
    console.log(data);
    try {
        switch (type) {
            // =============== device → batch snapshot =================
            case 'status_update': {
                if (typeof data.available_spaces === 'number') parkingData.availableSpaces = data.available_spaces;
                if (typeof data.total_spaces === 'number') parkingData.totalSpaces = data.total_spaces;
                if (typeof data.total_entries === 'number') parkingData.totalEntries = data.total_entries;
                if (typeof data.total_exits === 'number') parkingData.totalExits = data.total_exits;
                if (typeof data.barrier_open === 'boolean') parkingData.barrierOpen = data.barrier_open;
                if (typeof data.wifi_connected === 'boolean') parkingData.wifiConnected = data.wifi_connected;
                if (typeof data.uptime === 'number') parkingData.uptime = data.uptime;

                // slots[] or spaces[]
                const arrays = [data.slots, data.spaces].filter(Array.isArray);
                for (const arr of arrays) {
                    let maxId = 0;
                    for (const raw of arr) { const id = normSlotId(raw); if (id && id > maxId) maxId = id; }
                    if (maxId) ensureSpaceExists(maxId);
                    for (const raw of arr) {
                        const id = normSlotId(raw); if (!id) continue;
                        const occupied = !!raw.occupied;
                        const idx = id - 1;
                        parkingData.spaces[idx] = { slotId: id, occupied, status: occupied ? 'occupied' : 'available' };
                    }
                }

                recomputeFromSpaces();
                parkingData.lastUpdate = now;
                await saveParkingData();
                broadcast({ type: 'parking_data_update', data: parkingData });
                break;
            }

            case 'gate_mode': {
                console.log(data)
                const now = new Date();
                parkingData.recentEvents.unshift({
                    type: 'gate_mode',
                    timestamp: now,
                    data: { mode: data.mode, cardUid: data.card_uid || null }
                });
                if (parkingData.recentEvents.length > 100) parkingData.recentEvents.length = 100;
                parkingData.lastUpdate = now;
                await saveParkingData();
                if (broadcastToWebClients) {
                    broadcastToWebClients({ type: 'gate_mode', data });
                }
                break;
            }

            // =============== device → per-slot delta ================
            case 'parking_status_update': {
                const id = normSlotId(data);
                if (!id) break;
                ensureSpaceExists(id);

                const occupied = !!data.occupied;
                parkingData.spaces[id - 1] = { slotId: id, occupied, status: occupied ? 'occupied' : 'available' };

                recomputeFromSpaces();
                parkingData.lastUpdate = now;

                await saveParkingData();
                broadcast({ type: 'parking_data_update', data: parkingData });
                break;
            }

            // =============== device → raw RFID scan =================
            // { type: 'rfid_scan', card_uid, timestamp, available_spaces }
            case 'rfid_scan': {
                const cardId = (data.card_uid || '').toString().toUpperCase();
                if (!cardId) break;

                // 1) Authenticate
                const user = await User.findOne({ cardId, is_active: true }).lean();
                const auth = !!user;

                // Decide intended mode (entry vs exit)
                // If there is any free slot -> entry, else exit (tweak to your policy)
                const mode = parkingData.availableSpaces > 0 ? 'entry' : 'exit';

                // 2) Arm mode for this card (short-lived)
                if (auth) {
                    armedAuthByCard.set(cardId, { mode, armedAt: Date.now() });
                    // tell device to open and set gate mode
                    sendToArduino({ type: 'gate_mode', mode: mode === 'entry' ? 'entry_auth' : 'exit_auth', card_uid: cardId });
                } else {
                    // deny
                    sendToArduino({ command: 'close_barrier' });
                }

                // 3) Log & broadcast
                pushEvent({
                    type: 'rfid_scan',
                    timestamp: now,
                    data: { cardUid: cardId, auth, mode, userId: user?._id || null },
                });
                parkingData.lastUpdate = now;
                await saveParkingData();

                broadcast({ type: 'rfid_scan', data: { card_uid: cardId, auth, mode } });
                break;
            }

            // =============== device → high-level result =============
            // { type:'vehicle_event', action:'entry'|'exit', slot, card_uid? }
            case 'vehicle_event': {
                console.log(data)
                const action = data.action === 'exit' ? 'exit' : 'entry';
                const id = normSlotId(data);
                const cardId = (data.card_uid || '').toString().toUpperCase();
                const armed = cardId ? armedAuthByCard.get(cardId) : null;

                // soft-auth: if armed entry/exit within window, accept; else re-check db
                let user = null;
                if (cardId) {
                    if (armed && Date.now() - armed.armedAt <= AUTH_WINDOW_MS) {
                        user = await User.findOne({ cardId, is_active: true });
                    } else {
                        user = await User.findOne({ cardId, is_active: true });
                    }
                }

                // Create / Close session
                if (action === 'entry') {
                    if (!user) {
                        // Reject: unauthenticated (still update counters/UI if you want)
                        pushEvent({ type: 'vehicle_entry_denied', timestamp: now, data: { cardUid: cardId } });
                    } else {
                        // Close any stale open session for this card (safety)
                        await ParkingSession.updateMany(
                            { cardId, status: 'open' },
                            { $set: { status: 'closed', exitTime: now, durationSeconds: 0 } }
                        );

                        // Create a new session
                        const session = new ParkingSession({
                            user: user._id,
                            cardId,
                            vehicleNumber: user.vehicleNumber,
                            slotId: id || null,
                            entryTime: now,
                            status: 'open',
                        });
                        console.log('session', session);
                        await session.save();

                        parkingData.totalEntries += 1;
                        pushEvent({
                            type: 'vehicle_entry',
                            timestamp: now,
                            data: { slotId: id || null, cardUid: cardId, userId: user._id },
                        });
                    }
                } else {
                    // EXIT
                    let session = null;
                    if (cardId) {
                        session = await ParkingSession.findOne({ cardId, status: 'open' }).sort({ entryTime: 1 });
                    }
                    if (!session && id) {
                        // fallback: match by slot if card missing
                        session = await ParkingSession.findOne({ slotId: id, status: 'open' }).sort({ entryTime: 1 });
                    }

                    if (session) {
                        const exitTime = now;
                        const durationSeconds = Math.max(0, Math.floor((exitTime - session.entryTime) / 1000));
                        session.exitTime = exitTime;
                        session.durationSeconds = durationSeconds;
                        session.status = 'closed';
                        if (id && !session.slotId) session.slotId = id;
                        await session.save();

                        parkingData.totalExits += 1;
                        pushEvent({
                            type: 'vehicle_exit',
                            timestamp: now,
                            data: { slotId: id || null, cardUid: session.cardId, userId: session.user },
                        });

                        // ---------- SEND INVOICE EMAIL HERE ----------
                        try {
                            const ratePerHour = Number(process.env.PARKING_RATE_PER_HOUR || 200); // LKR/hr default
                            const userDoc = await User.findById(session.user).lean();

                            if (userDoc?.email) {
                                const invoiceNumber = `INV-${Date.now()}`; // simple unique id (customize as you wish)
                                await sendInvoiceEmail({
                                    toEmail: userDoc.email,
                                    toName: userDoc.name || userDoc.fullName || '',
                                    invoiceNumber,
                                    invoiceDate: exitTime,
                                    entryTime: session.entryTime,
                                    exitTime,
                                    ratePerHour,
                                    // You can pass replyTo if you want:
                                    // replyTo: 'billing@yourdomain.com',
                                });
                                console.log(`📧 Invoice sent to ${userDoc.email} (${invoiceNumber})`);
                            } else {
                                console.warn(`No email on user ${session.user}, invoice not sent.`);
                            }
                        } catch (e) {
                            console.error('Failed to send invoice email:', e);
                        }
                        // --------------------------------------------
                    } else {
                        pushEvent({
                            type: 'vehicle_exit_unmatched',
                            timestamp: now,
                            data: { slotId: id || null, cardUid: cardId || null },
                        });
                    }
                }
                // reflect space state best-effort
                if (id) {
                    ensureSpaceExists(id);
                    const occ = action === 'entry';
                    parkingData.spaces[id - 1] = { slotId: id, occupied: occ, status: occ ? 'occupied' : 'available' };
                }

                recomputeFromSpaces();
                parkingData.lastUpdate = now;
                await saveParkingData();

                broadcast({ type: 'vehicle_event', data });
                broadcast({ type: 'parking_data_update', data: parkingData });

                // clear armed hint
                if (cardId) armedAuthByCard.delete(cardId);
                break;
            }

            // =============== barrier / command passthrough ==========
            case 'barrier_status': {
                parkingData.barrierOpen = data.status === 'OPEN';
                parkingData.lastUpdate = now;
                await saveParkingData();
                broadcast({ type: 'barrier_status', status: data.status });
                break;
            }

            // {type:'command', command:'open_barrier'|..., payload:{}}
            case 'command': {
                const { command, payload } = data;
                const ok = sendToArduino({ command, ...(payload || {}) });
                if (!ok) console.error('No Arduino client connected to send the command.');
                break;
            }

            default:
                console.error('Unknown message type:', type);
                break;
        }
    } catch (err) {
        console.error('❌ handleMessage error:', err);
    }
};

// snapshot getter
exports.getParkingData = () => {
    ensureParkingData();
    return parkingData;
};