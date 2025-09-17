import React, { useState, useEffect, useRef } from 'react';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
const CAR_URL = new URL('../assets/Car.glb', import.meta.url).href;
import useWebSocket from 'react-use-websocket';
import * as THREE from 'three';

const User = () => {
    const mountRef = useRef(null);
    const sceneRef = useRef();
    const cameraRef = useRef();
    const rendererRef = useRef();
    const animationIdRef = useRef();
    const controlsRef = useRef();

    const parkingSpacesRef = useRef([]);
    const carModelRef = useRef(null);
    const [parkingSpaces, setParkingSpaces] = useState([]);
    //const [parkingSpaces, setParkingSpaces] = useState([]);
    const [availableSpaces, setAvailableSpaces] = useState(0);
    const [occupiedSpaces, setOccupiedSpaces] = useState(0);
    const [rfidLogs, setRfidLogs] = useState([]);
    const [isLoading, setIsLoading] = useState(true);
    const [currentView, setCurrentView] = useState('overview');
    const pendingOccupancyRef = useRef([]);

    const { lastMessage } = useWebSocket("ws://localhost:3000", {
        onOpen: () => console.log("✅ WebSocket connected!"),
        onClose: () => console.log("❌ WebSocket disconnected!"),
        onError: (err) => console.error("⚠️ WebSocket error:", err),
        shouldReconnect: () => true,
    });

    // const dummyRfidLogs = [
    //     { id: 1, type: 'entry', vehicleId: 'ABC123', time: '2023-10-01 10:00' },
    //     { id: 2, type: 'exit', vehicleId: 'XYZ789', time: '2023-10-01 10:05' },
    //     { id: 3, type: 'entry', vehicleId: 'DEF456', time: '2023-10-01 10:10' },
    // ];

    const recomputeStatsFromSlots = () => {
        const total = parkingSpacesRef.current.length;
        const available = parkingSpacesRef.current.filter((s) => !s.occupied).length;
        setAvailableSpaces(available);
        setOccupiedSpaces(total - available);
    };
    const normalizeDatasetToUpdates = (data) => {
        const arr = Array.isArray(data?.spaces) ? data.spaces
            : Array.isArray(data?.slots)  ? data.slots
                : [];
        return arr.map((s) => ({
            id: Number(s.id ?? s.slot ?? s.slotId),
            occupied: !!s.occupied,
        })).filter((u) => !!u.id);
    };

    // ★ Make handleParkingData compute stats from payload, not stale state
    const handleParkingData = (data) => {
        // Stats from payload if present, otherwise compute from spaces array
        const total = Number(data?.totalSpaces ?? data?.spaces?.length ?? data?.slots?.length ?? 0);
        const available = Number(
            data?.availableSpaces ??
            (Array.isArray(data?.spaces) ? data.spaces.filter((s) => !s.occupied).length :
                Array.isArray(data?.slots)  ? data.slots.filter((s) => !s.occupied).length : 0)
        );

        if (!Number.isNaN(available)) setAvailableSpaces(available);
        if (!Number.isNaN(total)) setOccupiedSpaces(Math.max(0, total - available));

        const updates = normalizeDatasetToUpdates(data);
        if (updates.length) updateThreeJSSpaces(updates);

        // Recent events (optional)
        if (Array.isArray(data?.recentEvents)) {
            setRfidLogs(data.recentEvents);
        }
    };


    // Handle WebSocket messages
    useEffect(() => {
        if (!lastMessage) return;
        try {
            const msg = JSON.parse(lastMessage.data);

            switch (msg.type) {
                case 'initial_data':
                case 'parking_data_update':
                case 'status_update': {
                    if (msg.data) handleParkingData(msg.data);
                    break;
                }

                case 'parking_status_update': {
                    // Accept any of: id | slot | slotId
                    const id = Number(msg.id ?? msg.slot ?? msg.slotId);
                    if (!id) break;

                    // Ensure slot exists
                    const index = id - 1;
                    while (index >= parkingSpacesRef.current.length) {
                        const nextId = parkingSpacesRef.current.length + 1;
                        const newSlot = createSlot(sceneRef.current, nextId, 0, 0);
                        parkingSpacesRef.current.push(newSlot);
                    }

                    updateThreeJSSpaces([{ id, occupied: !!msg.occupied }]);
                    break;
                }

                case 'new_event': {
                    setRfidLogs((prev) => [{ id: Date.now(), ...msg.data }, ...prev]);
                    break;
                }

                default:
                    console.warn('⚠️ Unknown message type:', msg.type);
            }
        } catch (err) {
            console.error('❌ Failed to parse WS message:', lastMessage.data, err);
        }
    }, [lastMessage]);

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

        const controls = new OrbitControls(camera, renderer.domElement);
        controls.enableDamping = true;
        controlsRef.current = controls;

        // Build a 10-slot lot (5 rows x 2 sides). This is fine even if totalSpaces=1;
        // slot 1 will still be used and visible. Change if you want dynamic sizing.
        createParkingLot(scene);

        // Load and normalize Car.glb
        const loader = new GLTFLoader();
        loader.load(
            CAR_URL,
            (gltf) => {
                const root = gltf.scene;
                root.traverse((obj) => {
                    if (obj.isMesh) {
                        obj.castShadow = true;
                        obj.receiveShadow = true;
                        obj.visible = true;
                    }
                });

                // Compute bbox before scaling
                root.updateMatrixWorld(true);
                const box = new THREE.Box3().setFromObject(root);
                const size = new THREE.Vector3();
                const center = new THREE.Vector3();
                box.getSize(size);
                box.getCenter(center);

                // Fit into slot (6 x 2.8) → use safe 5.4 x 2.4
                const targetLength = 5.4; // along Z
                const targetWidth  = 2.4; // along X
                const sx = targetWidth  / (size.x || 1);
                const sz = targetLength / (size.z || 1);
                const s = Math.min(sx, sz);
                root.scale.setScalar(s);

                // Recalc bbox after scale
                root.updateMatrixWorld(true);
                const box2 = new THREE.Box3().setFromObject(root);
                const center2 = new THREE.Vector3();
                box2.getCenter(center2);

                // Lift to ground (y=0) and center at (0,0,0) in the slot group
                const liftY = -box2.min.y;
                root.position.set(-center2.x, liftY, -center2.z);

                carModelRef.current = root;
                console.log('Car model loaded & normalized');

                // TEMP sanity check (remove later if not needed):
                // If your server hasn't sent anything yet, this will show a car in slot 1.
                // if (!pendingOccupancyRef.current.length) updateThreeJSSpaces([{ id: 1, occupied: true }]);

                // Replay queued updates now that cloning is possible
                if (pendingOccupancyRef.current.length) {
                    updateThreeJSSpaces(pendingOccupancyRef.current);
                    pendingOccupancyRef.current = [];
                }
            },
            undefined,
            (err) => console.error('GLB load error:', err)
        );

        animate();
        setTimeout(() => setIsLoading(false), 600);
    };

    const createParkingLot = (scene) => {
        const ground = new THREE.Mesh(
            new THREE.PlaneGeometry(25, 18),
            new THREE.MeshLambertMaterial({ color: 0x1a1a1a })
        );
        ground.rotation.x = -Math.PI / 2;
        ground.receiveShadow = true;
        scene.add(ground);

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
        // Optional mirror to React state if you display per-slot info
        // setParkingSpaces(slots);
        recomputeStatsFromSlots();
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

    // ★ Make updateThreeJSSpaces robust and model-aware
    const updateThreeJSSpaces = (updates) => {
        // If model isn't ready yet, queue *and return* (don’t half-apply)
        if (!carModelRef.current) {
            pendingOccupancyRef.current.push(...updates);
            return;
        }

        updates.forEach((u) => {
            const targetId = Number(u.id ?? u.slot ?? u.slotId);
            if (!targetId) return;

            // Ensure the target slot exists (defensive)
            while (targetId - 1 >= parkingSpacesRef.current.length) {
                const nextId = parkingSpacesRef.current.length + 1;
                const newSlot = createSlot(sceneRef.current, nextId, 0, 0);
                parkingSpacesRef.current.push(newSlot);
            }

            const slot = parkingSpacesRef.current.find((s) => s.id === targetId);
            if (!slot) return;

            const willBeOccupied = !!u.occupied;
            slot.occupied = willBeOccupied;

            // Floor color/visibility
            if (slot.mesh) {
                slot.mesh.material.color.set(willBeOccupied ? 0xff5555 : 0x55ff55);
                slot.mesh.visible = !willBeOccupied;
            }

            // Add/remove car
            if (willBeOccupied) {
                if (!slot.carInstance) {
                    const car = carModelRef.current.clone(true);
                    // Face outward depending on column (left column faces right)
                    const facingRight = slot.group.position.x < 0;
                    car.rotation.y = facingRight ? Math.PI / 2 : -Math.PI / 2;
                    car.position.set(0, 0, 0);
                    slot.group.add(car);
                    slot.carInstance = car;
                }
            } else if (slot.carInstance) {
                slot.group.remove(slot.carInstance);
                slot.carInstance = null;
            }
        });

        // keep counters in sync with authoritative slots
        //recomputeStatsFromSlots();
    };


    const animate = () => {
        animationIdRef.current = requestAnimationFrame(animate);
        if (controlsRef.current) {
            controlsRef.current.enableRotate = currentView === 'detailed';
            controlsRef.current.update();
        } else if (cameraRef.current && currentView === 'overview') {
            const time = Date.now() * 0.0005;
            cameraRef.current.position.x = Math.cos(time) * 25;
            cameraRef.current.position.z = Math.sin(time) * 25;
            cameraRef.current.lookAt(0, 0, 0);
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

    // const resetSystem = () => {
    //     //handleParkingData(parkingSpaces);
    //     setRfidLogs(dummyRfidLogs);
    // };

    const toggleView = () => {
        const view = currentView === 'overview' ? 'detailed' : 'overview';
        setCurrentView(view);
        cameraRef.current.position.set(
            view === 'overview' ? 0 : 10,
            view === 'overview' ? 15 : 8,
            view === 'overview' ? 20 : 10
        );
        cameraRef.current.lookAt(0, 0, 0);
        controlsRef.current?.reset();
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

    // Load dummy data initially
    useEffect(() => {
        //handleParkingData(parkingSpaces);
        //setRfidLogs(dummyRfidLogs);
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
            </div>
            <div className="absolute bottom-5 left-96 right-80 h-24 flex justify-center items-center gap-4">
                {/*<button onClick={resetSystem} className="px-6 py-3 bg-indigo-600 hover:bg-indigo-700 rounded-xl font-medium transition">🔄 Reset System</button>*/}
                <button onClick={toggleView} className="px-6 py-3 bg-purple-600 hover:bg-purple-700 rounded-xl font-medium transition">👁️ Toggle View</button>
            </div>
        </div>
    );
};

export default User;