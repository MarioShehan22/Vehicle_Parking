#include <ArduinoWebsockets.h>
#include <ESP8266WiFi.h>
#include <ArduinoJson.h>
#include <LiquidCrystal_I2C.h>
#include <Servo.h>
#include <Wire.h>
using namespace websockets;

// WiFi Configuration
const char* ssid = "Galaxy A13C2FB";
const char* password = "12345678";

// WebSocket Server Configuration
//const char* websocket_server = "ws://192.168.161.156:3000";
const char* websocket_server = "ws://13.203.208.127:3001";

// Pin Definitions
#define SERVO_PIN       5   // Barrier servo motor
#define BUZZER_PIN      16  // Buzzer for notifications
#define LED_GREEN       13  // Green LED
#define LED_RED         15  // Red LED
#define ENTRY_IR        12  // Entry IR sensor
#define EXIT_IR         14  // Exit IR sensor

// Parking Space Configuration
#define TOTAL_SPACES    5
#define SENSOR_DELAY    500   // 0.5 seconds between readings
#define BARRIER_OPEN_TIME 5000  // 5 seconds
#define DEBOUNCE_DELAY  200   // Debounce delay for IR sensors

// IR sensor pins for parking spaces
const int spaceIRPins[TOTAL_SPACES] = {2, 4, 0, 3, 1};

// Object Initializations
LiquidCrystal_I2C lcd(0x27, 16, 2);

Servo barrierServo;
WebsocketsClient client;

// Global Variables
bool spaceOccupied[TOTAL_SPACES] = {false};
int availableSpaces = TOTAL_SPACES;
unsigned long barrierOpenTime = 0;
bool barrierOpen = false;
bool entryDetected = false;
bool exitDetected = false;
unsigned long lastSpaceUpdate = 0;
unsigned long lastEntryTime = 0;
unsigned long lastExitTime = 0;
int totalVehiclesEntered = 0;
int totalVehiclesExited = 0;
bool websocketConnected = false;

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
    }
  }
}

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
    
  } else if(event == WebsocketsEvent::ConnectionClosed) {
    Serial.println("WebSocket Connection Closed");
    websocketConnected = false;
    
  } else if(event == WebsocketsEvent::GotPing) {
    Serial.println("Got a Ping!");
    
  } else if(event == WebsocketsEvent::GotPong) {
    Serial.println("Got a Pong!");
  }
}

void setup_wifi() {
  delay(10);
  Serial.println();
  Serial.print("Connecting to ");
  Serial.println(ssid);
  
  WiFi.begin(ssid, password);
  
  int attempts = 0;
  while (WiFi.status() != WL_CONNECTED && attempts < 30) {
    delay(500);
    Serial.print(".");
    attempts++;
    
    // Update LCD during connection
    lcd.setCursor(0, 1);
    lcd.print("WiFi..." + String(attempts));
  }
  
  if (WiFi.status() == WL_CONNECTED) {
    Serial.println("");
    Serial.println("WiFi connected!");
    Serial.print("IP address: ");
    Serial.println(WiFi.localIP());
    
    // Success sound
    digitalWrite(BUZZER_PIN, HIGH);
    delay(200);
    digitalWrite(BUZZER_PIN, LOW);
    
  } else {
    Serial.println("WiFi connection failed!");
    
    // Error sound
    for (int i = 0; i < 3; i++) {
      digitalWrite(BUZZER_PIN, HIGH);
      delay(100);
      digitalWrite(BUZZER_PIN, LOW);
      delay(100);
    }
  }
}

void setup() {
  Serial.begin(115200);
  Serial.println("Starting Parking System...");
  
  // Initialize pins
  pinMode(LED_GREEN, OUTPUT);
  pinMode(LED_RED, OUTPUT);
  pinMode(BUZZER_PIN, OUTPUT);
  pinMode(ENTRY_IR, INPUT);
  pinMode(EXIT_IR, INPUT);
  
  // Initialize parking space IR sensors
  for (int i = 0; i < TOTAL_SPACES; i++) {
    pinMode(spaceIRPins[i], INPUT);
  }
  
  // Initialize components
  lcd.init();
  lcd.backlight();
  barrierServo.attach(SERVO_PIN);
  
  // Close barrier initially
  barrierServo.write(0);
  
  // Display startup message
  lcd.setCursor(0, 0);
  lcd.print("Parking System");
  lcd.setCursor(0, 1);
  lcd.print("Starting...");
  
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
  Serial.println("System initialized");
  
  updateLCDDisplay();
}

void loop() {
  // Handle WebSocket connection
  client.poll();
  
  // Check if WebSocket is still connected
  if (!client.available() && websocketConnected) {
    Serial.println("WebSocket disconnected, attempting to reconnect...");
    websocketConnected = false;
    client.connect(websocket_server);
  }
  
  // Check entry/exit IR sensors
  checkEntryExitSensors();
  
  // Check individual parking spaces
  if (millis() - lastSpaceUpdate > SENSOR_DELAY) {
    checkParkingSpaces();
    lastSpaceUpdate = millis();
  }
  
  // Handle barrier control
  handleBarrier();
  
  // Update display
  updateLCDDisplay();
  
  // Send periodic status updates
  static unsigned long lastStatusUpdate = 0;
  if (millis() - lastStatusUpdate > 10000) { // Every 10 seconds
    sendStatusUpdate();
    lastStatusUpdate = millis();
  }
  
  delay(50);
}

