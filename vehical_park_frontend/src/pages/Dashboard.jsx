import React, { useEffect, useState } from "react";
import useWebSocket from 'react-use-websocket'; // Import WebSocket hook
import { Canvas } from "@react-three/fiber";
import { Box } from "@react-three/drei"; // For 3D visualization

const Dashboard = () => {
    const [parkingData, setParkingData] = useState({
        totalSpaces: 0,
        availableSpaces: 0,
        occupancyRate: 0,
        totalEntries: 0,
        totalExits: 0,
        barrierOpen: false,
        wifiConnected: false,
        uptime: 0,
        spaces: [],
    });
    const [events, setEvents] = useState([]);

    // WebSocket URL
    const socketUrl = "ws://localhost:3000"; // Ensure this matches your WebSocket server

    // WebSocket hook using react-use-websocket
    const { sendMessage, lastMessage, readyState } = useWebSocket(socketUrl, {
        onOpen: () => console.log("WebSocket connected!"),
        onClose: () => console.log("WebSocket disconnected!"),
        shouldReconnect: (closeEvent) => true, // Automatically reconnect
    });

    useEffect(() => {
        if (lastMessage !== null) {
            const data = JSON.parse(lastMessage.data);
            console.log("Received message:", data);

            // Handle parking data and events
            switch (data.type) {
                case "status_update":
                    setParkingData((prevData) => ({
                        ...prevData,
                        totalSpaces: data.totalSpaces,
                        availableSpaces: data.availableSpaces,
                        occupancyRate: data.occupancyRate,
                        totalEntries: data.totalEntries,
                        totalExits: data.totalExits,
                        barrierOpen: data.barrierOpen,
                        wifiConnected: data.wifiConnected,
                        uptime: data.uptime,
                        spaces: data.spaces,
                    }));
                    break;

                case "new_event":
                    setEvents((prevEvents) => [data, ...prevEvents]);
                    break;

                case "parking_data_update": // Added handler for 'parking_data_update'
                    setParkingData((prevData) => ({
                        ...prevData,
                        totalSpaces: data.data.totalSpaces,
                        availableSpaces: data.data.availableSpaces,
                        occupancyRate: data.data.occupancyRate,
                        totalEntries: data.data.totalEntries,
                        totalExits: data.data.totalExits,
                        barrierOpen: data.data.barrierOpen,
                        wifiConnected: data.data.wifiConnected,
                        uptime: data.data.uptime,
                        spaces: data.data.spaces,
                    }));
                    break;

                default:
                    console.error("Unknown message type:", data.data.type);
                    break;
            }
        }
    }, [lastMessage]);

    return (
        <div className="min-h-screen bg-gray-100">
            <div className="p-6">
                <div className="flex justify-between items-center">
                    <h1 className="text-3xl font-bold">Admin Dashboard</h1>
                </div>

                {/* Parking Stats */}
                <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mt-8">
                    <div className="bg-white p-6 rounded-lg shadow-lg">
                        <h2 className="text-xl font-semibold">Total Spaces</h2>
                        <p className="text-4xl">{parkingData.totalSpaces}</p>
                    </div>
                    <div className="bg-white p-6 rounded-lg shadow-lg">
                        <h2 className="text-xl font-semibold">Available Spaces</h2>
                        <p className="text-4xl">{parkingData.availableSpaces}</p>
                    </div>
                    <div className="bg-white p-6 rounded-lg shadow-lg">
                        <h2 className="text-xl font-semibold">Occupancy Rate</h2>
                        <p className="text-4xl">{parkingData.occupancyRate}%</p>
                    </div>
                </div>

                {/* Event List */}
                <div className="mt-8">
                    <h2 className="text-2xl font-semibold">Recent Events</h2>
                    <ul className="space-y-4">
                        {events.slice(0, 5).map((event, index) => (
                            <li key={index} className="bg-white p-4 rounded-lg shadow-md">
                                <p className="font-semibold">{event.type}</p>
                                <p>{new Date(event.timestamp).toLocaleString()}</p>
                                <pre>{JSON.stringify(event.data, null, 2)}</pre>
                            </li>
                        ))}
                    </ul>
                </div>

                {/* 3D Parking Visualization */}
                <div className="mt-8">
                    <h2 className="text-2xl font-semibold">Parking Visualization</h2>
                    <Canvas className="w-full h-96">
                        <ambientLight />
                        <pointLight position={[10, 10, 10]} />
                        {/* Add boxes to represent parking spaces */}
                        {parkingData.spaces?.map((space, index) => (
                            <Box
                                key={index}
                                position={[(index % 3) * 2, Math.floor(index / 3) * 2, 0]}
                            >
                                <meshStandardMaterial color={space.occupied ? "red" : "green"} />
                            </Box>
                        ))}
                    </Canvas>
                </div>

            </div>
        </div>
    );
};

export default Dashboard;