#include <ArduinoWebsockets.h>
#include <ESP8266WiFi.h>
#include <ArduinoJson.h>
#include <Servo.h>
#include <Wire.h>
#include <MFRC522.h>
#include <SPI.h>

// ===================== Config =====================
// WiFi
const char* ssid             = "Galaxy A13C2FB";
const char* password         = "12345678";
const char* websocket_server = "ws://192.168.21.222:3000";

// Pins
#define SERVO_PIN   15
#define LED_GREEN   -1
#define RST_PIN     0
#define SS_PIN      5
#define TRIGGER_PIN 4
#define ECHO_PIN_1  16
#define ECHO_PIN_2  2
#define ECHO_PIN_3  -1
#define BUZZER_PIN  1

// Lot
#define TOTAL_SPACES         2
#define BARRIER_OPEN_TIME    5000
#define RFID_DEBOUNCE_MS     1500
#define ENTRY_EXIT_WINDOW_MS 60000

// ===================== Globals =====================
using websockets::WebsocketsClient;
WebsocketsClient client;
MFRC522 mfrc522(SS_PIN, RST_PIN);
Servo barrierServo;

// Parking state
volatile bool barrierOpen = false;
unsigned long barrierOpenTime = 0;
int slotStatuses[TOTAL_SPACES]     = {0};
int prevSlotStatuses[TOTAL_SPACES] = {0};
int slotDistances[TOTAL_SPACES]    = {0};
int availableSpaces                = TOTAL_SPACES;
int totalVehiclesEntered           = 0;
int totalVehiclesExited            = 0;

// RFID
String lastRFID = "";
unsigned long lastRFIDMillis = 0;
String slotUID[TOTAL_SPACES];  // map slot -> RFID card

// Gate state
enum GateMode { MODE_IDLE, MODE_ENTRY_AUTH, MODE_EXIT_AUTH };
GateMode gateMode = MODE_IDLE;
unsigned long modeSinceMillis = 0;

// ===================== Forward Declarations =====================
void setup_wifi();
void onMessage(websockets::WebsocketsMessage message);
void onEvents(websockets::WebsocketsEvent event, String data);

void checkRFID();
void handleVehicleEntryExit(String cardUID);

void openBarrier();
void closeBarrier();
void handleBarrier();

int readSlotDistance(int echoPin);
void processSlots();

void sendStatusUpdate();
void sendParkingSpaceStatus(int status, int slotNumber, int distance);
void sendVehicleEvent(const char* action, int slotNumber, String uid);
void sendGateMode(GateMode mode, String uid);

// ===================== Setup =====================
void setup() {
  Serial.begin(115200);
  delay(50);
  Serial.println("\nStarting Parking System...");

  pinMode(BUZZER_PIN, OUTPUT);
  digitalWrite(BUZZER_PIN, LOW);

  // IO setup
  pinMode(LED_GREEN, OUTPUT);
  digitalWrite(LED_GREEN, LOW);
  pinMode(TRIGGER_PIN, OUTPUT);
  if (ECHO_PIN_1 >= 0) pinMode(ECHO_PIN_1, INPUT);
  if (ECHO_PIN_2 >= 0) pinMode(ECHO_PIN_2, INPUT);
  if (ECHO_PIN_3 >= 0) pinMode(ECHO_PIN_3, INPUT);

  // Peripherals
  SPI.begin();
  mfrc522.PCD_Init();
  barrierServo.attach(SERVO_PIN);
  barrierServo.write(0); // closed

  // WiFi + WebSocket
  setup_wifi();
  client.onMessage(onMessage);
  client.onEvent(onEvents);

  Serial.println("Connecting WS...");
  if (client.connect(websocket_server)) {
    Serial.println("WS connected!");
  } else {
    Serial.println("WS connection failed");
  }

  // Init slots
  for (int i = 0; i < TOTAL_SPACES; i++) {
    slotStatuses[i] = 0;
    prevSlotStatuses[i] = 0;
    slotUID[i] = "";
  }
}
void buzz(uint16_t ms = 150) {
  digitalWrite(BUZZER_PIN, HIGH);
  delay(ms);
  digitalWrite(BUZZER_PIN, LOW);
}

// ===================== Loop =====================
void loop() {
  // Keep WebSocket alive
  client.poll();
  if (!client.available()) {
    Serial.println("WS disconnected, reconnecting...");
    client.connect(websocket_server);
  }

  // Check RFID scans
  checkRFID();

  // Barrier auto-close
  handleBarrier();

  // Process slots and detect changes
  processSlots();

  // Timeout mode if idle too long
  if (gateMode != MODE_IDLE && (millis() - modeSinceMillis) > ENTRY_EXIT_WINDOW_MS) {
    Serial.println("Mode timed out, back to IDLE");
    gateMode = MODE_IDLE;
    sendGateMode(gateMode, "");
  }

  // Periodic status snapshot
  static unsigned long lastStatusUpdate = 0;
  if (millis() - lastStatusUpdate > 60000UL) {
    sendStatusUpdate();
    lastStatusUpdate = millis();
  }

  delay(100); // pacing
}

