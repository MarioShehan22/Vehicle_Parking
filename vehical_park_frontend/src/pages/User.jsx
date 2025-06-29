import React, { useState, useEffect, useRef } from 'react';
import * as THREE from 'three';

const User =  ()=>{
    const mountRef = useRef(null);
    const sceneRef = useRef(null);
    const cameraRef = useRef(null);
    const rendererRef = useRef(null);
    const animationIdRef = useRef(null);
    const parkingSpacesRef = useRef([]);
    const vehiclesRef = useRef([]);

    const [isLoading, setIsLoading] = useState(true);
    const [currentView, setCurrentView] = useState('overview');
    const [availableSpaces, setAvailableSpaces] = useState(15);
    const [occupiedSpaces, setOccupiedSpaces] = useState(25);
    const [revenue, setRevenue] = useState('$1,250');
    const [avgDuration, setAvgDuration] = useState('2.5h');
    const [rfidLogs, setRfidLogs] = useState([]);
    const [parkingSpaces, setParkingSpaces] = useState([]);

    // Initialize Three.js scene
    const initThreeJS = () => {
        if (!mountRef.current) return;

        // Scene setup
        const scene = new THREE.Scene();
        scene.background = new THREE.Color(0x0a0a1a);
        sceneRef.current = scene;

        // Camera setup
        const camera = new THREE.PerspectiveCamera(
            75,
            window.innerWidth / window.innerHeight,
            0.1,
            1000
        );
        camera.position.set(0, 15, 20);
        camera.lookAt(0, 0, 0);
        cameraRef.current = camera;

        // Renderer setup
        const renderer = new THREE.WebGLRenderer({ antialias: true });
        renderer.setSize(window.innerWidth, window.innerHeight);
        renderer.shadowMap.enabled = true;
        renderer.shadowMap.type = THREE.PCFSoftShadowMap;
        rendererRef.current = renderer;

        // Clear previous renderer if exists
        if (mountRef.current.firstChild) {
            mountRef.current.removeChild(mountRef.current.firstChild);
        }
        mountRef.current.appendChild(renderer.domElement);

        // Lighting
        const ambientLight = new THREE.AmbientLight(0x404040, 0.6);
        scene.add(ambientLight);

        const directionalLight = new THREE.DirectionalLight(0xffffff, 0.8);
        directionalLight.position.set(10, 20, 10);
        directionalLight.castShadow = true;
        directionalLight.shadow.mapSize.width = 2048;
        directionalLight.shadow.mapSize.height = 2048;
        scene.add(directionalLight);

        // Create parking lot
        createParkingLot(scene);

        // Create vehicles
        createVehicles(scene);

        // Start animation
        animate();

        // Hide loading after delay
        setTimeout(() => {
            setIsLoading(false);
        }, 2000);
    };

    const createParkingLot = (scene) => {
        // Ground
        const groundGeometry = new THREE.PlaneGeometry(25, 18);
        const groundMaterial = new THREE.MeshLambertMaterial({ color: 0x1a1a1a });
        const ground = new THREE.Mesh(groundGeometry, groundMaterial);
        ground.rotation.x = -Math.PI / 2;
        ground.receiveShadow = true;
        scene.add(ground);

        // Yellow road line
        const roadGeometry = new THREE.PlaneGeometry(1, 16);
        const roadMaterial = new THREE.MeshBasicMaterial({ color: 0xffff00 });
        const road = new THREE.Mesh(roadGeometry, roadMaterial);
        road.rotation.x = -Math.PI / 2;
        road.position.set(0, 0.02, 0);
        scene.add(road);

        // Create parking spaces
        const spaces = [];
        const slotWidth = 6;
        const slotSpacing = 3.2;

        for (let row = 0; row < 5; row++) {
            // Left column
            const leftSpace = createParkingSlot(
                scene,
                row + 1,
                -slotWidth / 2 - 1,
                row * slotSpacing - 6.4
            );
            spaces.push(leftSpace);

            // Right column
            const rightSpace = createParkingSlot(
                scene,
                row + 6,
                slotWidth / 2 + 1,
                row * slotSpacing - 6.4
            );
            spaces.push(rightSpace);
        }

        parkingSpacesRef.current = spaces;
        setParkingSpaces(spaces);

        // Entry/Exit gates
        createGate(scene, -8, -10, 'ENTRY');
        createGate(scene, 8, -10, 'EXIT');
    };

    const createParkingSlot = (scene, slotNumber, x, z) => {
        const spaceGroup = new THREE.Group();

        // Parking space base
        const spaceGeometry = new THREE.PlaneGeometry(6, 2.8);
        const isOccupied = Math.random() > 0.5;
        const spaceMaterial = new THREE.MeshBasicMaterial({
            color: 0xc0c0c0,
            transparent: true,
            opacity: 0.8,
        });
        const space = new THREE.Mesh(spaceGeometry, spaceMaterial);
        space.rotation.x = -Math.PI / 2;
        space.position.set(x, 0.01, z);

        // White parking lines
        const lineMaterial = new THREE.MeshBasicMaterial({ color: 0xffffff });

        // Top line
        const topLineGeometry = new THREE.PlaneGeometry(6, 0.1);
        const topLine = new THREE.Mesh(topLineGeometry, lineMaterial);
        topLine.rotation.x = -Math.PI / 2;
        topLine.position.set(x, 0.02, z - 1.4);

        // Bottom line
        const bottomLine = new THREE.Mesh(topLineGeometry, lineMaterial);
        bottomLine.rotation.x = -Math.PI / 2;
        bottomLine.position.set(x, 0.02, z + 1.4);

        // Side lines
        const sideLineGeometry = new THREE.PlaneGeometry(0.1, 2.8);
        const leftLine = new THREE.Mesh(sideLineGeometry, lineMaterial);
        leftLine.rotation.x = -Math.PI / 2;
        leftLine.position.set(x - 3, 0.02, z);

        const rightLine = new THREE.Mesh(sideLineGeometry, lineMaterial);
        rightLine.rotation.x = -Math.PI / 2;
        rightLine.position.set(x + 3, 0.02, z);

        // Slot number
        const textGeometry = new THREE.PlaneGeometry(1, 0.5);
        const textMaterial = new THREE.MeshBasicMaterial({
            color: 0x000000,
            transparent: true,
            opacity: 0.8,
        });
        const textPlane = new THREE.Mesh(textGeometry, textMaterial);
        textPlane.rotation.x = -Math.PI / 2;
        textPlane.position.set(x, 0.03, z);

        spaceGroup.add(space, topLine, bottomLine, leftLine, rightLine, textPlane);
        scene.add(spaceGroup);

        return {
            mesh: space,
            group: spaceGroup,
            occupied: isOccupied,
            id: slotNumber,
            position: { x, z },
        };
    };

    const createGate = (scene, x, z, label) => {
        // RFID reader
        const readerGeometry = new THREE.BoxGeometry(0.5, 0.3, 0.5);
        const readerMaterial = new THREE.MeshBasicMaterial({
            color: 0x00ff00,
            emissive: 0x004400,
        });
        const reader = new THREE.Mesh(readerGeometry, readerMaterial);
        reader.position.set(x - 3, 1, z);
        scene.add(reader);

        return { x, y: 1.5, z };
    };

    const createVehicles = (scene) => {
        const colors = [0xff0000, 0x0000ff, 0x00ff00, 0xffff00, 0xff00ff, 0x00ffff, 0xffa500, 0x800080];
        const vehicles = [];

        parkingSpacesRef.current.forEach((space) => {
            if (space.occupied) {
                const vehicleGroup = new THREE.Group();
                vehicleGroup.position.set(space.position.x, 0, space.position.z);
                scene.add(vehicleGroup);
                vehicles.push(vehicleGroup);
            }
        });

        vehiclesRef.current = vehicles;
    };

    const animate = () => {
        if (!rendererRef.current || !sceneRef.current || !cameraRef.current) return;

        animationIdRef.current = requestAnimationFrame(animate);

        // Rotate camera
        if (!isLoading) {
            const time = Date.now() * 0.0005;
            cameraRef.current.position.x = Math.cos(time) * 25;
            cameraRef.current.position.z = Math.sin(time) * 25;
            cameraRef.current.lookAt(0, 0, 0);
        }

        rendererRef.current.render(sceneRef.current, cameraRef.current);
    };

    const addRFIDLog = (type, vehicleId, time) => {
        const newLog = { type, vehicleId, time, id: Date.now() };
        setRfidLogs((prev) => [newLog, ...prev.slice(0, 9)]);
    };

    const simulateRealTimeUpdates = () => {
        const interval = setInterval(() => {
            // Simulate RFID events
            if (Math.random() > 0.7) {
                const type = Math.random() > 0.5 ? 'entry' : 'exit';
                const vehicleId = `RF${Math.floor(Math.random() * 9999).toString().padStart(4, '0')}`;
                const time = new Date().toLocaleTimeString();
                addRFIDLog(type, vehicleId, time);
            }

            // Update statistics
            if (parkingSpacesRef.current.length > 0) {
                const available = parkingSpacesRef.current.filter(space => !space.occupied).length;
                const occupied = parkingSpacesRef.current.filter(space => space.occupied).length;
                setAvailableSpaces(available);
                setOccupiedSpaces(occupied);
            }
        }, 3000);

        return interval;
    };

    const handleWindowResize = () => {
        if (!cameraRef.current || !rendererRef.current) return;

        cameraRef.current.aspect = window.innerWidth / window.innerHeight;
        cameraRef.current.updateProjectionMatrix();
        rendererRef.current.setSize(window.innerWidth, window.innerHeight);
    };

    const resetSystem = () => {
        alert('System reset initiated...');
    };

    const toggleView = () => {
        const newView = currentView === 'overview' ? 'detailed' : 'overview';
        setCurrentView(newView);

        if (cameraRef.current) {
            cameraRef.current.position.set(
                newView === 'overview' ? 0 : 10,
                newView === 'overview' ? 15 : 8,
                newView === 'overview' ? 20 : 10
            );
        }
    };

    // Effects
    useEffect(() => {
        initThreeJS();
        const updateInterval = simulateRealTimeUpdates();

        window.addEventListener('resize', handleWindowResize);

        return () => {
            window.removeEventListener('resize', handleWindowResize);
            clearInterval(updateInterval);

            if (animationIdRef.current) {
                cancelAnimationFrame(animationIdRef.current);
            }

            if (rendererRef.current && mountRef.current) {
                mountRef.current.removeChild(rendererRef.current.domElement);
                rendererRef.current.dispose();
            }
        };
    }, []);

    return (
        <div className="relative w-screen h-screen overflow-hidden bg-gradient-to-br from-indigo-500 to-purple-600 text-white">
            {/* Three.js container */}
            <div ref={mountRef} className="absolute inset-0" />

            {/* Loading screen */}
            {isLoading && (
                <div className="absolute inset-0 flex items-center justify-center z-50">
                    <div className="w-12 h-12 border-4 border-white/30 border-t-white rounded-full animate-spin" />
                </div>
            )}

            {/* UI Overlay */}
            <div className="absolute inset-0 pointer-events-none z-10">
                {/* Top Panel */}
                <div className="absolute top-5 left-5 right-5 h-20 bg-black/80 backdrop-blur-md rounded-2xl p-5 border border-white/20 pointer-events-auto flex justify-between items-center">
                    <h1 className="text-2xl font-light">🚗 Smart Parking System</h1>
                    <div className="flex items-center gap-3">
                        <div className="w-3 h-3 bg-green-500 rounded-full animate-pulse" />
                        <span>System Online</span>
                    </div>
                </div>

                {/* Left Panel */}
                <div className="absolute top-32 left-5 w-80 h-[calc(100vh-8.5rem)] bg-black/80 backdrop-blur-md rounded-2xl p-5 border border-white/20 pointer-events-auto overflow-y-auto">
                    <h3 className="text-lg mb-5">📊 Real-time Statistics</h3>

                    <div className="space-y-4">
                        <div className="p-4 bg-white/10 rounded-xl border-l-4 border-green-500">
                            <div className="text-xs opacity-80 mb-1">Available Spaces</div>
                            <div className="text-2xl font-bold">{availableSpaces}</div>
                        </div>

                        <div className="p-4 bg-white/10 rounded-xl border-l-4 border-green-500">
                            <div className="text-xs opacity-80 mb-1">Occupied Spaces</div>
                            <div className="text-2xl font-bold">{occupiedSpaces}</div>
                        </div>

                        {/*<div className="p-4 bg-white/10 rounded-xl border-l-4 border-green-500">*/}
                        {/*    <div className="text-xs opacity-80 mb-1">Total Revenue Today</div>*/}
                        {/*    <div className="text-2xl font-bold">{revenue}</div>*/}
                        {/*</div>*/}

                        {/*<div className="p-4 bg-white/10 rounded-xl border-l-4 border-green-500">*/}
                        {/*    <div className="text-xs opacity-80 mb-1">Average Duration</div>*/}
                        {/*    <div className="text-2xl font-bold">{avgDuration}</div>*/}
                        {/*</div>*/}
                    </div>

                    <h4 className="text-base mt-6 mb-4">🔄 Recent RFID Activity</h4>
                    <div className="max-h-48 overflow-y-auto space-y-2">
                        {rfidLogs.map((log) => (
                            <div
                                key={log.id}
                                className={`p-2 bg-white/10 rounded text-xs border-l-2 ${
                                    log.type === 'entry' ? 'border-green-500' : 'border-red-500'
                                }`}
                            >
                                <strong>{log.type.toUpperCase()}</strong><br />
                                Vehicle: {log.vehicleId}<br />
                                Time: {log.time}
                            </div>
                        ))}
                    </div>
                </div>

                {/* Right Panel */}
                <div className="absolute top-32 right-5 w-64 h-80 bg-black/80 backdrop-blur-md rounded-2xl p-5 border border-white/20 pointer-events-auto">
                    <h3 className="text-lg mb-5">🅿️ Parking Spaces</h3>
                    <div className="grid grid-cols-2 gap-4">
                        {parkingSpaces.map((space) => (
                            <div
                                key={space.id}
                                className={`p-3 text-center rounded-lg text-sm font-bold border transition-all duration-300 ${
                                    space.occupied
                                        ? 'bg-red-500/30 border-red-500'
                                        : 'bg-green-500/30 border-green-500'
                                }`}
                            >
                                Slot {space.id}
                            </div>
                        ))}
                    </div>
                </div>

                {/* Bottom Panel */}
                <div className="absolute bottom-5 left-96 right-80 h-24 bg-black/80 backdrop-blur-md rounded-2xl border border-white/20 pointer-events-auto flex justify-center items-center gap-4">
                    <button
                        onClick={resetSystem}
                        className="bg-gradient-to-r from-indigo-500 to-purple-600 hover:from-indigo-600 hover:to-purple-700 px-6 py-3 rounded-full font-bold transition-all duration-300 hover:-translate-y-1 hover:shadow-lg"
                    >
                        🔄 Reset System
                    </button>
                    <button
                        onClick={toggleView}
                        className="bg-gradient-to-r from-indigo-500 to-purple-600 hover:from-indigo-600 hover:to-purple-700 px-6 py-3 rounded-full font-bold transition-all duration-300 hover:-translate-y-1 hover:shadow-lg"
                    >
                        👁️ Toggle View
                    </button>
                </div>
            </div>
        </div>
    );
}
export default User;