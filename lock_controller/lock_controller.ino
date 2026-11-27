// Machine controller - ESP32 on the shop Wi-Fi.
// Starting a machine sends it a train of pulses, the way a coin slot does: N pulses of ON_MS,
// each followed by OFF_MS. The POS asks for a one-time challenge, signs
// "S<n>:<count>:<onMs>:<offMs>:<challenge>" with the shared lock key (HMAC-SHA256) and posts it
// to /start. A phone on the same Wi-Fi cannot start a machine without the key, and a recorded
// request cannot be replayed. The contract is in src/machines/protocol.ts; keep the two in step.
//
// Board: ESP32-S3 DevKitC-1 style board with an ESP32-S3-WROOM-1 module (N16R8 here), on a
// screw-terminal base. Arduino core for ESP32 4.0 or newer (Tools > Board > esp32 > ESP32S3 Dev
// Module). Upload and read serial through the USB-C port wired to the USB-serial chip ("UART"),
// or turn on Tools > USB CDC On Boot to use the other port.
// Outputs avoid the boot-strapping pins (0, 3, 45, 46), the native USB pins (19, 20), the serial
// pins (43, 44 = RX/TX), the flash pins (26-32), the octal PSRAM pins of R8 modules (35-37) and
// 38 and 48, one of which drives the board's RGB LED. Of the 23 pins left, 22 make 11 machine
// channels (an output and an input each) and GPIO 4 is the link light.
//
// Inputs: each machine's "running" signal. The ESP32-S3 pins take 3.3 V at most: a 5 V signal
// must go through a voltage divider (signal - 10k - pin - 20k - GND) or an optocoupler, never
// straight to the pin. With the divider the input is active HIGH; with an optocoupler pulling the
// pin to GND, set INPUT_ACTIVE_LEVEL to LOW. An unwired input reads as not running.
//
// Link light (GPIO 4): off without Wi-Fi, blinking on Wi-Fi when the app has not checked in for
// APP_SEEN_TIMEOUT_MS, steady when both are fine.
//
// Wiring per LED (outputs and the link light, prototype): GPIO -> 220 ohm resistor -> LED long
// leg (+), short leg (-) -> GND.
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

#if !CONFIG_IDF_TARGET_ESP32S3
#error "This pin list is for the ESP32-S3. Pick Tools > Board > ESP32S3 Dev Module."
#endif

// Channel n sends its start pulses on OUTPUT_PINS[n - 1] and reads its running signal on
// INPUT_PINS[n - 1]: neighbouring terminals, output above input with the USB ports at the top.
// Right strip: 14/13, 12/11, 10/9, 8/18, 17/16, 15/7, 6/5, then the link light on 4.
// Left strip: 21/47, 39/40, 41/42, 2/1.
// Keep in step with MACHINE_CHANNEL_TERMINALS in src/machines/protocol.ts.
const int OUTPUT_PINS[] = {14, 12, 10, 8, 17, 15, 6, 21, 39, 41, 2};
const int INPUT_PINS[] = {13, 11, 9, 18, 16, 7, 5, 47, 40, 42, 1};
const int NUM_CHANNELS = sizeof(OUTPUT_PINS) / sizeof(OUTPUT_PINS[0]);
const int LINK_LED_PIN = 4;
const int LINK_LED_ON = HIGH;
const unsigned long LINK_BLINK_MS = 500;
// The app checks in every few seconds (every 20 s with real-time sync off), so this is safely longer.
const unsigned long APP_SEEN_TIMEOUT_MS = 45000;
// The level a machine's input has while it runs.
const int INPUT_ACTIVE_LEVEL = HIGH;
// A running signal counts once it holds this long; a stop only after this long, so a short dip
// between wash phases does not end the run.
const unsigned long INPUT_ON_MS = 500;
const unsigned long INPUT_OFF_MS = 10000;
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

struct Input {
  bool raw;                  // the level read last, active or not
  unsigned long rawSince;    // when the raw level last changed
  bool running;              // the level after the hold times
  unsigned long runningSince;
};

