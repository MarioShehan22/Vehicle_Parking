import React, { useState, useEffect, useRef } from 'react';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import Car from '../assets/Car.glb';
import useWebSocket from 'react-use-websocket';
import * as THREE from 'three';

const WS_URL = 'ws://localhost:3000';
const User = () => {
    const mountRef = useRef(null);
    const sceneRef = useRef();
    const cameraRef = useRef();
    const rendererRef = useRef();
    const animationIdRef = useRef();
    const controlsRef = useRef();

    const parkingSpacesRef = useRef([]);
    const [parkingSpaces, setParkingSpaces] = useState([]);
    const [availableSpaces, setAvailableSpaces] = useState(0);
    const [occupiedSpaces, setOccupiedSpaces] = useState(0);
    const [rfidLogs, setRfidLogs] = useState([]);
    const [isLoading, setIsLoading] = useState(true);
    const [currentView, setCurrentView] = useState('overview');

    const carModelRef = useRef(null); // Store loaded car model for cloning

    // Dummy data
    const dummyParkingData = {
        availableSpaces: 6,
        totalSpaces: 10,
        spaces: [
            { id: 1, occupied: false },
            { id: 2, occupied: true },
            { id: 3, occupied: false },
            { id: 4, occupied: true },
            { id: 5, occupied: false },
            { id: 6, occupied: false },
            { id: 7, occupied: true },
            { id: 8, occupied: false },
            { id: 9, occupied: true },
            { id: 10, occupied: false },
        ],
    };

    const dummyRfidLogs = [
        { id: 1, type: 'entry', vehicleId: 'ABC123', time: '2023-10-01 10:00' },
        { id: 2, type: 'exit', vehicleId: 'XYZ789', time: '2023-10-01 10:05' },
        { id: 3, type: 'entry', vehicleId: 'DEF456', time: '2023-10-01 10:10' },
    ];

    // Functions to update parking data with dummy values
    const handleParkingData = (data) => {
        setAvailableSpaces(data.availableSpaces);
        setOccupiedSpaces(data.totalSpaces - data.availableSpaces);

        const updatedSpaces = data.spaces.map((s) => ({
            ...s,
            color: s.occupied ? 0xff5555 : 0x55ff55,
        }));

        updateThreeJSSpaces(updatedSpaces);
        setParkingSpaces(updatedSpaces);
    };

    // Load initial dummy data
    useEffect(() => {
        handleParkingData(dummyParkingData);
        setRfidLogs(dummyRfidLogs);
    }, []);

    // -- Three.js Initialization --
    const initThreeJS = () => {
        const mount = mountRef.current;
        if (!mount) return;

        const scene = new THREE.Scene();
        scene.background = new THREE.Color(0x0a0a1a);
        sceneRef.current = scene;

        const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
        camera.position.set(0, 15, 20);
        camera.lookAt(0, 0, 0);
        cameraRef.current = camera;

        const renderer = new THREE.WebGLRenderer({ antialias: true });
        renderer.setSize(window.innerWidth, window.innerHeight);
        renderer.shadowMap.enabled = true;
        mount.innerHTML = '';
        mount.appendChild(renderer.domElement);
        rendererRef.current = renderer;

        const ambient = new THREE.AmbientLight(0x404040, 0.6);
        const directional = new THREE.DirectionalLight(0xffffff, 0.8);
        directional.position.set(10, 20, 10);
        directional.castShadow = true;
        scene.add(ambient, directional);

        // Add OrbitControls
        const controls = new OrbitControls(camera, renderer.domElement);
        controls.enableDamping = true;
        controlsRef.current = controls;

        createParkingLot(scene);

        // Load car model
        const loader = new GLTFLoader();
        loader.load(
            Car,
            (gltf) => {
                carModelRef.current = gltf.scene;
                carModelRef.current.scale.set(1, 1, 1);
                console.log('Car model loaded successfully');
                // Apply dummy data after model loads
                handleParkingData(dummyParkingData);
            },
            undefined,
            (error) => {
                console.error('GLB load error:', error);
            }
        );

        animate();

        setTimeout(() => setIsLoading(false), 2000);
    };

    const createParkingLot = (scene) => {
        const ground = new THREE.Mesh(
            new THREE.PlaneGeometry(25, 18),
            new THREE.MeshLambertMaterial({ color: 0x1a1a1a })
        );
        ground.rotation.x = -Math.PI / 2;
        ground.receiveShadow = true;
        scene.add(ground);

        // Create slots
        const slots = [];
        for (let row = 0; row < 5; row++) {
            ['left', 'right'].forEach((side, idx) => {
                const id = row * 2 + idx + 1;
                const x = side === 'left' ? -3.5 : 3.5;
                const z = row * 3.2 - 6.4;
                const slot = createSlot(scene, id, x, z);
                slots.push(slot);
            });
        }

        parkingSpacesRef.current = slots;
        setParkingSpaces(slots);
    };

    const createSlot = (scene, id, x, z) => {
        const group = new THREE.Group();
        group.position.set(x, 0, z);

        const mat = new THREE.MeshBasicMaterial({ color: 0x55ff55, transparent: true, opacity: 0.8 });
        const mesh = new THREE.Mesh(new THREE.PlaneGeometry(6, 2.8), mat);
        mesh.rotation.x = -Math.PI / 2;
        mesh.position.set(0, 0.01, 0);
        group.add(mesh);

        scene.add(group);
        return { id, group, mesh, occupied: false, carInstance: null };
    };

    const updateThreeJSSpaces = (newSpaces) => {
        parkingSpacesRef.current.forEach((slot) => {
            const newSlot = newSpaces.find((s) => s.id === slot.id);
            if (newSlot) {
                slot.occupied = newSlot.occupied;
                slot.mesh.material.color.set(newSlot.occupied ? 0xff5555 : 0x55ff55);
                slot.mesh.visible = !newSlot.occupied; // Hide plane if occupied

                // Add/remove car model
                if (newSlot.occupied && carModelRef.current) {
                    if (!slot.carInstance) {
                        slot.carInstance = carModelRef.current.clone();
                        slot.carInstance.position.set(0, 0, 0);
                        slot.carInstance.rotation.y = Math.PI / 2;
                        slot.group.add(slot.carInstance);
                    }
                } else if (slot.carInstance) {
                    slot.group.remove(slot.carInstance);
                    slot.carInstance = null;
                }
            }
        });
    };

    const animate = () => {
        animationIdRef.current = requestAnimationFrame(animate);
        if (controlsRef.current) {
            controlsRef.current.enableRotate = currentView === 'detailed';
            controlsRef.current.update();
        } else {
            // Fallback auto-rotation for overview
            const time = Date.now() * 0.0005;
            if (cameraRef.current && currentView === 'overview') {
                cameraRef.current.position.x = Math.cos(time) * 25;
                cameraRef.current.position.z = Math.sin(time) * 25;
                cameraRef.current.lookAt(0, 0, 0);
            }
        }
        rendererRef.current.render(sceneRef.current, cameraRef.current);
    };

    const handleResize = () => {
        if (cameraRef.current && rendererRef.current) {
            cameraRef.current.aspect = window.innerWidth / window.innerHeight;
            cameraRef.current.updateProjectionMatrix();
            rendererRef.current.setSize(window.innerWidth, window.innerHeight);
        }
    };

    const resetSystem = () => {
        handleParkingData(dummyParkingData);
        setRfidLogs(dummyRfidLogs);
    };

    const toggleView = () => {
        const view = currentView === 'overview' ? 'detailed' : 'overview';
        setCurrentView(view);
        cameraRef.current.position.set(
            view === 'overview' ? 0 : 10,
            view === 'overview' ? 15 : 8,
            view === 'overview' ? 20 : 10
        );
        cameraRef.current.lookAt(0, 0, 0);
        if (controlsRef.current) {
            controlsRef.current.reset();
        }
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
                    {rfidLogs.map((log) => (
                        <div key={log.id} className={`p-2 bg-white/10 rounded text-xs border-l-2 ${log.type === 'entry' ? 'border-green-500' : 'border-red-500'}`}>
                            <strong>{log.type.toUpperCase()}</strong><br />ID: {log.vehicleId}<br />Time: {log.time}
                        </div>
                    ))}
                </div>
            </div>
            <div className="absolute bottom-5 left-96 right-80 h-24 flex justify-center items-center gap-4">
                <button onClick={resetSystem} className="px-6 py-3 bg-indigo-600 hover:bg-indigo-700 rounded-xl font-medium transition">🔄 Reset System</button>
                <button onClick={toggleView} className="px-6 py-3 bg-purple-600 hover:bg-purple-700 rounded-xl font-medium transition">👁️ Toggle View</button>
            </div>
        </div>
    );
};

export default User;
