// Machine Pulser - LED prototype
// Each LED represents one machine. The POS sends "P<n>\n" over USB serial
// (e.g. "P3\n") and LED n pulses once. Replies "OK P3" or "ERR <cmd>".
//
// Wiring (per LED): Arduino pin -> 220 ohm resistor -> LED long leg (+)
//                   LED short leg (-) -> GND

const int LED_PINS[] = {2, 3, 4, 5, 6, 7};   // machine 1..6 (add pins for more machines)
const int NUM_MACHINES = sizeof(LED_PINS) / sizeof(LED_PINS[0]);
const unsigned long PULSE_MS = 500;           // how long each pulse lasts

unsigned long offAt[NUM_MACHINES];            // 0 = LED is off / idle
String buffer;

void setup() {
  Serial.begin(9600);
  for (int i = 0; i < NUM_MACHINES; i++) {
    pinMode(LED_PINS[i], OUTPUT);
    digitalWrite(LED_PINS[i], LOW);
    offAt[i] = 0;
  }
  Serial.println("READY");
}

void loop() {
  // Read incoming characters until a newline
  while (Serial.available()) {
    char c = Serial.read();
    if (c == '\n' || c == '\r') {
      if (buffer.length() > 0) handleCommand(buffer);
      buffer = "";
    } else if (buffer.length() < 16) {
      buffer += c;
    }
  }

  // Turn off LEDs whose pulse has finished (non-blocking, so several
  // machines can pulse at the same time)
  unsigned long now = millis();
  for (int i = 0; i < NUM_MACHINES; i++) {
    if (offAt[i] != 0 && (long)(now - offAt[i]) >= 0) {
      digitalWrite(LED_PINS[i], LOW);
      offAt[i] = 0;
    }
  }
}

void handleCommand(String cmd) {
  cmd.trim();
  if (cmd.length() >= 2 && (cmd[0] == 'P' || cmd[0] == 'p')) {
    int machine = cmd.substring(1).toInt();
    if (machine >= 1 && machine <= NUM_MACHINES) {
      int i = machine - 1;
      digitalWrite(LED_PINS[i], HIGH);
      offAt[i] = millis() + PULSE_MS;
      if (offAt[i] == 0) offAt[i] = 1;     // avoid the "idle" marker value
      Serial.print("OK P");
      Serial.println(machine);
      return;
    }
  }
  Serial.print("ERR ");
  Serial.println(cmd);
}
