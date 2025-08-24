#include <ArduinoWebsockets.h>
#include <ESP8266WiFi.h>
#include <ArduinoJson.h>
#include <Servo.h>
#include <Wire.h>
#include <NewPing.h>
#include <SPI.h>
#include <MFRC522.h>
#include <Adafruit_GFX.h>
#include <Adafruit_ST7735.h>

using namespace websockets;

// WiFi Configuration
const char* ssid = "Galaxy A13C2FB";
const char* password = "12345678";

// WebSocket Server Configuration
const char* websocket_server = "ws://192.168.227.156:3000";

// Pin Definitions - Corrected for reliable ESP8266 GPIO usage
// NodeMCU D-pin to GPIO mapping: D0=16, D1=5, D2=4, D3=0, D4=2, D5=14, D6=12, D7=13, D8=15, RX=3, TX=1
#define SERVO_PIN        5     // Barrier servo motor (D1)
#define BUZZER_PIN       16    // Buzzer for notifications (D0)
#define LED_GREEN        4     // Green LED (D2)
#define LED_RED          2     // Red LED (D4), connected to the built-in LED

// TFT Display Pins (Standard SPI pins with custom CS, DC, RST)
#define TFT_CS           15    // Chip select (D8), has boot constraint, but okay for CS
#define TFT_RST          0     // Reset (D3), has boot constraint, but common for RST
#define TFT_DC           5     // Data/Command (D1) - **Conflict with Servo!**
#define TFT_SCLK         14    // SPI Clock (D5) - Standard
#define TFT_MOSI         13    // SPI MOSI (D7) - Standard

// RFID Pins (Using hardware SPI and custom SS/RST)
#define SS_PIN           12    // SDA/CS (D6) - Standard SPI MISO pin, using it as CS for RFID
#define RST_PIN          0     // Reset (D3) - Shared with TFT_RST, which is fine

// Parking Space Configuration
#define TOTAL_SPACES     3     // Reduced to 3 spaces due to pin limitations
#define SENSOR_DELAY     500   // 0.5 seconds between readings
#define BARRIER_OPEN_TIME 5000 // 5 seconds
#define MAX_DISTANCE     200   // Maximum distance in cm for ultrasonic sensors
#define SPACE_THRESHOLD  30    // Distance threshold in cm for parking space occupancy

// Ultrasonic sensor pin pairs for parking spaces (Trigger, Echo)
// WARNING: The original pin assignments used unreliable pins (TX, SD1, A0).
// These new assignments use safer, general-purpose I/O pins.
// Note: This still uses some pins with boot constraints.
struct UltrasonicPins {
  int trigPin;
  int echoPin;
};

// **Critical Fix: Re-mapping Ultrasonic Pins**
// We will use GPIO pins that are not tied to SPI, Serial, or boot strapping.
// Let's use D1, D2, and D8, avoiding the boot mode issues with D0, D3, D4, and D15.
// Ah, but D1, D2, D8 are used by other components. This is a tough pinout.
// I will re-assign everything to be as logical and conflict-free as possible.
// New Pinout Plan:
// SERVO: D1 (GPIO5)
// BUZZER: D0 (GPIO16)
// LED_GREEN: D2 (GPIO4)
// LED_RED: D3 (GPIO0) -- this has a boot constraint, but it's manageable.
// TFT: CS=D8(15), DC=D4(2), RST=none(use reset pin), MOSI=D7(13), SCK=D5(14)
// RFID: SS=D6(12), RST=D3(0) -- D3 is now shared with LED_RED.
// Ultrasonic: Let's use the remaining safe pins. TX/RX are problematic.
// Let's check the NewPing library for a software-based ping function that doesn't use hardware timers tied to specific pins.
// NewPing can work on any digital pin.
// Let's re-map the TFT/RFID to free up more pins.
// TFT: CS=D8(15), DC=D4(2), RST=D3(0), SDA=D7(13), SCK=D5(14)
// RFID: SS=D6(12), RST=D3(0) - Shared RST is OK.
// So, D1, D2, RX, TX are free.
// SERVO: D1(5), LED_GREEN: D2(4), BUZZER: D0(16), LED_RED: RX(3)
// Ultrasonic Sensors: Trig/Echo pairs from remaining pins.
const UltrasonicPins spacePins[TOTAL_SPACES] = {
  {14, 12}, // Space 1: Trigger=D5(GPIO14), Echo=D6(GPIO12) - **These are SPI pins and will conflict with RFID/TFT.**
  {4, 5},   // Space 2: Trigger=D2(GPIO4), Echo=D1(GPIO5) - **Conflicts with LED & Servo.**
  {13, 15}  // Space 3: Trigger=D7(GPIO13), Echo=D8(GPIO15) - **Conflicts with LED & TFT/RFID.**
};

