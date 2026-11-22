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
7. Tap **Save and print**. The order is saved and its receipt prints right away; give it to the customer, since staff scan its QR code to run the machines. If it did not print, open the order and tap **Print receipt**.

### Running a machine

The washers and dryers only start for an order, and only with that order's receipt. Each receipt has a QR code under **Scan at the machines**. It is good for as many washer and dryer runs as the order has loads: a 4-load order can run 4 washers and 4 dryers, then the code stops working.

1. Load the laundry and close the door.
2. On the order page, tap **Assign machine**. A window shows the dryers on top and the washers below, like they stand in the shop. Tap the machine you loaded.
   You can also go to **Machines** and tap a free machine. Scanning the receipt there picks the order for you.
3. The camera opens. Hold the receipt's QR code in front of it. If the picture is from the wrong side, tap **Switch camera**. The first time, allow the app to use the camera.
4. The app asks once: **Run Washer 1 for T0012?** Tap **Run machine**. The machine starts right away.

- The owner can turn receipt scans off in **Manage › Machines › Scan receipt to run a machine**. Staff then pick the order from a list with no receipt, as before.
- A receipt for another order, or any other QR code, is refused. Tap **Scan again** and use the right receipt.
- **For testing only:** until the receipt printer arrives, one test QR code (`docs/test-receipt-qr.png`) works for every open order. On the Machines tab you then pick the order from the list. Anyone holding a copy of it can start machines for any order, so it is removed before the shop relies on receipts.

- While a machine runs, the **Machines** tab shows **In use** with a countdown and the order. Nobody can start it again until the countdown ends. If it finished early, tap **Mark as done**.
- If a start did not go out (offline, busy), the machine shows **Did not start**. Tap **Run machine** to try again (no new scan needed), or **Remove** to take the order off.
- If the app says the order has used all its washers or dryers, it has used all of its loads. Ask the owner for an override.
- The order page lists each load with the washer and dryer that ran it.

### Dryer top-ups

If the laundry is still damp, tap **Top up** on the dryer in **Machines** while it is still running. Pick 5, 10, 15 or 20 minutes (only the lengths the owner has priced show), then tap **Add**. The minutes go on the countdown and the price is added to the order's bill. Once the countdown ends or someone taps **Mark as done**, the Top up button is gone. If the top-up does not reach the dryer, the charge comes off again.

**Adding a top-up when taking the order:** if you can already tell the laundry will need longer, pick a length under **Dryer top-up** (below the add-ons) on the new order and how many loads get it. It is charged with the order and shows on the receipt. When each of those loads starts in a dryer, the extra minutes and pulses go out with the start; there is nothing more to tap.

**Owner:** prices for top-ups added on new orders are in **Manage › Shop settings › Dryer top-ups on new orders** (one list for the shop, since the dryer is not known yet). Saving them also gives every dryer the same prices for top-ups while drying; you can still change a single dryer afterwards. Set the prices for top-ups added while drying in **Manage › Machines** on each dryer: pulses per 5 minutes (10 minutes sends them twice, 20 minutes four times) and a price for each length. Leave a length blank to not offer it. **Use these top-up prices on** copies the four prices to all dryers or to the dryers you pick.

### Payments later

