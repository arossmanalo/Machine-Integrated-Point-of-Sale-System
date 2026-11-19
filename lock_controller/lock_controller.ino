// Lock controller - ESP32 on the shop Wi-Fi.
// The POS asks for a one-time challenge, signs "P<n>:<challenge>" with the shared lock key
// (HMAC-SHA256) and posts it to /pulse. Only then does output n pulse. A phone on the same
// Wi-Fi cannot open a door without the key, and a recorded request cannot be replayed.
// The contract is in src/machines/protocol.ts; keep the two in step.
//
// Board: ESP32 DevKit (ESP32-WROOM-32 or -WROVER), Arduino core for ESP32 4.0 or newer
// (Tools > Board > esp32 > ESP32 Dev Module).
// Outputs avoid the boot-strapping pins (0, 2, 5, 12, 15), the flash pins (6-11),
// the input-only pins (34-39) and the WROVER PSRAM pins (16, 17).
//
// Wiring per LED (prototype): GPIO -> 220 ohm resistor -> LED long leg (+), short leg (-) -> GND.
// Real locks: GPIO drives a relay or MOSFET module, never the 12 V solenoid directly.
//
// Setup: copy config.example.h to config.h, fill it in, then upload.
// The address to enter in the app is printed on the serial monitor (115200 baud) at start.

#include <WiFi.h>
#include <WebServer.h>
#include <esp_random.h>
#include <HMACBuilder.h>
#include <SHA2Builder.h>

#include "config.h"

const int LOCK_PINS[] = {25, 26, 27, 32, 33, 13};  // channel 1..6
const int NUM_CHANNELS = sizeof(LOCK_PINS) / sizeof(LOCK_PINS[0]);
const unsigned long PULSE_MS = 500;                // LEDs; about 3000-5000 for real locks
const unsigned long CHALLENGE_TTL_MS = 10000;

WebServer server(80);
unsigned long offAt[NUM_CHANNELS];                  // 0 = output idle
char challenge[33] = "";                            // empty = no challenge outstanding
unsigned long challengeIssuedAt = 0;

void setup() {
  Serial.begin(115200);
  for (int i = 0; i < NUM_CHANNELS; i++) {
    pinMode(LOCK_PINS[i], OUTPUT);
    digitalWrite(LOCK_PINS[i], LOW);
    offAt[i] = 0;
  }

  WiFi.onEvent([](WiFiEvent_t, WiFiEventInfo_t) {
    Serial.print("READY ");
    Serial.println(WiFi.localIP());
  }, ARDUINO_EVENT_WIFI_STA_GOT_IP);
  WiFi.mode(WIFI_STA);
  WiFi.setHostname("laundry-locks");
  WiFi.setAutoReconnect(true);
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);

  server.on("/status", HTTP_GET, handleStatus);
  server.on("/challenge", HTTP_GET, handleChallenge);
  server.on("/pulse", HTTP_POST, handlePulse);
  server.onNotFound([]() { server.send(404, "application/json", "{\"ok\":false}"); });
  server.begin();
}

void loop() {
  server.handleClient();

  // Non-blocking, so several doors can be open at the same time.
  unsigned long now = millis();
  for (int i = 0; i < NUM_CHANNELS; i++) {
    if (offAt[i] != 0 && (long)(now - offAt[i]) >= 0) {
      digitalWrite(LOCK_PINS[i], LOW);
      offAt[i] = 0;
    }
  }
}

void handleStatus() {
  server.send(200, "application/json",
              String("{\"device\":\"laundry-locks\",\"channels\":") + NUM_CHANNELS + "}");
}

void handleChallenge() {
  uint8_t bytes[16];
  esp_fill_random(bytes, sizeof(bytes));
  toHex(bytes, sizeof(bytes), challenge);
  challengeIssuedAt = millis();
  server.send(200, "application/json", String("{\"challenge\":\"") + challenge + "\"}");
}

void handlePulse() {
  String sentChallenge = server.arg("challenge");
  String signature = server.arg("signature");
  long channel = server.arg("channel").toInt();

  // Every attempt uses up the challenge, right or wrong, so nothing can be replayed or guessed.
  bool fresh = challenge[0] != '\0' && sentChallenge.equals(challenge) &&
               millis() - challengeIssuedAt < CHALLENGE_TTL_MS;
  challenge[0] = '\0';
  if (!fresh) return fail(409, "stale-challenge");

  char expected[65];
  String message = String("P") + channel + ":" + sentChallenge;
  sign(message, expected);
  if (!sameText(signature, expected)) return fail(401, "bad-signature");
  if (channel < 1 || channel > NUM_CHANNELS) return fail(400, "bad-channel");

  int i = channel - 1;
  digitalWrite(LOCK_PINS[i], HIGH);
  offAt[i] = millis() + PULSE_MS;
  if (offAt[i] == 0) offAt[i] = 1;  // 0 means idle
  server.send(200, "application/json", String("{\"ok\":true,\"channel\":") + channel + "}");
  Serial.print("OK P");
  Serial.println(channel);
}

void fail(int status, const char* error) {
  server.send(status, "application/json", String("{\"ok\":false,\"error\":\"") + error + "\"}");
  Serial.print("ERR ");
  Serial.println(error);
}

// HMAC-SHA256, lowercase hex. Must match signPulse in src/machines/protocol.ts.
void sign(const String& message, char* hexOut) {
  SHA256Builder sha256;
  HMACBuilder hmac(&sha256);
  hmac.setKey(LOCK_KEY);
  hmac.begin();
  hmac.add(message);
  hmac.calculate();
  hmac.getChars(hexOut);
}

void toHex(const uint8_t* bytes, size_t length, char* out) {
  const char* digits = "0123456789abcdef";
  for (size_t i = 0; i < length; i++) {
    out[i * 2] = digits[bytes[i] >> 4];
    out[i * 2 + 1] = digits[bytes[i] & 0x0f];
  }
  out[length * 2] = '\0';
}

// Compares in constant time so the reply time does not leak how much of a guess was right.
bool sameText(const String& given, const char* expected) {
  size_t length = strlen(expected);
  if (given.length() != length) return false;
  uint8_t difference = 0;
  for (size_t i = 0; i < length; i++) difference |= given[i] ^ expected[i];
  return difference == 0;
}
