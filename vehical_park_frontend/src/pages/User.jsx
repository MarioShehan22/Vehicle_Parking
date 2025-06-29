import React, { useState, useEffect, useRef } from 'react';
import useWebSocket from 'react-use-websocket';
import * as THREE from 'three';

const WS_URL = 'ws://localhost:3001';

const User = () => {
    const mountRef = useRef(null);
    const sceneRef = useRef();
    const cameraRef = useRef();
    const rendererRef = useRef();
    const animationIdRef = useRef();

    const parkingSpacesRef = useRef([]);
    const [parkingSpaces, setParkingSpaces] = useState([]);
    const [availableSpaces, setAvailableSpaces] = useState(0);
    const [occupiedSpaces, setOccupiedSpaces] = useState(0);
    const [rfidLogs, setRfidLogs] = useState([]);
    const [isLoading, setIsLoading] = useState(true);
    const [currentView, setCurrentView] = useState('overview');

    // WebSocket setup
    const { sendJsonMessage, lastJsonMessage } = useWebSocket(WS_URL, {
        onOpen: () => console.log('WS connected'),
        onClose: () => console.log('WS disconnected'),
        shouldReconnect: () => true,
    });

    // Parse incoming WS messages
    useEffect(() => {
        if (!lastJsonMessage) return;

        const { type, data, event } = lastJsonMessage;

        if (type === 'initial_data' || type === 'parking_data_update') {
            if (data) handleParkingData(data);
        } else if (type === 'event_log' && event) {
            addRFIDLog(event.type, event.vehicleId || '-', event.timestamp);
        }
    }, [lastJsonMessage]);


    // Functions to update parking data
    const handleParkingData = (data) => {
        if (!data || typeof data.availableSpaces === 'undefined' || !Array.isArray(data.spaces)) {
            console.warn("Received invalid parking data:", data);
            return;
        }

        setAvailableSpaces(data.availableSpaces);
        setOccupiedSpaces(data.totalSpaces ? data.totalSpaces - data.availableSpaces : data.spaces.length - data.availableSpaces);

        // Update slot colors
        const updatedSpaces = data.spaces.map((s) => ({
            ...s,
            color: s.occupied ? 0xff5555 : 0x55ff55,
        }));

        updateThreeJSSpaces(updatedSpaces);
        setParkingSpaces(updatedSpaces);
    };


    const addRFIDLog = (type, vehicleId, timestamp) => {
        setRfidLogs(prev => [{ id: Date.now(), type, vehicleId, time: timestamp }, ...prev].slice(0,10));
    };

    // Send commands via WS
    const sendCommand = command => {
        sendJsonMessage({ type: 'command', command });
    };

    // -- Three.js Initialization --
    const initThreeJS = () => {
        const mount = mountRef.current;
        if (!mount) return;

        const scene = new THREE.Scene();
        scene.background = new THREE.Color(0x0a0a1a);
        sceneRef.current = scene;

        const camera = new THREE.PerspectiveCamera(75, window.innerWidth/window.innerHeight, 0.1, 1000);
        camera.position.set(0,15,20);
        camera.lookAt(0,0,0);
        cameraRef.current = camera;

        const renderer = new THREE.WebGLRenderer({ antialias: true });
        renderer.setSize(window.innerWidth, window.innerHeight);
        renderer.shadowMap.enabled = true;
        mount.innerHTML = '';
        mount.appendChild(renderer.domElement);
        rendererRef.current = renderer;

        const ambient = new THREE.AmbientLight(0x404040, 0.6);
        const directional = new THREE.DirectionalLight(0xffffff, 0.8);
        directional.position.set(10,20,10);
        directional.castShadow = true;
        scene.add(ambient, directional);

        createParkingLot(scene);

        animate();

        setTimeout(() => setIsLoading(false), 2000);
    };

    const createParkingLot = scene => {
        const ground = new THREE.Mesh(
            new THREE.PlaneGeometry(25,18),
            new THREE.MeshLambertMaterial({ color: 0x1a1a1a })
        );
        ground.rotation.x = -Math.PI/2;
        ground.receiveShadow = true;
        scene.add(ground);

        // Create slots
        const slots = [];
        for (let row=0; row<5; row++) {
            ['left','right'].forEach((side, idx) => {
                const id = row*2 + idx + 1;
                const x = (side==='left' ? -3.5 : 3.5);
                const z = row*3.2 - 6.4;
                const slot = createSlot(scene, id, x, z);
                slots.push(slot);
            });
        }

        parkingSpacesRef.current = slots;
        setParkingSpaces(slots);
    };

    const createSlot = (scene, id, x, z) => {
        const group = new THREE.Group();
        const mat = new THREE.MeshBasicMaterial({ color: 0x55ff55, transparent: true, opacity: 0.8 });
        const mesh = new THREE.Mesh(new THREE.PlaneGeometry(6,2.8), mat);
        mesh.rotation.x = -Math.PI/2;
        mesh.position.set(x,0.01,z);
        group.add(mesh);

        scene.add(group);
        return { id, mesh, occupied: false };
    };

    const updateThreeJSSpaces = newSpaces => {
        parkingSpacesRef.current.forEach(slot => {
            const newSlot = newSpaces.find(s => s.id === slot.id);
            if (newSlot) {
                slot.occupied = newSlot.occupied;
                slot.mesh.material.color.set(newSlot.occupied ? 0xff5555 : 0x55ff55);
            }
        });
    };

    const animate = () => {
        animationIdRef.current = requestAnimationFrame(animate);
        const time = Date.now() * 0.0005;
        if (cameraRef.current) {
            cameraRef.current.position.x = Math.cos(time)*25;
            cameraRef.current.position.z = Math.sin(time)*25;
            cameraRef.current.lookAt(0,0,0);
        }
        rendererRef.current.render(sceneRef.current, cameraRef.current);
    };

    const handleResize = () => {
        if (cameraRef.current && rendererRef.current) {
            cameraRef.current.aspect = window.innerWidth/window.innerHeight;
            cameraRef.current.updateProjectionMatrix();
            rendererRef.current.setSize(window.innerWidth, window.innerHeight);
        }
    };

    const resetSystem = () => sendCommand('reset_counters');
    const toggleView = () => {
        const view = currentView === 'overview' ? 'detailed' : 'overview';
        setCurrentView(view);
        cameraRef.current.position.set(
            view === 'overview' ? 0 : 10,
            view === 'overview' ? 15 : 8,
            view === 'overview' ? 20 : 10
        );
    };

    useEffect(() => {
        initThreeJS();
        window.addEventListener('resize', handleResize);
        return () => {
            window.removeEventListener('resize', handleResize);
            cancelAnimationFrame(animationIdRef.current);
            rendererRef.current?.dispose();
            mountRef.current?.removeChild(rendererRef.current?.domElement);
        };
    }, []);

    return (
        <div className="relative w-screen h-screen overflow-hidden bg-gradient-to-br from-indigo-500 to-purple-600 text-white">
            <div ref={mountRef} className="absolute inset-0" />
            {isLoading && <div className="absolute inset-0 flex items-center justify-center z-50"><div className="w-12 h-12 border-4 border-white/30 border-t-white rounded-full animate-spin" /></div>}

            {/* UI Panels */}
            <div className="absolute top-5 left-5 flex justify-between w-[calc(100%-40px)] p-5 bg-black/80 rounded-2xl border border-white/20 pointer-events-auto">
                <h1 className="text-2xl font-light">🚗 Smart Parking System</h1>
                <div className="flex items-center gap-3"><div className="w-3 h-3 bg-green-500 rounded-full animate-pulse" />System Online</div>
            </div>
            <div className="absolute top-32 left-5 w-80 p-5 bg-black/80 rounded-2xl border border-white/20 pointer-events-auto overflow-y-auto">
                <h3 className="text-lg mb-5">📊 Stats & Logs</h3>
                <div className="space-y-4">
                    <div className="p-4 bg-white/10 rounded-xl border-l-4 border-green-500"><div className="text-xs opacity-80">Available</div><div className="text-2xl">{availableSpaces}</div></div>
                    <div className="p-4 bg-white/10 rounded-xl border-l-4 border-red-500"><div className="text-xs opacity-80">Occupied</div><div className="text-2xl">{occupiedSpaces}</div></div>
                </div>
                <h4 className="text-base mt-6 mb-4">🔄 RFID Activity</h4>
                <div className="max-h-48 overflow-y-auto space-y-2">
                    {rfidLogs.map(log => (
                        <div key={log.id} className={`p-2 bg-white/10 rounded text-xs border-l-2 ${log.type==='entry' ? 'border-green-500' : 'border-red-500'}`}>
                            <strong>{log.type.toUpperCase()}</strong><br/>ID: {log.vehicleId}<br/>Time: {log.time}
                        </div>
                    ))}
                </div>
            </div>
            <div className="absolute bottom-5 left-96 right-80 h-24 flex justify-center items-center gap-4">
                <button onClick={resetSystem} className="...">🔄 Reset System</button>
                <button onClick={toggleView} className="...">👁️ Toggle View</button>
            </div>
        </div>
    );
};

export default User;