Open the order (from **Orders** or the customer's history) and tap **Receive payment**. Faster: on the **Orders** tab, tap the order's **Unpaid** badge. The full balance is filled in; pick Cash or GCash and tap **Record**. The app never takes more than what is owed.

### Updating the app

The app downloads updates by itself when it opens and uses them from the next start. To get one right away, open **Settings** (or **Manage** for admins and the owner) › **About this app** and tap **Check for updates**.

### Recording an expense

If the owner allows it, the **Today** screen has **Record expense**. Enter what it was for, the category and the cost, then **Save expense**. It is saved for today under your name. You cannot see, change or delete expenses after saving; ask the owner or an admin to fix a mistake.

### When something goes wrong

| What you see | What to do |
|---|---|
| **Machines offline** at the top | Check that the machine controller box has power and the tablet is on the shop Wi-Fi. Tap the chip to reconnect. |
| **Did not get the start** | Nothing happened. Tap **Run machine** again. |
| **Busy** | That machine is still getting the pulses from the last start. Wait a moment and try again. |
| **Still running** | The machine's countdown has not ended. Wait, or tap **Mark as done** on the Machines tab if it already stopped. |
| **No answer** after a start | Look at the machine: it may have started anyway. If it did not, ask the owner for an override; the app will not start it twice on its own. |
| Printer does not print | Make sure the printer is on and charged. Use **Print receipt** on the order page to try again. |

## For the owner

### Overrides

For a rewash, a machine that did not start, or maintenance, go to **Machines**, tap a free machine and choose **Owner override**. Pick a reason and enter the owner PIN. The machine starts right away.

- Five wrong PINs in a row lock overrides for 5 minutes.
- Every override, and every wrong PIN, is written in the log.
- Admins cannot override; only the owner PIN can.

### Machine earnings

On the **Machines** tab, tap a machine to see what it has earned today, this month and in all. If the machine is free, the figures show at the top of the window where you pick the order. If it is in use, waiting or switched off, tapping it shows only the figures. Each wash or dry it ran for an order counts as half that order's price per load (₱80 of a ₱160 load); an odd centavo is dropped. It is a rough figure: top-ups, overrides, tests and voided orders are not counted, and a free promo load still counts. Only admins and the owner see it.

### Reading the machine log

**Manage › Machine log** lists every start with the time, machine, order and employee. **Needs a look** shows:

- overrides and wrong PINs,
- starts that failed (no answer, offline, busy),
- starts on orders that are still unpaid or were later voided.

An unpaid order that was used to run machines is worth asking about.

### Auditing orders

Admins and the owner can audit a pending order straight from the **Orders** tab: tap its **Pending** badge, then **Mark as audited**. An audited order is closed (no more machine runs, not an open job). Employees cannot audit, and cannot change an audited order's status; only an admin or the owner can.

### Voiding an order

Orders cannot be deleted, only voided with a reason (admin or owner). A voided order keeps its machine history, frees any machine still waiting on it, gives back the customer's loyalty loads and the add-on stock, and its payments stop counting as money received.

### Reports

Money is counted on the day it was paid. Orders and loads are counted on the day they were placed. A payment today for an order from last week shows as "paid for orders placed earlier".

**Daily report** (Manage › Reports, first tab) covers one day; use **Previous day** and **Next day** to move between days. It shows:

- **Sales**: orders, loads, money received (cash and GCash), dryer top-ups, expenses, net, and what is still owed.
- **Checks**: loads sold against washer and dryer starts, loads still missing a start, owner overrides, test starts, starts with no answer, wrong PINs, and starts for voided or unpaid orders. If the counts do not match, this is where it shows.
- **Loads by order**: for every order, which washer and dryer ran each load, at what time, and its top-ups.
- **Machines**: everything each machine did that day, with the order, the load number and who started it, including starts that did not go out.

**Print report** prints it on the receipt printer. **Export PDF** makes an A4 PDF of the day (named like `daily-report-2026-11-21.pdf`) and opens the share menu, so you can save it to Drive or send it by Messenger or email. **Share as text** sends it as plain text.

### GCash QR code

When a customer pays by GCash (on a new order or with **Receive payment**), the app shows the shop's GCash QR code for them to scan. To set it, open **Manage › Shop settings › GCash payments** and tap **Upload QR code**. Pick a screenshot of your GCash QR, drag the square over the code to crop it, and confirm. Only the owner can change it. The image is kept on this tablet and is not part of backups, so upload it again after restoring a backup on another tablet.

### Letting employees record expenses

In **Manage › Shop settings › Expenses**, turn on **Employees can record expenses**. Employees then get **Record expense** on the Today screen. They can only enter today's expenses, saved under their name, and cannot see or delete any. The expense list in **Reports and expenses** shows who entered each one.

### Backups

Everything lives only on this tablet. Go to **Manage › Backup and import › Save a backup** at least once a week and keep the file somewhere else (Google Drive, email to yourself).

### Setting up machines

**Manage › Machines**: add each machine with its type, its channel (the machine controller terminal it is wired to), its start pulses and its **run time** in minutes (what the in-use countdown counts down). For dryers, also set the **top-up pulses** (how many pulses give the dryer 5 more minutes) and the **top-up price**; a price of 0 switches top-ups off. Use **Test** to send a machine's pulses without an order. Switch a machine off while it is broken so nobody can start it. **Simulate machines** is for training; turn it off for real use.

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

**Testing the machines (owner).** The **Machines** tab looks the same for the owner as for staff until the owner turns on **Testing mode** at the bottom of the tab. Testing mode shows **Test start** on each free machine, which sends its pulses without an order, sets no countdown and is logged as a test, and **Create test order**. A test order is Pay later, takes no supplies, and lets you try the staff flow: tap a free machine, pick the test order and start it. Tap **Void test order** when you are done so it does not stay in the open jobs. With the LED prototype, the LED stays off and blinks once per pulse.
