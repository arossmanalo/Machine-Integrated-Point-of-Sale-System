// Lock controller - ESP32 on the shop Wi-Fi.
// The POS asks for a one-time challenge, signs "P<n>:<challenge>" with the shared lock key
// (HMAC-SHA256) and posts it to /pulse. Only then does output n pulse. A phone on the same
// Wi-Fi cannot open a door without the key, and a recorded request cannot be replayed.
// The contract is in src/machines/protocol.ts; keep the two in step.
//
// Board: ESP32 DevKit with an ESP32-WROOM-32 / -32D / -32E module, Arduino core for ESP32
// 4.0 or newer (Tools > Board > esp32 > ESP32 Dev Module). Not WROVER: it uses GPIO 16 and 17
// for its extra memory, and those are channels 13 and 14 here.
// Outputs avoid the boot-strapping pins (0, 2, 5, 12, 15), GPIO 14 (it pulses during boot,
// which could open a door at power-on), the flash pins (6-11), the USB serial pins (1, 3)
// and the input-only pins (34-39). That leaves exactly these 14.
//
// Wiring per LED (prototype): GPIO -> 220 ohm resistor -> LED long leg (+), short leg (-) -> GND.
// With LOCKED_LEVEL = HIGH the LED is lit while the door is locked and goes dark while unlocked.
// Real locks: GPIO drives a relay or MOSFET module, never the 12 V solenoid directly. Set
// LOCKED_LEVEL so the relay is OFF when locked; check the relay module before connecting it.
//
// Setup: copy config.example.h to config.h, fill it in, then upload.
// The address to enter in the app is printed on the serial monitor (115200 baud) at start.

#include <WiFi.h>
#include <WebServer.h>
#include <esp_random.h>
#include <HMACBuilder.h>
#include <SHA2Builder.h>

#include "config.h"

// Channel n uses LOCK_PINS[n - 1]. Board labels: D25 D26 D27 D32 D33 D13 D18 D19 D21 D22 D23 D4
// RX2 TX2. Keep in step with LOCK_CHANNEL_TERMINALS in src/machines/protocol.ts.
const int LOCK_PINS[] = {25, 26, 27, 32, 33, 13, 18, 19, 21, 22, 23, 4, 16, 17};
const int NUM_CHANNELS = sizeof(LOCK_PINS) / sizeof(LOCK_PINS[0]);
// The level an output sits at while its door is locked; an unlock flips it for PULSE_MS.
// HIGH suits the LED prototype (lit = locked) and active-LOW relay modules. A relay module that
// switches on with HIGH needs LOW here, or every door would stay unlocked.
const int LOCKED_LEVEL = HIGH;
const int UNLOCKED_LEVEL = LOCKED_LEVEL == HIGH ? LOW : HIGH;
const unsigned long PULSE_MS = 2000;               // long enough to see on an LED; 3000-5000 for locks
const unsigned long CHALLENGE_TTL_MS = 10000;

WebServer server(80);
unsigned long relockAt[NUM_CHANNELS];               // 0 = locked
char challenge[33] = "";                            // empty = no challenge outstanding
unsigned long challengeIssuedAt = 0;

void setup() {
  Serial.begin(115200);
  for (int i = 0; i < NUM_CHANNELS; i++) {
    // Set the level before switching to output, so the pin never shows "unlocked" at boot.
    digitalWrite(LOCK_PINS[i], LOCKED_LEVEL);
    pinMode(LOCK_PINS[i], OUTPUT);
    relockAt[i] = 0;
  }

  WiFi.onEvent([](WiFiEvent_t, WiFiEventInfo_t) {
    Serial.print("READY ");
    Serial.println(WiFi.localIP());
  }, ARDUINO_EVENT_WIFI_STA_GOT_IP);
  WiFi.mode(WIFI_STA);
  // Power saving makes the radio nap between beacons, so requests from the tablet were
  // sometimes answered late or dropped. The board runs from a charger, so stay awake.
  WiFi.setSleep(false);
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
    if (relockAt[i] != 0 && (long)(now - relockAt[i]) >= 0) {
      digitalWrite(LOCK_PINS[i], LOCKED_LEVEL);
      relockAt[i] = 0;
    }
  }
}

void handleStatus() {
  server.send(200, "application/json",
              String("{\"device\":\"laundry-locks\",\"channels\":") + NUM_CHANNELS +
                  ",\"pulseMs\":" + PULSE_MS + "}");
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
  digitalWrite(LOCK_PINS[i], UNLOCKED_LEVEL);
  relockAt[i] = millis() + PULSE_MS;
  if (relockAt[i] == 0) relockAt[i] = 1;  // 0 means locked
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