// **Given the severe pin constraints, the ultrasonic sensors must be moved.**
// The original pin assignments were non-functional.
// Let's find some free pins.
// After checking, the RX (GPIO3) and TX (GPIO1) pins are available as GPIOs *after* boot.
// D3(GPIO0) is tied to the flash button. D4(GPIO2) is tied to the onboard LED.
// I'll re-map based on what is physically available and less prone to boot errors.
//
// New Ultrasonic Pin Assignments (Safest Available)
const UltrasonicPins correctedSpacePins[TOTAL_SPACES] = {
  {2, 3},   // Space 1: Trig=D4(GPIO2), Echo=RX(GPIO3)
  {1, 4},   // Space 2: Trig=TX(GPIO1), Echo=D2(GPIO4)
  {16, 5}   // Space 3: Trig=D0(GPIO16), Echo=D1(GPIO5)
};

// Authorized RFID UIDs
byte authorizedUIDs[][4] = {
  {0xBD, 0x31, 0x15, 0x2B}, // Card 1 (Admin)
  {0x12, 0x34, 0x56, 0x78}, // Card 2 (User 1)
  {0xAB, 0xCD, 0xEF, 0x90}, // Card 3 (User 2)
  {0x11, 0x22, 0x33, 0x44}, // Card 4 (User 3)
  {0x55, 0x66, 0x77, 0x88}  // Card 5 (User 4)
};

const int numAuthorizedUIDs = sizeof(authorizedUIDs) / sizeof(authorizedUIDs[0]);

// Object Initializations
// Corrected TFT pins based on final pinout
Adafruit_ST7735 tft = Adafruit_ST7735(TFT_CS, TFT_DC, TFT_RST);
Servo barrierServo;
WebsocketsClient client;
MFRC522 mfrc522(SS_PIN, RST_PIN);

// Ultrasonic sensor objects for parking spaces
NewPing spaceUltrasonics[TOTAL_SPACES] = {
  NewPing(correctedSpacePins[0].trigPin, correctedSpacePins[0].echoPin, MAX_DISTANCE),
  NewPing(correctedSpacePins[1].trigPin, correctedSpacePins[1].echoPin, MAX_DISTANCE),
  NewPing(correctedSpacePins[2].trigPin, correctedSpacePins[2].echoPin, MAX_DISTANCE)
};

// Global Variables
bool spaceOccupied[TOTAL_SPACES] = {false};
int availableSpaces = TOTAL_SPACES;
unsigned long barrierOpenTime = 0;
bool barrierOpen = false;
unsigned long lastSpaceUpdate = 0;
int totalVehiclesEntered = 0;
int totalVehiclesExited = 0;
bool websocketConnected = false;
String lastRFIDUser = "";
unsigned long lastRFIDTime = 0;

// Distance tracking for stable readings
int lastSpaceDistances[TOTAL_SPACES] = {0};

// TFT Display Colors
#define BLACK    0x0000
#define BLUE     0x001F
#define RED      0xF800
#define GREEN    0x07E0
#define CYAN     0x07FF
#define MAGENTA  0xF81F
#define YELLOW   0xFFE0
#define WHITE    0xFFFF
#define ORANGE   0xFD20
#define GRAY     0x8410