WebServer server(80);
Train trains[NUM_CHANNELS];
Input inputs[NUM_CHANNELS];
bool appSeen = false;
unsigned long appSeenAt = 0;                        // when the app last asked for /status
char challenge[33] = "";                            // empty = no challenge outstanding
unsigned long challengeIssuedAt = 0;
char lastAccepted[33] = "";                         // the challenge of the last start carried out

void setup() {
  Serial.begin(115200);
  for (int i = 0; i < NUM_CHANNELS; i++) {
    // Set the level before switching to output, so no machine sees a pulse at boot.
    digitalWrite(OUTPUT_PINS[i], IDLE_LEVEL);
    pinMode(OUTPUT_PINS[i], OUTPUT);
    trains[i].remaining = 0;
    pinMode(INPUT_PINS[i], INPUT_ACTIVE_LEVEL == HIGH ? INPUT_PULLDOWN : INPUT_PULLUP);
    inputs[i] = {false, millis(), false, 0};
  }
  digitalWrite(LINK_LED_PIN, LINK_LED_ON == HIGH ? LOW : HIGH);
  pinMode(LINK_LED_PIN, OUTPUT);

  WiFi.onEvent([](WiFiEvent_t, WiFiEventInfo_t) {
    Serial.print("READY ");
    Serial.println(WiFi.localIP());
  }, ARDUINO_EVENT_WIFI_STA_GOT_IP);
  // Why the Wi-Fi dropped or never joined, e.g. 201 = network not found, 15 or 204 = wrong password.
  WiFi.onEvent([](WiFiEvent_t, WiFiEventInfo_t info) {
    Serial.print("WIFI-LOST ");
    Serial.println(info.wifi_sta_disconnected.reason);
  }, ARDUINO_EVENT_WIFI_STA_DISCONNECTED);
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
      digitalWrite(OUTPUT_PINS[i], IDLE_LEVEL);
      t.high = false;
      t.remaining -= 1;
      t.nextAt = now + t.offMs;
      if (t.remaining == 0) {
        Serial.print("DONE ");
        Serial.println(i + 1);
      }
    } else {
      digitalWrite(OUTPUT_PINS[i], ACTIVE_LEVEL);
      t.high = true;
      t.nextAt = now + t.onMs;
    }
  }

  readInputs(now);
  showLink(now);
}

void readInputs(unsigned long now) {
  for (int i = 0; i < NUM_CHANNELS; i++) {
    Input& in = inputs[i];
    bool active = digitalRead(INPUT_PINS[i]) == INPUT_ACTIVE_LEVEL;
    if (active != in.raw) {
      in.raw = active;
      in.rawSince = now;
    }
    if (in.raw == in.running || now - in.rawSince < (in.raw ? INPUT_ON_MS : INPUT_OFF_MS)) continue;
    in.running = in.raw;
    // The run started when the signal first came, not when the hold time ran out.
    if (in.running) in.runningSince = in.rawSince;
    Serial.print(in.running ? "RUNNING " : "STOPPED ");
    Serial.println(i + 1);
  }
}

void showLink(unsigned long now) {
  bool wifi = WiFi.status() == WL_CONNECTED;
  bool app = appSeen && now - appSeenAt < APP_SEEN_TIMEOUT_MS;
  bool on = wifi && (app || (now / LINK_BLINK_MS) % 2 == 0);
  digitalWrite(LINK_LED_PIN, on ? LINK_LED_ON : (LINK_LED_ON == HIGH ? LOW : HIGH));
}

void handleStatus() {
  String busy = "";
  for (int i = 0; i < NUM_CHANNELS; i++) {
    if (trains[i].remaining == 0) continue;
    if (busy.length() > 0) busy += ",";
    busy += String(i + 1);
  }
  unsigned long now = millis();
  String running = "";
  for (int i = 0; i < NUM_CHANNELS; i++) {
    if (!inputs[i].running) continue;
    if (running.length() > 0) running += ",";
    running += String("{\"channel\":") + (i + 1) + ",\"ms\":" + (now - inputs[i].runningSince) + "}";
  }
  appSeen = true;
  appSeenAt = now;
  server.send(200, "application/json",
              String("{\"device\":\"laundry-locks\",\"channels\":") + NUM_CHANNELS + ",\"busy\":[" + busy +
                  "],\"running\":[" + running + "],\"lastAccepted\":\"" + lastAccepted + "\"}");
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
