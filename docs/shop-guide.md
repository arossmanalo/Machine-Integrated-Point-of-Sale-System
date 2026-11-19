# Laundry POS: how to use it at the counter

## For everyone

**Sign in with your own account.** Every order, payment and machine start is recorded under the name of whoever is signed in. Sign out (top right) when you leave the counter.

### Taking an order

1. Tap **New order**.
2. Find the customer by name or phone. If they are new, tap **Add … as a new customer**.
3. Enter the weight. The app suggests the number of loads (up to 8 kg per load). Change it with − and + if needed.
4. For add-ons (fabric softener and so on), tap **Add-ons** to open the list and set how many. Only items an admin marked "Sell as an add-on" in Stock, with a price, are listed.
5. If the customer has 10 or more loads saved up, one load is free. The app does this by itself and shows it.
6. Choose how they pay: **Full payment**, **Down payment** or **Pay later**. For GCash, type the reference number.
7. Tap **Save order**. The receipt prints if printing is on.

### Running a machine

The washers and dryers only start for an order. It takes two steps: assign, then start.

1. **Assign.** On the order page, tap **Assign to machine**. A window shows the dryers on top and the washers below, like they stand in the shop. Tap a free machine to put the order on it. Each load allows one washer and one dryer.
   You can also go to **Machines**, tap a free machine, and pick the order.
2. **Start.** Load the laundry, then go to **Machines**. The machine shows the order and **Start machine**. Tap it to start the machine. Starting uses up the assignment, and the machine is free for the next order.

- Put an order on the wrong machine? Tap **Remove** on that machine before starting it.
- If the app says the order has used all its washers or dryers, it has used all of its loads. Ask the owner for an override.

### Payments later

Open the order (from **Orders** or the customer's history) and tap **Receive payment**. The app never takes more than what is owed.

### When something goes wrong

| What you see | What to do |
|---|---|
| **Machines offline** at the top | Check that the machine controller box has power and the tablet is on the shop Wi-Fi. Tap the chip to reconnect. |
| **Did not get the start** | Nothing happened. Tap **Start machine** again. |
| **Busy** | That machine is still getting the pulses from the last start. Wait a moment and try again. |
| **No answer** after a start | Look at the machine: it may have started anyway. If it did not, ask the owner for an override; the app will not start it twice on its own. |
| Printer does not print | Make sure the printer is on and charged. Use **Print receipt** on the order page to try again. |

## For the owner

### Overrides

For a rewash, a machine that did not start, or maintenance, go to **Machines**, tap a free machine and choose **Owner override**. Pick a reason and enter the owner PIN. The machine starts right away.

- Five wrong PINs in a row lock overrides for 5 minutes.
- Every override, and every wrong PIN, is written in the log.
- Admins cannot override; only the owner PIN can.

### Reading the machine log

**Manage › Machine log** lists every start with the time, machine, order and employee. **Needs a look** shows:

- overrides and wrong PINs,
- starts that failed (no answer, offline, busy),
- starts on orders that are still unpaid or were later voided.

An unpaid order that was used to run machines is worth asking about.

### Voiding an order

Orders cannot be deleted, only voided with a reason (admin or owner). A voided order keeps its machine history, frees any machine still waiting on it, gives back the customer's loyalty loads and the add-on stock, and its payments stop counting as money received.

### Reports

Money is counted on the day it was paid. Orders and loads are counted on the day they were placed. A payment today for an order from last week shows as "paid for orders placed earlier".

### Backups

Everything lives only on this tablet. Go to **Manage › Backup and import › Save a backup** at least once a week and keep the file somewhere else (Google Drive, email to yourself).

### Setting up machines

**Manage › Machines**: add each machine with its type, its channel (the machine controller terminal it is wired to) and its start pulses. Use **Test** to send a machine's pulses without an order. Switch a machine off while it is broken so nobody gets sent to it; any order waiting on it is taken off. **Simulate machines** is for training; turn it off for real use.

**Start pulses.** A start works like dropping coins in the machine's slot: it sends a number of pulses, each a set length, with a gap between them. Set all three per machine: **Number of pulses** (1 to 50), **Pulse length** and **Gap between** (20 to 5000 milliseconds; 1000 ms is one second). The defaults are 1 pulse of 500 ms with a 500 ms gap.

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

**Testing the machines (owner).** On the **Machines** tab the owner sees **Test start** on each free machine, which sends its pulses without an order and is logged as a test, and a **Testing** section with **Create test order**. A test order is Pay later, takes no supplies, and lets you try the staff flow: assign it to a machine, then **Start machine**. Tap **Void test order** when you are done so it does not stay in the open jobs. With the LED prototype, the LED stays off and blinks once per pulse.