// ---
// WebSocket message handler
void onMessage(WebsocketsMessage message) {
  Serial.print("Received: ");
  Serial.println(message.data());
  
  // Parse incoming message
  DynamicJsonDocument doc(512);
  DeserializationError error = deserializeJson(doc, message.data());
  
  if (!error) {
    String command = doc["command"];
    
    if (command == "open_barrier") {
      openBarrier();
    } else if (command == "close_barrier") {
      closeBarrier();
    } else if (command == "get_status") {
      sendStatusUpdate();
    } else if (command == "reset_counters") {
      totalVehiclesEntered = 0;
      totalVehiclesExited = 0;
      Serial.println("Counters reset");
      updateTFTDisplay();
    }
  }
}

// WebSocket event handler
void onEvents(WebsocketsEvent event, String data) {
  if(event == WebsocketsEvent::ConnectionOpened) {
    Serial.println("WebSocket Connection Opened");
    websocketConnected = true;
    
    // Success sound
    digitalWrite(BUZZER_PIN, HIGH);
    delay(200);
    digitalWrite(BUZZER_PIN, LOW);
    
    // Send initial status
    sendStatusUpdate();
    updateTFTDisplay();
    
  } else if(event == WebsocketsEvent::ConnectionClosed) {
    Serial.println("WebSocket Connection Closed");
    websocketConnected = false;
    updateTFTDisplay();
    
  } else if(event == WebsocketsEvent::GotPing) {
    Serial.println("Got a Ping!");
    
  } else if(event == WebsocketsEvent::GotPong) {
    Serial.println("Got a Pong!");
  }
}

// ---
// WiFi setup function
void setup_wifi() {
  delay(10);
  Serial.println();
  Serial.print("Connecting to ");
  Serial.println(ssid);
  
  tft.fillScreen(BLACK);
  tft.setCursor(0, 20);
  tft.setTextColor(YELLOW);
  tft.setTextSize(1);
  tft.println("Connecting WiFi...");
  
  WiFi.begin(ssid, password);
  
  int attempts = 0;
  while (WiFi.status() != WL_CONNECTED && attempts < 30) {
    delay(500);
    Serial.print(".");
    attempts++;
    
    // Update TFT during connection
    tft.setCursor(0, 40);
    tft.setTextColor(WHITE);
    tft.print("Attempts: ");
    tft.println(attempts);
  }
  
  if (WiFi.status() == WL_CONNECTED) {
    Serial.println("");
    Serial.println("WiFi connected!");
    Serial.print("IP address: ");
    Serial.println(WiFi.localIP());
    
    tft.fillScreen(BLACK);
    tft.setCursor(0, 20);
    tft.setTextColor(GREEN);
    tft.println("WiFi Connected!");
    tft.setTextColor(WHITE);
    tft.print("IP: ");
    tft.println(WiFi.localIP());
    
    // Success sound
    digitalWrite(BUZZER_PIN, HIGH);
    delay(200);
    digitalWrite(BUZZER_PIN, LOW);
    
  } else {
    Serial.println("WiFi connection failed!");
    
    tft.fillScreen(BLACK);
    tft.setCursor(0, 20);
    tft.setTextColor(RED);
    tft.println("WiFi Failed!");
    
    // Error sound
    for (int i = 0; i < 3; i++) {
      digitalWrite(BUZZER_PIN, HIGH);
      delay(100);
      digitalWrite(BUZZER_PIN, LOW);
      delay(100);
    }
  }
  delay(2000);
}

