# Developer guide

Not for customers: this covers the hidden developer sign-in and how the machines are wired and set up. Keep it out of anything handed to a shop.

## The developer sign-in

The developer account is built into the app, not created on a tablet. It can do everything the owner can, and it alone sets up and tests the machines. Nobody else sees it: it is not in **Staff**, not in backups, and a backup cannot add one.

1. On your PC, in the project folder, run `npm run developer-login` (in PowerShell, `npm.cmd run developer-login`) and enter a username and a password of at least 12 characters. Pick a username no shop will use for staff.
2. It writes the username and a salted hash of the password to `.env` (git-ignored). The password itself is never saved.
3. Publish an update (or build an APK) with those values loaded into the shell: `eas update --environment production` does not read `.env` by itself. In bash, run `set -a; . ./.env; set +a` first. Every tablet then accepts that sign-in on the normal login screen.

To change the password, run it again and publish: developer sessions on the tablets end once the update runs. The hash ships inside the app, so use a long password nobody could guess. Signing in takes a few seconds while the tablet checks it.

## Multi-cycle

In **Manage › Machines**, turn on **Multi-cycle** to make staff pick a cycle before a washer runs. Each washer starts with Delicates, Light, Medium and Heavy. Its settings show a table of its cycles: the tick box (**On**) decides whether staff are offered that cycle, and you can change each cycle's name, pulses and minutes; pulse length and gap stay the washer's. **Add cycle** creates your own (for example "Quick wash") on this washer only, all washers, or the washers you pick. A washer with every cycle unticked starts with its own pulse count and run time. Dryers have no cycles. The owner override asks for the cycle too. In Testing mode, **Test start** on a washer asks which cycle to send, and on a dryer asks for **Start** or a 5, 10, 15 or 20-minute top-up, so you can test each one in turn. Tests charge nothing and set no countdown. When you first turn it on, every cycle has the machine's current pulses and run time, so set each one.

## Setting up machines

**Manage › Machines**: add each machine with its type, its channel (the machine controller terminal it is wired to), its start pulses and its **run time** in minutes (what the in-use countdown counts down). For dryers, open the saved dryer to set its **top-ups**: a table with an **On** tick box, name, minutes, pulses and price for each. Every new dryer starts with 5, 10, 15 and 20 minutes at the shop prices. **Add top-up** creates your own (for example "Extra dry", 30 minutes) on this dryer only, all dryers, or the dryers you pick; with no price it is added switched off. An offered top-up needs a price. The owner can tick top-ups on or off and change their coins and prices, but not their names or minutes. Use **Test** to send a machine's pulses without an order. Switch a machine off while it is broken so nobody can start it. **Remove machine** (in its settings, confirmed once) deletes a machine you no longer have, with its cycles and top-ups, and frees its channel; its past runs stay in the machine log and reports. It is refused while the machine runs or an order waits on it. **Simulate machines** is for training; turn it off for real use.

**Start pulses.** A start works like dropping coins in the machine's slot: it sends a number of pulses, each a set length, with a gap between them. Set all three per machine: **Number of pulses** (1 to 50), **Pulse length** and **Gap between** (20 to 5000 milliseconds; 1000 ms is one second). The defaults are 1 pulse of 500 ms with a 500 ms gap. To give other machines the same pulses, pick **All machines** or **Selected machines** under **Use these pulses on** before saving; their run time and top-up settings are left alone.

The machine controller (ESP32-S3) has 11 channels, one per machine. Each channel has two neighbouring terminals: the **start** terminal sends the coin pulses to the machine, and the **signal** terminal reads the machine's running signal. The app shows both next to each machine. The terminal is the number printed on the board (IO14 is the terminal labelled 14).

| Channel | Start (output) | Running signal (input) | Green strip (USB ports at the top) |
|---|---|---|---|
| 1 | IO14 | IO13 | right strip |
| 2 | IO12 | IO11 | right strip |
| 3 | IO10 | IO9 | right strip |
| 4 | IO8 | IO18 | right strip |
| 5 | IO17 | IO16 | right strip |
| 6 | IO15 | IO7 | right strip |
| 7 | IO6 | IO5 | right strip |
| 8 | IO21 | IO47 | left strip |
| 9 | IO39 | IO40 | left strip |
| 10 | IO41 | IO42 | left strip |
| 11 | IO2 | IO1 | left strip |
| link light | IO4 | | right strip |

**The running signal is 5 V; the board takes 3.3 V at most.** Never wire a machine's 5 V signal straight to a signal terminal: it can destroy the board. Put a voltage divider in between (machine signal → 10 kΩ → signal terminal → 20 kΩ → GND, with the machine's ground joined to the board's GND), or an optocoupler. With an optocoupler that pulls the terminal to GND while the machine runs, set `INPUT_ACTIVE_LEVEL` to `LOW` in the sketch. An unwired signal terminal reads as "not running".

**Link light (IO4).** An LED on terminal 4 (through 220 Ω to GND) shows the controller's connection: **off** with no Wi-Fi, **blinking** on Wi-Fi when the app has not checked in for 45 seconds (the tablet app is closed or asleep, the address in the app is wrong, or Simulate machines is on), **steady** when it is on Wi-Fi and the app is checking in.

Leave the other terminals free: some of them switch on briefly while the board starts, which could start a machine. Before wiring real machines, put an LED on each start terminal and on the link light, and power the board on and off a few times: any LED that blinks at power-on must not drive a machine.

**Real-time sync.** In **Manage › Machines**, **Real-time sync** (the owner can switch it too) makes the app read each machine's running signal every 3 seconds instead of checking the controller every 20. After a start the machine counts down as before until its signal comes on; from then on the Machines tab shows how long it has been running, it stays in use for as long as the signal is on (even past its run time), and it is free as soon as the signal has been off for 10 seconds (`INPUT_OFF_MS` in the sketch, so a short dip between wash phases does not end the run). **Mark as done** is hidden while the signal is on. A machine whose signal comes on without a start from the app (coins, a Test start) shows as in use with **No order**. If the controller cannot be reached, the last reading stands.

**Start confirmation.** With real-time sync on, after **Run machine**, an override or a **Test start**, the app waits for the machine's running signal: 30 seconds after the last coin pulse. If the signal comes, it says the machine started. If not, the start did not happen: it no longer counts against the order, a top-up added with it comes off the bill, and the order goes back on the machine as **Did not start** so **Run machine** can try again. If the machine starts within 10 minutes after all, the start counts again. This only happens on a machine whose signal the app has seen at least once; until then (or with an older sketch, or Simulate machines) every start counts as before, so a broken or unwired signal wire can never hand out free runs. If the controller stops answering during the wait, the app says it could not check and the start counts. An override receipt used on a start that did not happen is not given back; print a new one. Switching real-time sync off puts a running machine back on a countdown from when its signal came on.

**Testing the machines.** The **Machines** tab looks the same for the developer as for staff until the developer turns on **Testing mode** at the bottom of the tab. Testing mode shows **Test start** on each free machine, which sends its pulses without an order, sets no countdown and is logged as a test, and **Create test order**. A test order is Pay later, takes no supplies, and lets you try the staff flow: tap a free machine, pick the test order and start it. Tap **Void test order** when you are done so it does not stay in the open jobs. With the LED prototype, the LED stays off and blinks once per pulse.