// ===================== RFID =====================
void checkRFID() {
  if (!mfrc522.PICC_IsNewCardPresent() || !mfrc522.PICC_ReadCardSerial()) return;

  // Debounce
  if (millis() - lastRFIDMillis < RFID_DEBOUNCE_MS) {
    mfrc522.PICC_HaltA();
    return;
  }
  lastRFIDMillis = millis();

  // Read UID
  String cardUID = "";
  for (byte i = 0; i < mfrc522.uid.size; i++) {
    if (mfrc522.uid.uidByte[i] < 0x10) cardUID += "0";
    cardUID += String(mfrc522.uid.uidByte[i], HEX);
  }
  cardUID.toUpperCase();
  lastRFID = cardUID;
  Serial.println("RFID: " + cardUID);
  buzz(200);
  // Push to server
  if (client.available()) {
    DynamicJsonDocument doc(256);
    doc["type"]            = "rfid_scan";
    doc["timestamp"]       = millis();
    doc["card_uid"]        = cardUID;
    doc["available_spaces"]= availableSpaces;
    String msg;
    serializeJson(doc, msg);
    client.send(msg);
  }

  // Entry/Exit handling
  handleVehicleEntryExit(cardUID);
  mfrc522.PICC_HaltA();
}

void handleVehicleEntryExit(String cardUID) {
  int freeSlots = 0;
  for (int i = 0; i < TOTAL_SPACES; i++) if (slotStatuses[i] == 0) freeSlots++;

  if (freeSlots > 0) {
    gateMode = MODE_ENTRY_AUTH;
  } else {
    gateMode = MODE_EXIT_AUTH;
  }
  modeSinceMillis = millis();

  openBarrier();
  digitalWrite(LED_GREEN, HIGH);
  sendGateMode(gateMode, cardUID);
}

// ===================== Barrier =====================
void openBarrier() {
  if (!barrierOpen) {
    for (int pos = 0; pos <= 130; pos += 2) {
      barrierServo.write(pos);
      delay(5);
    }
    barrierOpen = true;
    barrierOpenTime = millis();
    Serial.println("Barrier OPENED");
  }
}

void closeBarrier() {
  if (barrierOpen) {
    for (int pos = 130; pos >= 0; pos -= 2) {
      barrierServo.write(pos);
      delay(5);
    }
    barrierOpen = false;
    digitalWrite(LED_GREEN, LOW);
    Serial.println("Barrier CLOSED");
  }
}

void handleBarrier() {
  if (barrierOpen && (millis() - barrierOpenTime) > BARRIER_OPEN_TIME) {
    closeBarrier();
  }
}

// ===================== Sensors =====================
int readSlotDistance(int echoPin) {
  if (echoPin < 0) return 0;
  digitalWrite(TRIGGER_PIN, LOW);
  delayMicroseconds(2);
  digitalWrite(TRIGGER_PIN, HIGH);
  delayMicroseconds(10);
  digitalWrite(TRIGGER_PIN, LOW);

  long duration = pulseIn(echoPin, HIGH, 25000);
  if (duration == 0) return 0; // no echo

  return (int)(duration * 0.034 / 2); // cm
}

void processSlots() {
  int distances[TOTAL_SPACES] = {0};
  if (TOTAL_SPACES >= 1 && ECHO_PIN_1 >= 0) distances[0] = readSlotDistance(ECHO_PIN_1);
  if (TOTAL_SPACES >= 2 && ECHO_PIN_2 >= 0) distances[1] = readSlotDistance(ECHO_PIN_2);
  if (TOTAL_SPACES >= 3 && ECHO_PIN_3 >= 0) distances[2] = readSlotDistance(ECHO_PIN_3);

  int newAvailable = 0;
  bool anyTransition = false;
  int firstTransitionSlot = -1;
  int transitionType = 0; // +1 entry, -1 exit

  for (int i = 0; i < TOTAL_SPACES; i++) {
    slotDistances[i] = distances[i];
    int occ = (distances[i] > 0 && distances[i] < 5) ? 1 : 0;

    prevSlotStatuses[i] = slotStatuses[i];
    if (occ != slotStatuses[i]) {
      slotStatuses[i] = occ;

      if (!anyTransition) {
        anyTransition = true;
        firstTransitionSlot = i;
        transitionType = (prevSlotStatuses[i] == 0 && occ == 1) ? +1 : -1;
      }

      sendParkingSpaceStatus(slotStatuses[i], i + 1, distances[i]);
    }

    if (occ == 0) newAvailable++;
  }
  availableSpaces = newAvailable;

  // Interpret transition if gate armed
  if (anyTransition && gateMode != MODE_IDLE && firstTransitionSlot >= 0) {
    if (gateMode == MODE_ENTRY_AUTH && transitionType == +1) {
      totalVehiclesEntered++;
      if (lastRFID.length()) slotUID[firstTransitionSlot] = lastRFID;
      sendVehicleEvent("entry", firstTransitionSlot + 1, slotUID[firstTransitionSlot]);
      closeBarrier();
      gateMode = MODE_IDLE;
      sendGateMode(gateMode, "");
    } else if (gateMode == MODE_EXIT_AUTH && transitionType == -1) {
      totalVehiclesExited++;
      slotUID[firstTransitionSlot] = "";
      sendVehicleEvent("exit", firstTransitionSlot + 1, lastRFID);
      closeBarrier();
      gateMode = MODE_IDLE;
      sendGateMode(gateMode, "");
    }
  }
}