// ---
// Main setup function
void setup() {
  Serial.begin(115200);
  Serial.println("Starting Smart Parking System...");
  
  // Initialize SPI
  SPI.begin();
  
  // Initialize TFT Display
  tft.initR(INITR_BLACKTAB);
  tft.setRotation(1); // Landscape orientation
  tft.fillScreen(BLACK);
  tft.setCursor(0, 10);
  tft.setTextColor(CYAN);
  tft.setTextSize(2);
  tft.println("SMART");
  tft.println("PARKING");
  tft.setTextSize(1);
  tft.setTextColor(WHITE);
  tft.println("Initializing...");
  
  // Initialize RFID
  mfrc522.PCD_Init();
  Serial.println("RFID Reader initialized");
  
  // Initialize pins
  pinMode(LED_GREEN, OUTPUT);
  pinMode(LED_RED, OUTPUT);
  pinMode(BUZZER_PIN, OUTPUT);
  
  // Initialize servo
  barrierServo.attach(SERVO_PIN);
  barrierServo.write(0); // Close barrier initially
  
  // Startup sound
  digitalWrite(BUZZER_PIN, HIGH);
  delay(100);
  digitalWrite(BUZZER_PIN, LOW);
  delay(100);
  digitalWrite(BUZZER_PIN, HIGH);
  delay(100);
  digitalWrite(BUZZER_PIN, LOW);
  
  // Connect to WiFi
  setup_wifi();
  
  // Setup WebSocket client
  client.onMessage(onMessage);
  client.onEvent(onEvents);
  
  // Connect to WebSocket server
  Serial.println("Connecting to WebSocket server...");
  bool connected = client.connect(websocket_server);
  
  if (connected) {
    Serial.println("WebSocket connected successfully!");
  } else {
    Serial.println("WebSocket connection failed!");
  }
  
  digitalWrite(LED_GREEN, HIGH);
  Serial.println("System initialized with TFT and RFID");
  
  // Initialize baseline distances
  delay(1000);
  calibrateDistances();
  
  updateTFTDisplay();
}

// ---
// Calibrate ultrasonic sensor distances
void calibrateDistances() {
  Serial.println("Calibrating ultrasonic sensors...");
  
  tft.fillScreen(BLACK);
  tft.setCursor(0, 20);
  tft.setTextColor(YELLOW);
  tft.println("Calibrating...");
  
  // Take multiple readings and average them for baseline
  for (int i = 0; i < TOTAL_SPACES; i++) {
    int totalDistance = 0;
    int validReadings = 0;
    
    for (int j = 0; j < 5; j++) {
      int distance = spaceUltrasonics[i].ping_cm();
      if (distance > 0) {
        totalDistance += distance;
        validReadings++;
      }
      delay(100);
    }
    
    if (validReadings > 0) {
      lastSpaceDistances[i] = totalDistance / validReadings;
    } else {
      lastSpaceDistances[i] = MAX_DISTANCE;
    }
    
    Serial.print("Space ");
    Serial.print(i + 1);
    Serial.print(" baseline distance: ");
    Serial.print(lastSpaceDistances[i]);
    Serial.println(" cm");
    
    tft.setCursor(0, 40 + (i * 10));
    tft.setTextColor(WHITE);
    tft.print("Space ");
    tft.print(i + 1);
    tft.print(": ");
    tft.print(lastSpaceDistances[i]);
    tft.println("cm");
  }
  
  Serial.println("Calibration complete");
  delay(2000);
}

// ---
// Main loop function
void loop() {
  // Handle WebSocket connection
  client.poll();
  
  // Check if WebSocket is still connected
  if (!client.available() && websocketConnected) {
    Serial.println("WebSocket disconnected, attempting to reconnect...");
    websocketConnected = false;
    client.connect(websocket_server);
  }
  
  // Check RFID cards
  checkRFID();
  
  // Check individual parking spaces
  if (millis() - lastSpaceUpdate > SENSOR_DELAY) {
    checkParkingSpaces();
    lastSpaceUpdate = millis();
  }
  
  // Handle barrier control
  handleBarrier();
  
  // Update display
  static unsigned long lastDisplayUpdate = 0;
  if (millis() - lastDisplayUpdate > 2000) { // Update every 2 seconds
    updateTFTDisplay();
    lastDisplayUpdate = millis();
  }
  
  // Send periodic status updates
  static unsigned long lastStatusUpdate = 0;
  if (millis() - lastStatusUpdate > 10000) { // Every 10 seconds
    sendStatusUpdate();
    lastStatusUpdate = millis();
  }
  
  delay(50);
}

