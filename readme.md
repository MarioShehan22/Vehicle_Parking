# 🚗 Smart Parking Management System

![MIT License](https://img.shields.io/badge/License-MIT-yellow.svg)  
*A comprehensive IoT-based parking management solution built with **Arduino ESP8266**, **Node.js**, and **React**. The system provides real-time parking space monitoring, automated barrier control, and a web-based dashboard for analytics and control.*

---

## 📋 Table of Contents

- [Features](#-features)
- [System Architecture](#-system-architecture)
- [Hardware Requirements](#-hardware-requirements)
- [Software Requirements](#-software-requirements)
- [Installation](#-installation)
- [Configuration](#-configuration)
- [Usage](#-usage)
- [API Documentation](#-api-documentation)
- [Web Interface](#-web-interface)
- [Troubleshooting](#-troubleshooting)
- [Contributing](#-contributing)
- [Acknowledgments](#-acknowledgments)
- [Support](#-support)
- [Version History](#-version-history)
- [License](#-license)

---

## ✨ Features

### 🔧 Arduino/Hardware
- Real-time parking space monitoring (IR/Ultrasonic sensors)
- Automated barrier control with SG90 servo motor
- Vehicle entry/exit detection at gates
- LCD display for available spaces and system status
- Audio notifications via buzzer
- LED indicators (green/red) for entry permissions
- WiFi connectivity (ESP8266 NodeMCU)
- WebSocket communication for live updates

### 💻 Backend/Software
- Real-time web dashboard with occupancy data
- RESTful API for integration
- Event logging & analytics
- Remote barrier control via dashboard
- Multi-client WebSocket support
- Automatic reconnection handling
- Historical session tracking

---

## 🏗 System Architecture

```
┌─────────────────┐    WebSocket    ┌─────────────────┐    HTTP/WS    ┌─────────────────┐
│ Arduino ESP8266 │ ◄──────────►    │  Node.js Server │ ◄──────────►  │   Web Dashboard │
│                 │                 │                 │               │                 │
│ • Sensors       │                 │ • WebSocket Hub │               │ • Real-time Data│
│ • Servo Motor   │                 │ • REST API      │               │ • Controls      │
│ • LCD/Buzzer    │                 │ • Event Logger  │               │ • Analytics     │
│ • WiFi Module   │                 │ • MongoDB Store │               │ • Event Logs    │
└─────────────────┘                 └─────────────────┘               └─────────────────┘
```

---

## 🔧 Hardware Requirements

### Essential Components
- ESP8266 Development Board (NodeMCU/Wemos D1 Mini)
- 5× IR or Ultrasonic Proximity Sensors
- Servo Motor (SG90) for barrier
- Buzzer (active/passive)
- 2× LEDs (Green & Red) + 220Ω resistors
- Breadboard + Jumper wires
- 5V/3.3V power supply

### Pin Configuration (example)
```
ESP8266 Pin  │ Component
─────────────┼──────────────────
D1 (GPIO5)   │ Servo Motor
D0 (GPIO16)  │ Buzzer
D7 (GPIO13)  │ Green LED
D8 (GPIO15)  │ Red LED
D6 (GPIO12)  │ Entry IR Sensor
D5 (GPIO14)  │ Exit IR Sensor
D4 (GPIO2)   │ Space 1 Sensor
D2 (GPIO4)   │ Space 2 Sensor
D3 (GPIO0)   │ Space 3 Sensor
RX (GPIO3)   │ Space 4 Sensor
TX (GPIO1)   │ Space 5 Sensor
D1/D2        │ LCD I2C (SDA/SCL)
```

---

## 💻 Software Requirements

### Arduino IDE
- Arduino IDE 1.8.0+  
- ESP8266 Board Package (3.0.0+)  
- Required Libraries:  
  - `ArduinoWebsockets`  
  - `ESP8266WiFi` (built-in)  
  - `ArduinoJson`  
  - `LiquidCrystal_I2C`  
  - `Servo`, `Wire`  

### Backend
- Node.js 14+  
- npm 6+  
- MongoDB (for data storage)  

---

## 🚀 Installation

### 1. Clone Repository
```bash
git clone https://github.com/yourusername/smart-parking-system.git
cd smart-parking-system
```

### 2. Backend Setup
```bash
cd backend
npm install
npm start
```

### 3. Arduino Setup
- Open `VehicleParking.ino` in Arduino IDE  
- Install libraries (via Tools → Manage Libraries)  
- Upload to ESP8266 board  

### 4. Frontend Setup
```bash
cd frontend
npm install
npm run dev
```

---

## ⚙️ Configuration

### Arduino
```cpp
const char* ssid = "YOUR_WIFI";
const char* password = "YOUR_PASS";
const char* websocket_server = "ws://192.168.1.100:3000";
#define TOTAL_SPACES 5
```

### Backend
```js
const PORT = 3000;
let parkingData = { totalSpaces: 5 };
```

---

## 📖 Usage

1. Start backend server → `npm start`  
2. Upload Arduino firmware  
3. Run frontend → `npm run dev`  
4. Open `http://localhost:5173` for dashboard  
5. Monitor occupancy & control barrier  

---

## 📡 API Documentation

### WebSocket Events
**From Arduino → Server**
```json
{
  "type": "status_update",
  "available_spaces": 3,
  "total_spaces": 5,
  "occupancy_rate": 40
}
```

**From Server → Arduino**
```json
{ "command": "open_barrier" }
```

### REST Endpoints
- `GET /api/status` → Current status  
- `GET /api/events?limit=20` → Recent events  
- `POST /api/command` → Send control command  

---

## 🖥 Web Interface

- Real-time parking status  
- Occupancy & entry/exit counters  
- Space visualization grid  
- Manual barrier controls  
- Event logs with timestamps  

---
## Images
### Login Page
![Alt text](./assets/Login.png)
### SignUp Page
![Alt text](./assets/SignUp.png)
### User dashboard Page
![Alt text](./assets/User%20dashboard.png)
### Admin dashboard Page
![Alt text](./assets/Admin%20Dashboard.png)

## 🐛 Troubleshooting

- **WiFi issues** → Check SSID/password, ensure 2.4GHz  
- **WebSocket fail** → Verify server IP/port  
- **Sensor errors** → Check wiring & sensitivity  
- **Servo issues** → Use 5V supply, test separately  

---

## 🤝 Contributing

1. Fork repo  
2. Create feature branch  
3. Commit changes  
4. Push & open PR  

---

## 🙏 Acknowledgments

- Arduino & ESP8266 communities  
- Node.js WebSocket libraries  
- Contributors to this project  

---

## 📞 Support

- GitHub Issues → bug reports  
- Discussions → Q&A  
- Email → your.email@example.com  

---

## 🔄 Version History

- **v1.0.0** → Initial release  
- **v1.1.0** → Added dashboard + REST API  
- **v1.2.0** → Error handling & reconnection  
- **v1.3.0** → Event logging & analytics  

---

## 📜 License

The **Smart Parking Management System** (Arduino ESP8266 + Node.js + React Dashboard) is licensed under the **MIT License**.  

✅ Free to use, modify, and distribute  
ℹ️ Attribution required  
📄 See [LICENSE](LICENSE) file for details  
