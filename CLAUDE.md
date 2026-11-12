# Laundry Shop POS

POS app for our family laundry shop. It currently runs as a Kotlin Android app on a tablet at the counter and is being rewritten in React Native.

## Working rules

- Commit after each milestone so progress isn't lost mid-task, and push to `origin` (https://github.com/arossmanalo/Machine-Integrated-Point-of-Sale-System) every time you commit.
- Do not add Claude as an author or co-author in commits (no `Co-Authored-By` lines, no "Generated with Claude" footers).
- The old Kotlin code is messy. Treat it as a reference for what the app does (features, business rules, data), not for how it should be built.

## Machine integration (planned — not implemented yet)

### Goal

Stop employees from using the washers and dryers for personal laundry. Machines may only be used for paid customer orders.

### How it will work

- Machines keep running normally. The POS does not control power.
- Each machine door gets an electronic lock. The POS unlocks a machine's door only for an order that exists in the POS.
- Flow: employee creates the order and payment → assigns a machine → taps Unlock → the POS sends a command → the Arduino pulses that machine's lock open for a few seconds → the door relocks when closed.

### Current phase: LED prototype

- One LED per machine stands in for the door lock. The hardware side (relays, 12V solenoid locks, mounting) will be done by my dad later.
- Hardware: Arduino Uno, LEDs on digital pins 2–7 (machines 1–6), each through a 220Ω resistor, with a shared GND rail.
- Connection: Android tablet → USB OTG adapter → Arduino USB cable. The tablet powers the Arduino.

### Serial protocol (the contract between app and Arduino)

- 9600 baud, 8N1, newline-terminated ASCII.
- App sends `P<n>\n` (for example `P3\n`) to pulse machine n (1-based).
- Arduino replies `OK P<n>` on success or `ERR <cmd>` on an invalid command, and prints `READY` on boot.
- The Arduino Uno resets when the serial port opens, so wait about 2 seconds after connecting before sending.
- Pulse length is 500 ms for LEDs. For real locks it will become about 3–5 s, which is an Arduino-side change only.

### Existing code

- `machine_pulser/machine_pulser.ino`: the Arduino sketch. It's non-blocking, so several machines can pulse at once.
- `ArduinoPulser.kt`: the Kotlin USB client built on `usb-serial-for-android` (mik3y). It handles connect, USB permission, and `pulse(n)`.
- Both files are working drafts, not final. They can still be changed (including the serial protocol) if the design needs it; if the protocol changes, update the sketch, the app client, and this file together.

### React Native notes

- Talk to USB through a native module, either by wrapping `ArduinoPulser.kt` or by using a library such as `react-native-usb-serialport-for-android`.
- If you use Expo, USB will not work in Expo Go. A development build (prebuild or EAS) is required.
- iOS cannot talk to an Arduino over a USB cable. If iOS is ever needed, switch to an ESP32 over Wi-Fi and send HTTP from JS.

### Architecture requirements for the integration

- Hide machine control behind an interface (for example `MachineController` with `connect()`, `unlock(machineId)`, `status()`), with interchangeable implementations: `MockMachineController` for development without hardware, `UsbSerialMachineController`, and possibly a Wi-Fi one later.
- The UI and business logic must never talk to USB directly.
- Unlocks must be tied to an order: no order, no unlock.
- Log every unlock with the timestamp, machine, order, and employee.
- Owner-PIN override for legitimate non-order unlocks, such as rewashes or a stuck door. Overrides get logged too.
- Machines should be configurable data (ID, name, type washer/dryer, hardware channel), not hard-coded.

### Possible later upgrades (not in scope yet)

- Door sensors (reed switches) to detect a door opened without an unlock
- Auto-unlock when a cycle finishes, using current sensing
- Sending logs off-device so the owner can review them remotely
