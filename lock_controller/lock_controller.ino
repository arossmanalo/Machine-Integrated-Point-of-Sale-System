// Machine controller - ESP32 on the shop Wi-Fi.
// Starting a machine sends it a train of pulses, the way a coin slot does: N pulses of ON_MS,
// each followed by OFF_MS. The POS asks for a one-time challenge, signs
// "S<n>:<count>:<onMs>:<offMs>:<challenge>" with the shared lock key (HMAC-SHA256) and posts it
// to /start. A phone on the same Wi-Fi cannot start a machine without the key, and a recorded
// request cannot be replayed. The contract is in src/machines/protocol.ts; keep the two in step.
//
// Board: ESP32 DevKit with an ESP32-WROOM-32 / -32D / -32E module, Arduino core for ESP32
// 4.0 or newer (Tools > Board > esp32 > ESP32 Dev Module). Not WROVER: it uses GPIO 16 and 17
// for its extra memory, and those are channels 13 and 14 here.
// Outputs avoid the boot-strapping pins (0, 2, 5, 12, 15), GPIO 14 (it pulses during boot,
// which could start a machine at power-on), the flash pins (6-11), the USB serial pins (1, 3)
// and the input-only pins (34-39). That leaves exactly these 14.
//
// Wiring per LED (prototype): GPIO -> 220 ohm resistor -> LED long leg (+), short leg (-) -> GND.
// With ACTIVE_LEVEL = HIGH the LED is off while idle and lights only during each pulse.
// Real machines: the GPIO drives a relay or optocoupler on the machine's coin input, never the
// machine directly. Check what level that module switches on before setting ACTIVE_LEVEL.
//
// Setup: copy config.example.h to config.h, fill it in, then upload.
// The address to enter in the app is printed on the serial monitor (115200 baud) at start.
// Set STATIC_IP in config.h so that address never changes.

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
// The level an output takes during a pulse. HIGH lights the prototype LED and drives most relay
// and optocoupler modules; an active-LOW module needs LOW here.
const int ACTIVE_LEVEL = HIGH;
const int IDLE_LEVEL = ACTIVE_LEVEL == HIGH ? LOW : HIGH;
// Limits for one start. Keep in step with PULSE_LIMITS in src/machines/protocol.ts.
const long MAX_PULSES = 50;
const long MIN_PULSE_MS = 20;
const long MAX_PULSE_MS = 5000;
const unsigned long CHALLENGE_TTL_MS = 10000;

struct Train {
  long remaining;            // pulses still to send, counting the one in progress
  long onMs;
  long offMs;
  bool high;                 // true while a pulse is on
  unsigned long nextAt;      // when the output changes next
};

WebServer server(80);
Train trains[NUM_CHANNELS];
char challenge[33] = "";                            // empty = no challenge outstanding
unsigned long challengeIssuedAt = 0;
char lastAccepted[33] = "";                         // the challenge of the last start carried out

void setup() {
  Serial.begin(115200);
  for (int i = 0; i < NUM_CHANNELS; i++) {
    // Set the level before switching to output, so no machine sees a pulse at boot.
    digitalWrite(LOCK_PINS[i], IDLE_LEVEL);
    pinMode(LOCK_PINS[i], OUTPUT);
    trains[i].remaining = 0;
  }

  WiFi.onEvent([](WiFiEvent_t, WiFiEventInfo_t) {
    Serial.print("READY ");
    Serial.println(WiFi.localIP());
  }, ARDUINO_EVENT_WIFI_STA_GOT_IP);
  WiFi.mode(WIFI_STA);
#ifdef STATIC_IP
  // A fixed address, so the one saved in the app stays right after the router restarts.
  IPAddress ip, gateway, subnet;
  if (ip.fromString(STATIC_IP) && gateway.fromString(STATIC_GATEWAY) && subnet.fromString(STATIC_SUBNET)) {
    WiFi.config(ip, gateway, subnet, gateway);
  } else {
    Serial.println("ERR bad STATIC_IP, STATIC_GATEWAY or STATIC_SUBNET in config.h; using the router's address");
  }
#endif
  // Power saving makes the radio nap between beacons, so requests from the tablet were
  // sometimes answered late or dropped. The board runs from a charger, so stay awake.
  WiFi.setSleep(false);
  WiFi.setHostname("laundry-locks");
  WiFi.setAutoReconnect(true);
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);

  server.on("/status", HTTP_GET, handleStatus);
  server.on("/challenge", HTTP_GET, handleChallenge);
  server.on("/start", HTTP_POST, handleStart);
  server.onNotFound([]() { server.send(404, "application/json", "{\"ok\":false}"); });
  server.begin();
}

