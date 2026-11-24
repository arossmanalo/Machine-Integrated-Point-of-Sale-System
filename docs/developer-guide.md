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

**Manage › Machines**: add each machine with its type, its channel (the machine controller terminal it is wired to), its start pulses and its **run time** in minutes (what the in-use countdown counts down). For dryers, open the saved dryer to set its **top-ups**: a table with an **On** tick box, name, minutes, pulses and price for each. Every new dryer starts with 5, 10, 15 and 20 minutes at the shop prices. **Add top-up** creates your own (for example "Extra dry", 30 minutes) on this dryer only, all dryers, or the dryers you pick; with no price it is added switched off. An offered top-up needs a price. The owner can tick top-ups on or off and change their coins and prices, but not their names or minutes. Use **Test** to send a machine's pulses without an order. Switch a machine off while it is broken so nobody can start it. **Simulate machines** is for training; turn it off for real use.

**Start pulses.** A start works like dropping coins in the machine's slot: it sends a number of pulses, each a set length, with a gap between them. Set all three per machine: **Number of pulses** (1 to 50), **Pulse length** and **Gap between** (20 to 5000 milliseconds; 1000 ms is one second). The defaults are 1 pulse of 500 ms with a 500 ms gap. To give other machines the same pulses, pick **All machines** or **Selected machines** under **Use these pulses on** before saving; their run time and top-up settings are left alone.

The machine controller has 14 channels. Wire each machine to the terminal for its channel; the app shows the terminal next to each machine.

| Channel | Terminal | Green strip (USB port at the top) | ESP32 pin |
|---|---|---|---|
| 1 | D25 | right strip | GPIO 25 |
| 2 | D26 | right strip | GPIO 26 |
| 3 | D27 | right strip | GPIO 27 |
| 4 | D32 | right strip | GPIO 32 |
| 5 | D33 | right strip | GPIO 33 |
| 6 | D13 | right strip | GPIO 13 |
| 7 | D18 | left strip | GPIO 18 |
| 8 | D19 | left strip | GPIO 19 |
| 9 | D21 | left strip | GPIO 21 |
| 10 | D22 | left strip | GPIO 22 |
| 11 | D23 | left strip | GPIO 23 |
| 12 | D4 | left strip | GPIO 4 |
| 13 | RX2 | left strip | GPIO 16 |
| 14 | TX2 | left strip | GPIO 17 |

Leave the other terminals free: some of them switch on briefly while the board starts, which could start a machine.

**Testing the machines.** The **Machines** tab looks the same for the developer as for staff until the developer turns on **Testing mode** at the bottom of the tab. Testing mode shows **Test start** on each free machine, which sends its pulses without an order, sets no countdown and is logged as a test, and **Create test order**. A test order is Pay later, takes no supplies, and lets you try the staff flow: tap a free machine, pick the test order and start it. Tap **Void test order** when you are done so it does not stay in the open jobs. With the LED prototype, the LED stays off and blinks once per pulse.