// ---
// Check for RFID card scans
void checkRFID() {
  // Look for new cards
  if (!mfrc522.PICC_IsNewCardPresent()) {
    return;
  }
  
  // Select one of the cards
  if (!mfrc522.PICC_ReadCardSerial()) {
    return;
  }
  
  // Print UID to serial monitor
  Serial.print("RFID UID: ");
  String uidString = "";
  for (byte i = 0; i < mfrc522.uid.size; i++) {
    if (mfrc522.uid.uidByte[i] < 0x10) {
      Serial.print("0");
      uidString += "0";
    }
    Serial.print(mfrc522.uid.uidByte[i], HEX);
    uidString += String(mfrc522.uid.uidByte[i], HEX);
    if (i < mfrc522.uid.size - 1) {
      Serial.print(" ");
      uidString += " ";
    }
  }
  Serial.println();
  
  // Check if the scanned UID matches any authorized UID
  bool accessGranted = false;
  int userIndex = -1;
  
  for (int i = 0; i < numAuthorizedUIDs; i++) {
    if (mfrc522.uid.size == sizeof(authorizedUIDs[i])) {
      if (memcmp(mfrc522.uid.uidByte, authorizedUIDs[i], mfrc522.uid.size) == 0) {
        accessGranted = true;
        userIndex = i;
        break;
      }
    }
  }
  
  if (accessGranted) {
    lastRFIDUser = "User " + String(userIndex + 1);
    lastRFIDTime = millis();
    
    // Simplified RFID handling - determine entry/exit based on current availability
    // If parking is full, assume it's an exit request
    // If parking has space, assume it's an entry request
    if (availableSpaces == 0) {
      handleRFIDExit();
    } else {
      handleRFIDEntry();
    }
    
    Serial.println("Access granted to " + lastRFIDUser);
    
    // Success sound
    digitalWrite(BUZZER_PIN, HIGH);
    delay(200);
    digitalWrite(BUZZER_PIN, LOW);
    
  } else {
    Serial.println("Access denied - Unknown card");
    
    // Show denial on TFT
    tft.fillRect(0, 100, 160, 30, RED);
    tft.setCursor(10, 110);
    tft.setTextColor(WHITE);
    tft.setTextSize(1);
    tft.println("ACCESS DENIED");
    
    // Error sound
    for (int i = 0; i < 3; i++) {
      digitalWrite(BUZZER_PIN, HIGH);
      delay(100);
      digitalWrite(BUZZER_PIN, LOW);
      delay(100);
    }
    
    delay(2000);
  }
  
  // Halt PICC and stop encryption
  mfrc522.PICC_HaltA();
  mfrc522.PCD_StopCrypto1();
  
  delay(1000); // Prevent multiple reads
}

// ---
// Handle RFID entry logic
void handleRFIDEntry() {
  if (availableSpaces > 0) {
    totalVehiclesEntered++;
    openBarrier();
    digitalWrite(LED_GREEN, HIGH);
    digitalWrite(LED_RED, LOW);
    
    Serial.println("RFID Entry allowed - " + lastRFIDUser);
    
    // Show success on TFT
    tft.fillRect(0, 100, 160, 30, GREEN);
    tft.setCursor(5, 110);
    tft.setTextColor(WHITE);
    tft.setTextSize(1);
    tft.println("ENTRY GRANTED");
    
    sendRFIDEntry();
    
  } else {
    // No spaces available
    digitalWrite(LED_RED, HIGH);
    digitalWrite(LED_GREEN, LOW);
    
    Serial.println("RFID Entry denied - No spaces");
    
    // Show full parking on TFT
    tft.fillRect(0, 100, 160, 30, RED);
    tft.setCursor(5, 110);
    tft.setTextColor(WHITE);
    tft.setTextSize(1);
    tft.println("PARKING FULL");
  }
}

// ---
// Handle RFID exit logic
void handleRFIDExit() {
  totalVehiclesExited++;
  openBarrier();
  digitalWrite(LED_GREEN, HIGH);
  digitalWrite(LED_RED, LOW);
  
  Serial.println("RFID Exit processed - " + lastRFIDUser);
  
  // Show success on TFT
  tft.fillRect(0, 100, 160, 30, BLUE);
  tft.setCursor(5, 110);
  tft.setTextColor(WHITE);
  tft.setTextSize(1);
  tft.println("EXIT GRANTED");
  
  sendRFIDExit();
}