// ===================== WebSocket Callbacks =====================
void onMessage(websockets::WebsocketsMessage message) {
  Serial.print("WS Received: ");
  Serial.println(message.data());

  DynamicJsonDocument doc(512);
  if (deserializeJson(doc, message.data())) return;

  String command = doc["command"] | "";
  if (command == "open_barrier") openBarrier();
  else if (command == "close_barrier") closeBarrier();
  else if (command == "get_status") sendStatusUpdate();
  else if (command == "reset_counters") {
    totalVehiclesEntered = 0;
    totalVehiclesExited = 0;
    Serial.println("Counters reset");
  }

  String mode = doc["mode"] | "";
  if (mode == "entry_auth") {
    gateMode = MODE_ENTRY_AUTH;
    modeSinceMillis = millis();
    openBarrier();
    sendGateMode(gateMode, "");
  } else if (mode == "exit_auth") {
    gateMode = MODE_EXIT_AUTH;
    modeSinceMillis = millis();
    openBarrier();
    sendGateMode(gateMode, "");
  } else if (mode == "idle") {
    gateMode = MODE_IDLE;
    sendGateMode(gateMode, "");
  }
}

void onEvents(websockets::WebsocketsEvent event, String data) {
  if (event == websockets::WebsocketsEvent::ConnectionOpened) {
    Serial.println("WS Connected");
    sendStatusUpdate();
  } else if (event == websockets::WebsocketsEvent::ConnectionClosed) {
    Serial.println("WS Closed");
  }
}

// ===================== WiFi =====================
void setup_wifi() {
  Serial.printf("Connecting to %s\n", ssid);
  WiFi.begin(ssid, password);

  int attempts = 0;
  while (WiFi.status() != WL_CONNECTED && attempts < 30) {
    delay(500);
    Serial.print(".");
    attempts++;
  }

  if (WiFi.status() == WL_CONNECTED) {
    Serial.println("\nWiFi connected");
    Serial.print("IP: ");
    Serial.println(WiFi.localIP());
  } else {
    Serial.println("\nWiFi failed");
  }
}

// ===================== WebSocket Senders =====================
void sendParkingSpaceStatus(int status, int slotNumber, int distance) {
  if (!client.available()) return;
  DynamicJsonDocument doc(256);
  doc["type"] = "parking_status_update";
  doc["slot"] = slotNumber;
  doc["occupied"] = (status == 1);
  doc["distance_cm"] = distance;
  doc["timestamp"] = millis();
  String message;
  serializeJson(doc, message);
  client.send(message);
}

void sendStatusUpdate() {
  if (!client.available()) return;
  DynamicJsonDocument doc(1024);
  doc["type"] = "status_update";
  doc["timestamp"] = millis();
  doc["available_spaces"] = availableSpaces;
  doc["total_spaces"] = TOTAL_SPACES;
  doc["total_entries"] = totalVehiclesEntered;
  doc["total_exits"] = totalVehiclesExited;
  doc["barrier_open"] = barrierOpen;
  doc["wifi_connected"] = (WiFi.status() == WL_CONNECTED);
  doc["uptime"] = millis() / 1000;

  JsonArray slots = doc.createNestedArray("slots");
  for (int i = 0; i < TOTAL_SPACES; i++) {
    JsonObject slot = slots.createNestedObject();
    slot["slot"] = i + 1;
    slot["occupied"] = (slotStatuses[i] == 1);
    slot["distance_cm"] = slotDistances[i];
    if (slotUID[i].length()) slot["card_uid"] = slotUID[i];
  }

  String message;
  serializeJson(doc, message);
  client.send(message);
}

void sendVehicleEvent(const char* action, int slotNumber, String uid) {
  if (!client.available()) return;
  DynamicJsonDocument doc(256);
  doc["type"] = "vehicle_event";
  doc["action"] = action;
  doc["slot"] = slotNumber;
  if (uid.length()) doc["card_uid"] = uid;
  doc["timestamp"] = millis();
  String message;
  serializeJson(doc, message);
  client.send(message);
}

void sendGateMode(GateMode mode, String uid) {
  if (!client.available()) return;
  DynamicJsonDocument doc(256);
  doc["type"] = "gate_mode";
  doc["mode"] = (mode == MODE_ENTRY_AUTH) ? "entry_auth" :
                (mode == MODE_EXIT_AUTH) ? "exit_auth" : "idle";
  if (uid.length()) doc["card_uid"] = uid;
  doc["timestamp"] = millis();
  String message;
  serializeJson(doc, message);
  client.send(message);
}
