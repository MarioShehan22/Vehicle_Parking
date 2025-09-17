import React, { useEffect, useState } from "react";
import useWebSocket, { ReadyState } from "react-use-websocket";
import SessionsPanel from "../components/fetchSessions.jsx";
import UsersTable from "../components/UsersTable.jsx";

function normalizeEvent(e) {
    const ts =
        typeof e?.timestamp === "number"
            ? e.timestamp
            : e?.timestamp
                ? Date.parse(e.timestamp)
                : Date.now();

    const label =
        (e?.data && (e.data.message || e.data.action || e.data.status)) ||
        (e?.type ? e.type.replace(/_/g, " ") : "event");

    const slot =
        e?.data?.slot ??
        e?.data?.slotId ??
        e?.data?.space ??
        e?.data?.spaceId ??
        e?.data?.bay ??
        undefined;

    return { timestamp: ts, label: String(label), slot };
}

export default function Dashboard() {
    const [parkingData, setParkingData] = useState(null);
    const [events, setEvents] = useState([]);
    const [connectionStatus, setConnectionStatus] = useState("Connecting...");

    const { lastMessage, readyState } = useWebSocket("ws://localhost:3000", {
        onOpen: () => console.log("✅ WebSocket connected!"),
        onClose: () => console.log("❌ WebSocket disconnected!"),
        onError: (err) => console.error("⚠️ WebSocket error:", err),
        shouldReconnect: () => true,
    });

    useEffect(() => {
        switch (readyState) {
            case ReadyState.OPEN:
                setConnectionStatus("🟢 Connected");
                break;
            case ReadyState.CONNECTING:
                setConnectionStatus("🟡 Connecting...");
                break;
            case ReadyState.CLOSING:
                setConnectionStatus("🟠 Closing...");
                break;
            case ReadyState.CLOSED:
                setConnectionStatus("🔴 Disconnected");
                break;
            default:
                setConnectionStatus("⚪ Unknown");
        }
    }, [readyState]);

    useEffect(() => {
        if (!lastMessage) return;

        try {
            const msg = JSON.parse(lastMessage.data);
            console.log("📩 Received message:", msg);

            switch (msg.type) {
                case "initial_data": {
                    setParkingData(msg.data);
                    if (Array.isArray(msg.data?.recentEvents)) {
                        setEvents(msg.data.recentEvents.map(normalizeEvent));
                    } else if (Array.isArray(msg.data?.events)) {
                        setEvents(msg.data.events.map(normalizeEvent));
                    }
                    break;
                }
                case "parking_data_update":
                case "status_update": {
                    setParkingData(msg.data);
                    if (Array.isArray(msg.data?.recentEvents)) {
                        setEvents(msg.data.recentEvents.map(normalizeEvent));
                    }
                    break;
                }
                case "new_event": {
                    const normalized = normalizeEvent(msg.data);
                    setEvents((prev) => [normalized, ...prev]);
                    break;
                }
                default:
                    console.warn("⚠️ Unknown message type:", msg.type);
            }
        } catch (err) {
            console.error("❌ Failed to parse WS message:", lastMessage.data, err);
        }
    }, [lastMessage]);

    return (
        <div className="p-6">
            <h1 className="text-2xl font-bold mb-4">🚗 Smart Parking Admin Dashboard</h1>
            <p className="mb-4">Connection: {connectionStatus}</p>

            {parkingData ? (
                <div className="grid grid-cols-2 gap-4">
                    <div className="p-4 bg-white rounded shadow">
                        <h2 className="font-semibold">Total Spaces</h2>
                        <p>{parkingData.totalSpaces}</p>
                    </div>
                    <div className="p-4 bg-white rounded shadow">
                        <h2 className="font-semibold">Available</h2>
                        <p>{parkingData.availableSpaces}</p>
                    </div>
                    <div className="p-4 bg-white rounded shadow">
                        <h2 className="font-semibold">Occupancy Rate</h2>
                        <p>{parkingData.occupancyRate}%</p>
                    </div>
                    <div className="p-4 bg-white rounded shadow">
                        <h2 className="font-semibold">Entries / Exits</h2>
                        <p>
                            {parkingData.totalEntries} / {parkingData.totalExits}
                        </p>
                    </div>
                </div>
            ) : (
                <p>⏳ Waiting for data...</p>
            )}

            <h2 className="text-xl font-bold mt-6 mb-2">Recent Events</h2>
            <ul className="bg-gray-100 p-4 rounded max-h-60 overflow-y-auto">
                {events.length === 0 && (
                    <li className="text-sm italic">No recent events.</li>
                )}
                {events.map((event, idx) => (
                    <li key={`${event.timestamp}-${idx}`} className="border-b py-1 text-sm">
                        [{new Date(event.timestamp).toLocaleTimeString()}] {event.label}
                        {event.slot !== undefined ? ` (Slot ${event.slot})` : ""}
                    </li>
                ))}
            </ul>
            <SessionsPanel/>
            <br/>
            <UsersTable/>
        </div>
    );
}