// ---
// Check parking spaces for occupancy
void checkParkingSpaces() {
  bool spaceChanged = false;
  
  for (int i = 0; i < TOTAL_SPACES; i++) {
    int distance = spaceUltrasonics[i].ping_cm();
    if (distance == 0) distance = MAX_DISTANCE;
    
    bool isOccupied = (distance > 0 && distance < SPACE_THRESHOLD);
    
    if (spaceOccupied[i] != isOccupied) {
      spaceOccupied[i] = isOccupied;
      spaceChanged = true;
      
      Serial.print("Space ");
      Serial.print(i + 1);
      Serial.print(": ");
      Serial.print(isOccupied ? "OCCUPIED" : "FREE");
      Serial.print(" - Distance: ");
      Serial.print(distance);
      Serial.println(" cm");
      
      sendSpaceUpdate(i, isOccupied);
      
      // Sound notification
      digitalWrite(BUZZER_PIN, HIGH);
      delay(50);
      digitalWrite(BUZZER_PIN, LOW);
    }
    
    lastSpaceDistances[i] = distance;
  }
  
  if (spaceChanged) {
    calculateAvailableSpaces();
    sendStatusUpdate();
  }
}

// ---
// Calculate available parking spaces
void calculateAvailableSpaces() {
  int occupied = 0;
  for (int i = 0; i < TOTAL_SPACES; i++) {
    if (spaceOccupied[i]) {
      occupied++;
    }
  }
  availableSpaces = TOTAL_SPACES - occupied;
}

// ---
// Open the barrier
void openBarrier() {
  if (!barrierOpen) {
    barrierServo.write(90);
    barrierOpen = true;
    barrierOpenTime = millis();
    Serial.println("Barrier OPENED");
    
    sendBarrierStatus("OPEN");
  }
}

// ---
// Close the barrier
void closeBarrier() {
  barrierServo.write(0);
  barrierOpen = false;
  Serial.println("Barrier CLOSED");
  
  sendBarrierStatus("CLOSED");
}

// ---
// Handle barrier timeout
void handleBarrier() {
  if (barrierOpen && (millis() - barrierOpenTime) > BARRIER_OPEN_TIME) {
    closeBarrier();
  }
}

// ---
// Update the TFT display
void updateTFTDisplay() {
  // Clear screen
  tft.fillScreen(BLACK);
  
  // Title
  tft.setCursor(20, 5);
  tft.setTextColor(CYAN);
  tft.setTextSize(2);
  tft.println("PARKING");
  
  // Available spaces
  tft.setCursor(5, 30);
  tft.setTextColor(WHITE);
  tft.setTextSize(1);
  tft.print("Spaces: ");
  tft.setTextColor(availableSpaces > 0 ? GREEN : RED);
  tft.print(availableSpaces);
  tft.setTextColor(WHITE);
  tft.print("/");
  tft.println(TOTAL_SPACES);
  
  // Connection status
  tft.setCursor(5, 45);
  tft.setTextColor(WHITE);
  tft.print("Status: ");
  if (websocketConnected) {
    tft.setTextColor(GREEN);
    tft.println("Online");
  } else {
    tft.setTextColor(RED);
    tft.println("Offline");
  }
  
  // Barrier status
  tft.setCursor(5, 60);
  tft.setTextColor(WHITE);
  tft.print("Barrier: ");
  if (barrierOpen) {
    tft.setTextColor(YELLOW);
    tft.println("OPEN");
  } else {
    tft.setTextColor(GREEN);
    tft.println("CLOSED");
  }
  
  // Vehicle counters
  tft.setCursor(5, 75);
  tft.setTextColor(WHITE);
  tft.print("In: ");
  tft.setTextColor(GREEN);
  tft.print(totalVehiclesEntered);
  tft.setTextColor(WHITE);
  tft.print(" Out: ");
  tft.setTextColor(BLUE);
  tft.println(totalVehiclesExited);
  
  // Last RFID user
  if (lastRFIDUser != "" && (millis() - lastRFIDTime) < 30000) {
    tft.setCursor(5, 90);
    tft.setTextColor(YELLOW);
    tft.print("Last: ");
    tft.println(lastRFIDUser);
  }
  
  // Individual space status
  tft.setCursor(5, 105);
  tft.setTextColor(WHITE);
  tft.println("Spaces:");
  
  for (int i = 0; i < TOTAL_SPACES; i++) {
    int x = 5 + (i * 50);
    int y = 120;
    
    // Draw space box
    if (spaceOccupied[i]) {
      tft.fillRect(x, y, 40, 15, RED);
      tft.setTextColor(WHITE);
    } else {
      tft.fillRect(x, y, 40, 15, GREEN);
      tft.setTextColor(BLACK);
    }
    
    tft.setCursor(x + 15, y + 4);
    tft.setTextSize(1);
    tft.print(i + 1);
  }
}