void loop() {
  server.handleClient();

  // Non-blocking, so several machines can receive their pulses at the same time.
  unsigned long now = millis();
  for (int i = 0; i < NUM_CHANNELS; i++) {
    Train& t = trains[i];
    if (t.remaining == 0 || (long)(now - t.nextAt) < 0) continue;
    if (t.high) {
      digitalWrite(LOCK_PINS[i], IDLE_LEVEL);
      t.high = false;
      t.remaining -= 1;
      t.nextAt = now + t.offMs;
      if (t.remaining == 0) {
        Serial.print("DONE ");
        Serial.println(i + 1);
      }
    } else {
      digitalWrite(LOCK_PINS[i], ACTIVE_LEVEL);
      t.high = true;
      t.nextAt = now + t.onMs;
    }
  }
}

void handleStatus() {
  String busy = "";
  for (int i = 0; i < NUM_CHANNELS; i++) {
    if (trains[i].remaining == 0) continue;
    if (busy.length() > 0) busy += ",";
    busy += String(i + 1);
  }
  server.send(200, "application/json",
              String("{\"device\":\"laundry-locks\",\"channels\":") + NUM_CHANNELS + ",\"busy\":[" + busy +
                  "],\"lastAccepted\":\"" + lastAccepted + "\"}");
}

void handleChallenge() {
  uint8_t bytes[16];
  esp_fill_random(bytes, sizeof(bytes));
  toHex(bytes, sizeof(bytes), challenge);
  challengeIssuedAt = millis();
  server.send(200, "application/json", String("{\"challenge\":\"") + challenge + "\"}");
}

void handleStart() {
  String sentChallenge = server.arg("challenge");
  String signature = server.arg("signature");
  long channel = server.arg("channel").toInt();
  long count = server.arg("pulses").toInt();
  long onMs = server.arg("onMs").toInt();
  long offMs = server.arg("offMs").toInt();

  // Every attempt uses up the challenge, right or wrong, so nothing can be replayed or guessed.
  bool fresh = challenge[0] != '\0' && sentChallenge.equals(challenge) &&
               millis() - challengeIssuedAt < CHALLENGE_TTL_MS;
  challenge[0] = '\0';
  if (!fresh) return fail(409, "stale-challenge");

  char expected[65];
  String message = String("S") + channel + ":" + count + ":" + onMs + ":" + offMs + ":" + sentChallenge;
  sign(message, expected);
  if (!sameText(signature, expected)) return fail(401, "bad-signature");
  if (channel < 1 || channel > NUM_CHANNELS) return fail(400, "bad-channel");
  if (count < 1 || count > MAX_PULSES || onMs < MIN_PULSE_MS || onMs > MAX_PULSE_MS ||
      offMs < MIN_PULSE_MS || offMs > MAX_PULSE_MS) {
    return fail(400, "bad-pulses");
  }

  Train& t = trains[channel - 1];
  if (t.remaining > 0) return fail(409, "busy");
  t.remaining = count;
  t.onMs = onMs;
  t.offMs = offMs;
  t.high = false;
  t.nextAt = millis();
  sentChallenge.toCharArray(lastAccepted, sizeof(lastAccepted));
  server.send(200, "application/json", String("{\"ok\":true,\"channel\":") + channel + "}");
  Serial.print("START ");
  Serial.print(channel);
  Serial.print(" ");
  Serial.print(count);
  Serial.print("x ");
  Serial.print(onMs);
  Serial.print("/");
  Serial.println(offMs);
}

void fail(int status, const char* error) {
  server.send(status, "application/json", String("{\"ok\":false,\"error\":\"") + error + "\"}");
  Serial.print("ERR ");
  Serial.println(error);
}

// HMAC-SHA256, lowercase hex. Must match signStart in src/machines/protocol.ts.
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