void checkEntryExitSensors() {
  // Check entry sensor
  bool currentEntryState = digitalRead(ENTRY_IR) == LOW;
  if (currentEntryState && !entryDetected && (millis() - lastEntryTime > DEBOUNCE_DELAY)) {
    entryDetected = true;
    lastEntryTime = millis();
    handleVehicleEntry();
    Serial.println("Vehicle detected at ENTRY");
  } else if (!currentEntryState && entryDetected) {
    entryDetected = false;
  }
  
  // Check exit sensor
  bool currentExitState = digitalRead(EXIT_IR) == LOW;
  if (currentExitState && !exitDetected && (millis() - lastExitTime > DEBOUNCE_DELAY)) {
    exitDetected = true;
    lastExitTime = millis();
    handleVehicleExit();
    Serial.println("Vehicle detected at EXIT");
  } else if (!currentExitState && exitDetected) {
    exitDetected = false;
  }
}

void checkParkingSpaces() {
  bool spaceChanged = false;
  
  for (int i = 0; i < TOTAL_SPACES; i++) {
    bool isOccupied = digitalRead(spaceIRPins[i]) == LOW;
    
    if (spaceOccupied[i] != isOccupied) {
      spaceOccupied[i] = isOccupied;
      spaceChanged = true;
      
      Serial.print("Space ");
      Serial.print(i + 1);
      Serial.print(": ");
      Serial.println(isOccupied ? "OCCUPIED" : "FREE");
      
      // Send space update
      sendSpaceUpdate(i, isOccupied);
      
      // Sound notification
      digitalWrite(BUZZER_PIN, HIGH);
      delay(50);
      digitalWrite(BUZZER_PIN, LOW);
    }
  }
  
  if (spaceChanged) {
    calculateAvailableSpaces();
    sendStatusUpdate();
  }
}

void calculateAvailableSpaces() {
  int occupied = 0;
  for (int i = 0; i < TOTAL_SPACES; i++) {
    if (spaceOccupied[i]) {
      occupied++;
    }
  }
  availableSpaces = TOTAL_SPACES - occupied;
}

void handleVehicleEntry() {
  totalVehiclesEntered++;
  
  if (availableSpaces > 0) {
    openBarrier();
    digitalWrite(LED_GREEN, HIGH);
    digitalWrite(LED_RED, LOW);
    
    // Success sound
    digitalWrite(BUZZER_PIN, HIGH);
    delay(200);
    digitalWrite(BUZZER_PIN, LOW);
    
    Serial.println("Vehicle entry allowed - Spaces available: " + String(availableSpaces));
    
  } else {
    // No spaces available
    digitalWrite(LED_RED, HIGH);
    digitalWrite(LED_GREEN, LOW);
    
    // Error sound
    for (int i = 0; i < 3; i++) {
      digitalWrite(BUZZER_PIN, HIGH);
      delay(100);
      digitalWrite(BUZZER_PIN, LOW);
      delay(100);
    }
    
    Serial.println("Vehicle entry denied - No spaces available");
  }
  
  // Send entry event
  sendVehicleEntry();
}

void handleVehicleExit() {
  totalVehiclesExited++;
  
  openBarrier();
  digitalWrite(LED_GREEN, HIGH);
  digitalWrite(LED_RED, LOW);
  
  // Success sound
  digitalWrite(BUZZER_PIN, HIGH);
  delay(200);
  digitalWrite(BUZZER_PIN, LOW);
  
  Serial.println("Vehicle exit processed");
  
  // Send exit event
  sendVehicleExit();
}

void openBarrier() {
  if (!barrierOpen) {
    barrierServo.write(90); // Open position
    barrierOpen = true;
    barrierOpenTime = millis();
    Serial.println("Barrier OPENED");
    
    sendBarrierStatus("OPEN");
  }
}

void closeBarrier() {
  barrierServo.write(0); // Close position
  barrierOpen = false;
  Serial.println("Barrier CLOSED");
  
  sendBarrierStatus("CLOSED");
}

void handleBarrier() {
  // Auto-close barrier after specified time
  if (barrierOpen && (millis() - barrierOpenTime) > BARRIER_OPEN_TIME) {
    closeBarrier();
  }
}

void updateLCDDisplay() {
  static unsigned long lastLCDUpdate = 0;
  if (millis() - lastLCDUpdate > 1000) { // Update every second
    lcd.setCursor(0, 0);
    lcd.print("Spaces: ");
    lcd.print(availableSpaces);
    lcd.print("/");
    lcd.print(TOTAL_SPACES);
    lcd.print("   ");
    
    lcd.setCursor(0, 1);
    if (websocketConnected) {
      lcd.print("Online  ");
    } else {
      lcd.print("Offline ");
    }
    
    if (barrierOpen) {
      lcd.print("OPEN  ");
    } else {
      lcd.print("CLOSED");
    }
    
    lastLCDUpdate = millis();
  }
}

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
  
  JsonArray spaces = doc.createNestedArray("spaces");
  for (int i = 0; i < TOTAL_SPACES; i++) {
    JsonObject space = spaces.createNestedObject();
    space["id"] = i + 1;
    space["occupied"] = spaceOccupied[i];
    space["status"] = spaceOccupied[i] ? "OCCUPIED" : "FREE";
  }
  
  String message;
  serializeJson(doc, message);
  client.send(message);
}

void sendVehicleEntry() {
  if (!websocketConnected) return;
  
  DynamicJsonDocument doc(512);
  doc["type"] = "vehicle_entry";
  doc["timestamp"] = millis();
  doc["available_spaces"] = availableSpaces;
  doc["total_entries"] = totalVehiclesEntered;
  doc["entry_allowed"] = (availableSpaces > 0);
  
  String message;
  serializeJson(doc, message);
  client.send(message);
}

void sendVehicleExit() {
  if (!websocketConnected) return;
  
  DynamicJsonDocument doc(512);
  doc["type"] = "vehicle_exit";
  doc["timestamp"] = millis();
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
