#include <SPI.h>
#include <Adafruit_GFX.h>
#include <Adafruit_ST7735.h>
#include <MFRC522.h>
#include <ESP8266WiFi.h> // Include for ESP8266 pin definitions

// --- TFT Display Pin Definitions ---
// Using NodeMCU D-pin to GPIO mapping: D0=16, D1=5, D2=4, D3=0, D4=2, D5=14, D6=12, D7=13, D8=15
#define TFT_CS      15  // Chip select (D8)
#define TFT_RST     0   // Reset (D3) - Can be shared with RFID RST
#define TFT_DC      2   // Data/Command (D4)

// --- RFID Pin Definitions ---
// Using the same SPI bus as the TFT display.
#define RFID_SS_PIN 5   // SDA/CS (D1) - Using a dedicated pin for SS
#define RFID_RST_PIN 0  // Reset (D3) - Shared with TFT_RST

// --- TFT Display Colors ---
#define BLACK   0x0000
#define RED     0xF800
#define GREEN   0x07E0
#define BLUE    0x001F
#define CYAN    0x07FF
#define WHITE   0xFFFF
#define YELLOW  0xFFE0

// --- Authorized RFID UIDs (Example UIDs) ---
// You can replace these with your own card UIDs.
byte authorizedUIDs[][4] = {
  {0xBD, 0x31, 0x15, 0x2B}, // Card 1 (Admin)
  {0x12, 0x34, 0x56, 0x78}, // Card 2 (User 1)
  {0xAB, 0xCD, 0xEF, 0x90}, // Card 3 (User 2)
  {0x11, 0x22, 0x33, 0x44}  // Card 4 (User 3)
};
const int numAuthorizedUIDs = sizeof(authorizedUIDs) / sizeof(authorizedUIDs[0]);

// --- Object Initializations ---
// TFT object
Adafruit_ST7735 tft = Adafruit_ST7735(TFT_CS, TFT_DC, TFT_RST);

// RFID object
MFRC522 mfrc522(RFID_SS_PIN, RFID_RST_PIN);

void setup() {
  // Initialize Serial Monitor
  Serial.begin(115200);
  Serial.println("Starting RFID and TFT Test...");

  // Initialize SPI bus
  // SPI.begin() is automatically called by TFT and RFID libraries in setup, but
  // it's good practice to call it explicitly if needed.
  SPI.begin();
  
  // Initialize TFT Display
  tft.initR(INITR_BLACKTAB); // Init ST7735S chip, black tab
  tft.setRotation(1); // Set to landscape mode
  tft.fillScreen(BLACK);
  
  // Display initial TFT message
  tft.setCursor(5, 5);
  tft.setTextColor(CYAN);
  tft.setTextSize(2);
  tft.println("RFID & TFT");
  tft.println("Test");
  tft.setTextSize(1);
  tft.setTextColor(WHITE);
  tft.println("Initializing...");
  
  // Initialize RFID reader
  mfrc522.PCD_Init();
  
  // Display status on Serial and TFT
  Serial.println("MFRC522 RFID reader initialized.");
  tft.setCursor(5, 50);
  tft.setTextColor(GREEN);
  tft.println("RFID OK!");
  
  // Show instructions
  tft.setCursor(5, 70);
  tft.setTextColor(WHITE);
  tft.println("Present a card...");
}

void loop() {
  // --- Step 1: Look for new cards ---
  // If no card is present, exit the loop
  if (!mfrc522.PICC_IsNewCardPresent()) {
    return;
  }
  
  // --- Step 2: Select one of the cards ---
  // If no card is selected, exit the loop
  if (!mfrc522.PICC_ReadCardSerial()) {
    return;
  }
  
  // --- Step 3: Read and display the UID ---
  Serial.print("Card detected! UID: ");
  
  // Clear the status area on the TFT
  tft.fillRect(0, 100, tft.width(), tft.height() - 100, BLACK);
  tft.setCursor(5, 100);
  tft.setTextSize(1);
  tft.setTextColor(WHITE);
  tft.println("UID:");
  
  // Print UID to Serial and TFT
  String uidString = "";
  for (byte i = 0; i < mfrc522.uid.size; i++) {
    if (mfrc522.uid.uidByte[i] < 0x10) {
      Serial.print("0");
      tft.print("0");
    }
    Serial.print(mfrc522.uid.uidByte[i], HEX);
    tft.print(mfrc522.uid.uidByte[i], HEX);
    if (i < mfrc522.uid.size - 1) {
      Serial.print(" ");
      tft.print(" ");
    }
  }
  Serial.println();
  tft.println();
  
  // --- Step 4: Check if the scanned UID is authorized ---
  bool accessGranted = false;
  for (int i = 0; i < numAuthorizedUIDs; i++) {
    if (mfrc522.uid.size == sizeof(authorizedUIDs[i])) {
      if (memcmp(mfrc522.uid.uidByte, authorizedUIDs[i], mfrc522.uid.size) == 0) {
        accessGranted = true;
        break;
      }
    }
  }
  
  // --- Step 5: Display access status on TFT and Serial ---
  tft.setCursor(5, 130);
  tft.setTextSize(2);
  if (accessGranted) {
    tft.setTextColor(GREEN);
    tft.println("ACCESS");
    tft.setCursor(5, 145);
    tft.println("GRANTED");
    Serial.println("Access granted!");
  } else {
    tft.setTextColor(RED);
    tft.println("ACCESS");
    tft.setCursor(5, 145);
    tft.println("DENIED");
    Serial.println("Access denied!");
  }
  
  // --- Step 6: Halt PICC and stop encryption ---
  mfrc522.PICC_HaltA();
  mfrc522.PCD_StopCrypto1();
  
  // Wait before the next scan to prevent rapid re-reads
  Serial.println("Wait for 5 seconds for next scan...");
  
  tft.setCursor(5, 85);
  tft.setTextColor(WHITE);
  tft.setTextSize(1);
  tft.print("Next scan in: ");
  for (int i = 5; i > 0; i--) {
    tft.setCursor(95, 85);
    tft.fillRect(95, 85, 30, 10, BLACK); // Clear old number
    tft.print(i);
    delay(1000);
  }
  
  // Clear the display for the next scan
  tft.fillRect(0, 85, tft.width(), tft.height() - 85, BLACK);
  tft.setCursor(5, 70);
  tft.setTextColor(WHITE);
  tft.println("Present a card...");
}
