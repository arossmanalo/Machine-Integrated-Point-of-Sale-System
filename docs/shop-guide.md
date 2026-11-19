# Laundry POS: how to use it at the counter

## For everyone

**Sign in with your own account.** Every order, payment and door unlock is recorded under the name of whoever is signed in. Sign out (top right) when you leave the counter.

### Taking an order

1. Tap **New order**.
2. Find the customer by name or phone. If they are new, tap **Add … as a new customer**.
3. Enter the weight. The app suggests the number of loads (up to 8 kg per load). Change it with − and + if needed.
4. For add-ons (fabric softener and so on), tap **Add-ons** to open the list and set how many. Only items an admin marked "Sell as an add-on" in Stock, with a price, are listed.
5. If the customer has 10 or more loads saved up, one load is free. The app does this by itself and shows it.
6. Choose how they pay: **Full payment**, **Down payment** or **Pay later**. For GCash, type the reference number.
7. Tap **Save order**. The receipt prints if printing is on.

### Opening a machine

The washer and dryer doors only open for an order.

- After saving an order, the order page shows **Unlock a washer** and **Unlock a dryer**. Each load allows one washer and one dryer.
- Or go to **Machines**, tap the machine, and pick the order.
- The door opens for a few seconds and locks again when it is closed.
- If the app says there are no unlocks left, the order has used all of its loads. Ask the owner for an override.

### Payments later

Open the order (from **Orders** or the customer's history) and tap **Receive payment**. The app never takes more than what is owed.

### When something goes wrong

| What you see | What to do |
|---|---|
| **Locks offline** at the top | Check that the lock box has power and the tablet is on the shop Wi-Fi. Tap the chip to reconnect. |
| **No answer** after an unlock | Look at the door first: it may have opened anyway. Only try again if it did not, and tell the owner if it keeps happening. |
| Printer does not print | Make sure the printer is on and charged. Use **Print receipt** on the order page to try again. |

## For the owner

### Overrides

For a rewash, a stuck door or maintenance, tap the machine and choose **Owner override**. Pick a reason and enter the owner PIN.

- Five wrong PINs in a row lock overrides for 5 minutes.
- Every override, and every wrong PIN, is written in the log.
- Admins cannot override; only the owner PIN can.

### Reading the unlock log

**Manage › Unlock log** lists every unlock with the time, machine, order and employee. **Needs a look** shows:

- overrides and wrong PINs,
- unlocks that failed (no answer, offline),
- unlocks on orders that are still unpaid or were later voided.

An unpaid order that was used to open machines is worth asking about.

### Voiding an order

Orders cannot be deleted, only voided with a reason (admin or owner). A voided order keeps its unlock history, gives back the customer's loyalty loads and the add-on stock, and its payments stop counting as money received.

### Reports

Money is counted on the day it was paid. Orders and loads are counted on the day they were placed. A payment today for an order from last week shows as "paid for orders placed earlier".

### Backups

Everything lives only on this tablet. Go to **Manage › Backup and import › Save a backup** at least once a week and keep the file somewhere else (Google Drive, email to yourself).

### Setting up machines

**Manage › Machines and locks**: add each machine with its type and lock channel (the lock controller output it is wired to). Use **Test** to pulse one lock. Switch a machine off while it is broken so nobody gets sent to it. **Simulate locks** is for training; turn it off for real use.

The lock controller has 14 channels. Wire each machine's lock to the terminal for its channel; the app shows the terminal next to each machine.

| Channel | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12 | 13 | 14 |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| Terminal | D25 | D26 | D27 | D32 | D33 | D13 | D18 | D19 | D21 | D22 | D23 | D4 | RX2 | TX2 |

Leave the other terminals free: some of them switch on briefly while the board starts, which would open a door.
