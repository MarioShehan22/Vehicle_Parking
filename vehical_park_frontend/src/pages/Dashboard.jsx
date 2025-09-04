import React, { useEffect, useState } from "react";
import useWebSocket, { ReadyState } from "react-use-websocket";

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

    // Update connection status text
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

    // Handle incoming messages
    useEffect(() => {
        if (lastMessage) {
            try {
                const data = JSON.parse(lastMessage.data);
                console.log("📩 Received message:", data);

                switch (data.type) {
                    case "initial_data": // <-- handle initial payload from backend
                        setParkingData(data.data);
                        if (data.data.events) {
                            setEvents(data.data.events);
                        }
                        break;

                    case "status_update":
                    case "parking_data_update":
                        setParkingData(data.data);
                        break;

                    case "new_event":
                        setEvents((prev) => [
                            { timestamp: Date.now(), ...data.data },
                            ...prev,
                        ]);
                        break;

                    default:
                        console.warn("⚠️ Unknown message type:", data.type);
                }
            } catch (err) {
                console.error("❌ Failed to parse WS message:", lastMessage.data, err);
            }
        }
    }, [lastMessage]);

    return (
        <div className="p-6">
            <h1 className="text-2xl font-bold mb-4">🚗 Smart Parking Dashboard</h1>
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
                {events.map((event, idx) => (
                    <li key={idx} className="border-b py-1 text-sm">
                        [{new Date(event.timestamp).toLocaleTimeString()}]{" "}
                        {event.action} (Slot {event.slot})
                    </li>
                ))}
            </ul>
        </div>
    );
}