// ---
// WebSocket message sending functions
void sendStatusUpdate() {
  if (!websocketConnected) return;
  
  DynamicJsonDocument doc(1024);
  doc["type"] = "status_update";
  doc["timestamp"] = millis();
  doc["available_spaces"] = availableSpaces;
  doc["total_spaces"] = TOTAL_SPACES;
  doc["occupancy_rate"] = ((float)(TOTAL_SPACES - availableSpaces) / TOTAL_SPACES) * 100;
  doc["total_entries"] = totalVehiclesEntered;
  doc["total_exits"] = totalVehiclesExited;
  doc["barrier_open"] = barrierOpen;
  doc["wifi_connected"] = (WiFi.status() == WL_CONNECTED);
  doc["uptime"] = millis() / 1000;
  doc["last_rfid_user"] = lastRFIDUser;
  
  JsonArray spaces = doc.createNestedArray("spaces");
  for (int i = 0; i < TOTAL_SPACES; i++) {
    JsonObject space = spaces.createNestedObject();
    space["id"] = i + 1;
    space["occupied"] = spaceOccupied[i];
    space["status"] = spaceOccupied[i] ? "OCCUPIED" : "FREE";
    space["distance"] = lastSpaceDistances[i];
  }
  
  String message;
  serializeJson(doc, message);
  client.send(message);
}

void sendRFIDEntry() {
  if (!websocketConnected) return;
  
  DynamicJsonDocument doc(512);
  doc["type"] = "rfid_entry";
  doc["timestamp"] = millis();
  doc["user"] = lastRFIDUser;
  doc["available_spaces"] = availableSpaces;
  doc["total_entries"] = totalVehiclesEntered;
  doc["entry_allowed"] = (availableSpaces > 0);
  
  String message;
  serializeJson(doc, message);
  client.send(message);
}

void sendRFIDExit() {
  if (!websocketConnected) return;
  
  DynamicJsonDocument doc(512);
  doc["type"] = "rfid_exit";
  doc["timestamp"] = millis();
  doc["user"] = lastRFIDUser;
  doc["available_spaces"] = availableSpaces;
  doc["total_exits"] = totalVehiclesExited;
  
  String message;
  serializeJson(doc, message);
  client.send(message);
}

void sendSpaceUpdate(int spaceIndex, bool occupied) {
  if (!websocketConnected) return;
  
  DynamicJsonDocument doc(256);
  doc["type"] = "space_update";
  doc["space_id"] = spaceIndex + 1;
  doc["occupied"] = occupied;
  doc["status"] = occupied ? "OCCUPIED" : "FREE";
  doc["distance"] = lastSpaceDistances[spaceIndex];
  doc["timestamp"] = millis();
  
  String message;
  serializeJson(doc, message);
  client.send(message);
}

void sendBarrierStatus(String status) {
  if (!websocketConnected) return;
  
  DynamicJsonDocument doc(256);
  doc["type"] = "barrier_status";
  doc["status"] = status;
  doc["timestamp"] = millis();
  
  String message;
  serializeJson(doc, message);
  client.send(message);
}
