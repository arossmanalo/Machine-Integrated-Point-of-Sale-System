# Plan: React Native rewrite + machine integration

This plan covers two things: rebuilding the existing Kotlin POS in React Native with the same features, and adding the machine door-lock integration described in `CLAUDE.md`.

It is based on a full read of the old app (`arossmanalo/Laundry-Pos`, commit `7e6bcf4`, about 5,500 lines of Kotlin) and the two draft files in this repo (`machine_pulser/machine_pulser.ino`, `ArduinoPulser.kt`).

> **2026-11-19:** the lock controller moved from a USB-wired Arduino Uno to an ESP32 on the shop Wi-Fi, with signed HTTP requests. The USB parts of this plan (the `machine-serial` module, the serial protocol, OTG and cable risks) no longer apply. `CLAUDE.md` describes the current design.

Nothing here is built yet. Items marked **Decision** are choices I made that you can overrule; section 11 records the answers you gave on 2026-11-12 and the one question still open.

**Change from the old app:** the new app sells one service only, Wash-Dry-Fold. `WASH` and `WASH_DRY` are removed. Section 1 still describes all three because that is what the old app does and what old data contains.

---

## 1. What the old app does (the feature inventory to carry over)

### 1.1 Screens and roles

| Screen | Who sees it | What it does |
|---|---|---|
| Login | everyone | Username + password. Session is remembered until logout. |
| Dashboard | everyone | Today's orders, count of jobs not yet completed, last 5 orders. Revenue card for admin/owner only. |
| Transactions | everyone | Order list with search (order ID or customer name), status filter, paid/unpaid filter, date filters (Today, Last 7 Days, This Month, custom range). Total amount row hidden from employees. |
| New Order | everyone | See 1.2. |
| Transaction details | everyone | Update status, receive payment, reprint receipt. Delete is admin/owner only. |
| Customers | everyone | Register, edit, delete, search by name or phone, 10+1 promo progress bar, per-customer order history. |
| Inventory | everyone | Items with stock, unit, low-stock threshold, restock/consume. Auto-consume toggle, add-on price and delete are admin/owner only. |
| Staff | admin, owner | Add, edit, delete users. Owner can assign ADMIN or EMPLOYEE; admin can only manage EMPLOYEE accounts. |
| Reports | admin, owner | Summary (daily/weekly/monthly), Yearly breakdown by month, Full Analysis with expense management, share report as text. |
| Settings | admin, owner | Printer, service prices and availability, default service, order statuses, data export/import. |

Roles are `OWNER`, `ADMIN`, `EMPLOYEE`. A low-stock alert pops up once after login.

### 1.2 Business rules found in the code

**Services and pricing**
- Three services: `WASH`, `WASH_DRY`, `WASH_DRY_FOLD`. Priced per load. Defaults: 90, 180, 220 pesos. Each can be disabled; one is the default.
- Total = price per load × billable loads + add-ons.

**Loads from weight**
- Minimum loads = ceil(kg ÷ 10). Recommended loads = ceil(kg ÷ 8). The form fills in the recommended number and shows the range, but the employee can type any number.

**10+1 loyalty promo**
- Each customer has a `loyaltyLoads` counter.
- If the counter is 10 or more when an order is created, one load is free (billable loads = loads − 1). The promo is applied automatically.
- After the order: counter = counter − 10 (if promo used) + billable loads, never below 0.

**Payment**
- Method: `FULL_PAYMENT`, `DOWN_PAYMENT`, `PAY_LATER`.
- Channel: `CASH` or `GCASH`. GCash requires a reference number and shows a QR image. Cash accepts "cash received" and shows change.
- Later payments are capped at the outstanding balance. `datePaid` is set when the balance reaches zero.

**Inventory**
- Items flagged auto-consume lose 1 unit per load on every order (skipped silently if stock is less than the load count).
- Items switched to "Sell as an add-on" (with a price above 0) appear behind the Add-ons button in the order form; chosen quantities are deducted from stock.

**Order statuses**
- Built in: `PENDING`, `WASHING`, `READY`, `COMPLETED`, `AUDITED` (`AUDITED` selectable by admin/owner only).
- Custom statuses can be added; any status can be hidden.

**Other**
- Owner can backdate an order.
- IDs are sequential with a prefix: `T0001`, `C0001`, `I0001`, `U0001`, `E0001`.
- Expense categories: Utilities, Supplies, Rent, Maintenance, Marketing, Others.
- Receipt: 32-column ESC/POS over Bluetooth classic (SPP), header "AR LAUNDRY SHOP".
- Backup: export all tables to one JSON file and share it; import merges and renumbers on ID conflicts.

### 1.3 Problems in the old app to fix, not copy

| Problem | Fix in the new app |
|---|---|
| Passwords stored and compared in plain text; a default owner account with a hard-coded password is created on first login. | Salted hashes. First-run setup screen creates the owner account and owner PIN. |
| Money stored as floating point. | Integer centavos everywhere; format only at display. |
| Add-ons stored as one text string (`"Fabcon x2"`). | `order_items` table with item, quantity, unit price. |
| Payments are not recorded individually; a later payment overwrites the channel and GCash reference of the earlier one. | `payments` table, one row per payment. |
| Revenue reports count money by the order's date, not the date it was paid. | Revenue is counted on the day each payment was received. Wherever a payment appears, the order's placed date is shown beside it (section 4.1). |
| Three services, each with its own price, on/off switch and a "default service" setting. | One service, Wash-Dry-Fold, with one price per load. The service picker, availability switches and default-service setting are removed. |
| Next ID is found by text sort, which breaks after 9999 (`T10000` sorts before `T9999`). | Numeric sequence column; display ID is formatted from it. |
| Deleting an order hard-deletes it and does not undo loyalty or stock. | Void instead of delete (see 5.6). Voiding reverses loyalty and add-on stock. |
| Low-stock check uses `<` in one place and `<=` in another. | One rule: stock ≤ threshold. |
| Payment channel text is inconsistent (`CASH` vs `Cash`, `GCASH` vs `GCash`). | One enum; importer normalises old values. |
| Prices and statuses live in app preferences and are not in the backup. | `settings` table, included in backup. |
| Background sync posts to a hard-coded LAN IP (`192.168.56.1`); `fallbackToDestructiveMigration` can wipe the database on a schema change. | Sync dropped (see Q6). Migrations are explicit and never destructive. |
| Business logic sits inside Compose screens and view models. | Pure TypeScript domain layer with unit tests. |

---

## 2. Technology choices

| Concern | Choice | Why |
|---|---|---|
| Framework | Expo with a development build (prebuild), TypeScript strict | Needed for USB (Expo Go cannot do it, per `CLAUDE.md`). Prebuild keeps native config generated instead of hand-edited. |
| Navigation | Expo Router | File-based routes; bottom tabs plus stack for details. |
| UI kit | React Native Paper (Material 3) | Closest to the current look, so staff retraining is minimal. |
| Database | `expo-sqlite` + Drizzle ORM | Local, offline, typed schema, explicit migrations, live queries. |
| State | Zustand for session and UI state; database is the source of truth for data | Small and simple. |
| Validation | Zod | Forms and backup-file import. |
| Secrets | `expo-secure-store` + `expo-crypto` | Password and PIN hashes. |
| Files | `expo-file-system`, `expo-sharing`, `expo-document-picker` | Backup export/import, report sharing. |
| USB serial | **Decision:** a small local Expo module (`modules/machine-serial`) wrapping `usb-serial-for-android`, built from `ArduinoPulser.kt` | The Kotlin already exists, it is about 100 lines, and it is the critical path, so we should own it. Fallback: `react-native-usb-serialport-for-android`. |
| Receipt printing | **Decision:** try `react-native-bluetooth-classic` first; if it does not work on the tablet, port `PrintUtils.kt` into a second local module | The old code has three connection fallbacks, which suggests the printer is fussy. Phase 0 tests this on the real printer. |
| Tests | Jest + React Native Testing Library | Domain rules and the machine controller are tested without hardware. |

Use the latest stable Expo SDK at the time Phase 0 starts and record the version in `CLAUDE.md`. Library choices for USB and Bluetooth are confirmed by the Phase 0 spike before anything is built on them.

Target: Android only (the counter tablet). Old app is `minSdk 26`; keep that or the Expo default, whichever is higher. Check the tablet's Android version in Phase 0.

---

## 3. Project structure

```
/                         Expo app at the repo root
  app/                    Expo Router screens (thin: layout + calls into src/)
    (auth)/login.tsx, setup.tsx
    (tabs)/dashboard, transactions, customers, inventory, machines, staff, reports, settings
    transactions/[id].tsx
  src/
    domain/               Pure TypeScript, no React, no database, no native code
      pricing.ts          loads from weight, order total, promo
      loyalty.ts
      payments.ts
      inventory.ts
      permissions.ts      what each role may do
      unlockPolicy.ts     may this order unlock this machine? (section 5.3)
      money.ts, ids.ts, dates.ts
    db/
      schema.ts           Drizzle schema
      migrations/
      repositories/       one per table group; the only code that runs SQL
    services/
      orderService.ts     create order = one database transaction
      unlockService.ts    validate -> log -> send -> record result
      backupService.ts    export, import, legacy import
      authService.ts
    machines/
      MachineController.ts          the interface
      MockMachineController.ts
      UsbSerialMachineController.ts
      protocol.ts                   encode "P3\n", parse "OK P3" / "ERR ..." / "READY"
    printing/
      ReceiptPrinter.ts             interface
      escpos.ts                     receipt bytes (pure, testable)
      BluetoothReceiptPrinter.ts, MockReceiptPrinter.ts
    ui/                   shared components, theme
  modules/
    machine-serial/       local Expo module (Kotlin) for USB serial
  machine_pulser/
    machine_pulser.ino    Arduino sketch (path unchanged)
  CLAUDE.md, plan.md
```

Rule enforced by structure: screens import from `services/` and `domain/`. Only `UsbSerialMachineController` imports the native module. An ESLint import restriction makes a direct import from a screen fail the lint step.

`ArduinoPulser.kt` moves from the repo root into `modules/machine-serial/android/` when the module is created; update the path in `CLAUDE.md` at the same time.

---

## 4. Data model

All money is integer centavos. All timestamps are epoch milliseconds. IDs keep the old display format.

**Carried over, reshaped**

- `users`: id, username, passwordHash, passwordSalt, role, active
- `customers`: id, name, phone, address, notes, loyaltyLoads
- `inventory_items`: id, name, currentStock, lowStockThreshold, unit, autoConsume, addOnPriceCentavos
- `orders` (old `transactions`): id, customerId, service, placedAt, weightKg, loadCount, promoApplied, pricePerLoadCentavos (snapshot), totalCentavos, status, initialPaymentMethod, createdByUserId, paidAt, voidedAt, voidedByUserId, voidReason
- `expenses`: id, name, category, costCentavos, incurredAt

**New**

- `order_items`: orderId, inventoryItemId, nameSnapshot, quantity, unitPriceCentavos
- `payments`: id, orderId, amountCentavos, channel, gcashReference, cashReceivedCentavos, receivedAt, receivedByUserId
- `settings`: key, value (price per load, statuses, printer, receipt text, machine settings)
- `machines`: id, name, type (`WASHER` or `DRYER`), hardwareChannel (the `n` in `P<n>`), enabled, sortOrder
- `machine_unlocks`: see 5.5

`amountPaid` and `outstandingBalance` are no longer stored columns; they are computed from `payments`. This removes the class of bug where they drift apart.

`orders.service` is kept as a column even though new orders are always `WASH_DRY_FOLD`, because imported orders from the old app can be `WASH` or `WASH_DRY`. Old services are read-only history: they show in lists and reports but cannot be chosen for a new order.

### 4.1 Reporting dates

- Revenue belongs to the day a payment was received (`payments.receivedAt`), not the day the order was placed.
- Every place that lists a payment or a paid order shows both dates: "Paid 14 Nov · Placed 12 Nov". When the two are the same day, it shows once.
- Report rows where the payment day differs from the placed day carry a small "placed earlier" marker, so a payment for an older order is not mistaken for a new sale.
- Order counts and load counts stay on the placed date, since that is when the work came in. Report headings say which date each figure uses.
- Expect historical totals to differ from the old app for periods with pay-later or part-paid orders.

---

## 5. Machine integration design

### 5.1 The interface

```ts
interface MachineController {
  connect(): Promise<ConnectResult>;   // 'connected' | 'no-device' | 'permission-requested' | 'failed'
  disconnect(): Promise<void>;
  status(): ControllerStatus;          // 'disconnected' | 'connecting' | 'ready' | 'error'
  onStatusChange(listener): Unsubscribe;
  unlock(hardwareChannel: number): Promise<UnlockResult>;  // 'acked' | 'rejected' | 'timeout' | 'not-connected'
}
```

- `MockMachineController`: logs calls, returns `acked` after a short delay, can be told to fail. Used in development, in tests, and as a "simulate hardware" switch in Settings for demos.
- `UsbSerialMachineController`: the real one.
- A Wi-Fi/ESP32 controller can be added later with no change to screens or services.

The controller knows nothing about orders, employees or PINs. It only pulses a channel. All rules live in `unlockService`.

### 5.2 Serial handling (improvements over the current draft)

The protocol in `CLAUDE.md` stays as is. The client gets stricter:

| Gap in `ArduinoPulser.kt` today | Change |
|---|---|
| Sends the command and never reads the reply, so a pulse is assumed to have worked. | Read lines; `unlock()` resolves only on `OK P<n>`, rejects on `ERR`, times out after about 1.5 s. |
| Fixed 2-second wait after opening the port. | Wait for the `READY` line; fall back to 2 s if it does not arrive. |
| Takes the first USB serial device it finds. | Match the Arduino's vendor/product ID (genuine Uno and the common CH340 clone). |
| Asks for USB permission each time the cable is plugged in. | Add a USB device filter so Android offers "always open this app for this device". |
| No reconnect. | Listen for attach/detach; reconnect automatically; show a status chip in the app bar. |
| Concurrent writes possible. | One command in flight at a time, queued. |

No sketch change is required for this phase. The sketch already supports everything above.

### 5.3 The unlock rule (what "tied to an order" means)

"An order exists" is not enough on its own: one order could be used to unlock every machine all day. The rule needs a quantity.

**Confirmed:** each load on an order allows one washer unlock and one dryer unlock. An order for 3 loads can unlock a washer 3 times and a dryer 3 times.

- A free promo load still counts as a load.
- Payment is not a condition. A pay-later or part-paid order unlocks the same as a paid one.
- An unlock is allowed when: the order exists and is not voided, the order's status is not `COMPLETED` or `AUDITED`, the machine is enabled and its type has allowance left on that order, and the controller is `ready`.
- Orders imported from the old app with `WASH` or `WASH_DRY` get no allowance. They are history, not live work.
- Allowance is used up only when the Arduino replies `OK`. A timeout does not use allowance but is logged.
- Anything outside the allowance needs the owner PIN (5.4).
- `unlockPolicy.ts` returns either "allowed" or a specific reason ("No dryer unlocks left on this order"), and the screen shows that reason.

### 5.4 Owner-PIN override

- For rewashes, stuck doors, maintenance, or a load that needs a second cycle.
- Flow: pick machine → "Override" → choose a reason (Rewash, Stuck door, Maintenance, Other + note) → optionally link an order → owner enters PIN → unlock.
- The PIN is separate from the login password, 4–6 digits, stored as a salted hash, set during first-run setup, changeable only by the owner.
- Five wrong attempts locks overrides for 5 minutes. Wrong attempts are logged.
- The employee who was logged in and the fact that the owner PIN authorised it are both recorded.

### 5.5 The unlock log

`machine_unlocks`, append-only:

| Field | Notes |
|---|---|
| id, at | timestamp from the tablet clock |
| machineId, hardwareChannel | channel is stored too, in case the machine is re-wired later |
| orderId | null for an override with no order |
| employeeUserId | who was logged in |
| kind | `ORDER`, `OVERRIDE`, `OVERRIDE_DENIED` (wrong PIN), `TEST` |
| overrideReason, overrideNote | overrides only |
| result | `ACKED`, `REJECTED`, `TIMEOUT`, `NOT_CONNECTED` |

- Written in two steps: insert the row as pending before sending, update it with the result after. If the app dies in between, the row remains and shows as unresolved.
- No screen can edit or delete rows. Rows are included in backups.
- Owner view (Machines → Log): filter by date, machine, employee, kind; highlights overrides, timeouts, unlocks on unpaid orders and unlocks on orders later voided.

### 5.6 Closing the obvious loopholes

- **Create order, unlock, delete order.** Orders are voided, never deleted. A voided order keeps its unlock log entries, and those entries are flagged in the owner view.
- **Fake pay-later order.** Unpaid orders can unlock, by your decision, so this stays possible. The control is review: unpaid orders with unlocks are flagged in the owner view, and an order cannot be removed, only voided by an admin or the owner with a reason.
- **Unplugging the Arduino.** Locks are fail-secure (locked without power), so this gains nothing. Disconnects are visible in the status chip.
- **Machine settings.** Adding machines, changing channels, test pulses and the "simulate hardware" switch are owner-only.

Limits to be honest about: the app cannot know whether a door actually opened or re-locked, or whether a machine is running. That needs the door sensors and current sensing listed as later upgrades in `CLAUDE.md`. Until then the log is evidence for review, not proof.

### 5.7 Screens

- **Machines tab** (everyone): grid of machines by type, showing name, last unlock time and order, and connection status. Tapping a machine offers "Unlock for order…" (lists open orders with allowance left for that machine type) and "Override".
- **Order details**: a Machines section showing allowance used and remaining ("Washer 1 of 2, Dryer 0 of 2"), an "Unlock machine" button that lists free machines of the needed type, and that order's unlock history.
- **After creating an order**: the confirmation offers "Unlock a washer now" so the common path is two taps.
- **Settings → Machines** (owner): machine list editor, connection status and reconnect, test pulse per machine (logged as `TEST`), simulate-hardware switch, change owner PIN.

---

## 6. Moving existing data across

The old app's "Export Data" produces one JSON file with `customers`, `expenses`, `inventoryItems`, `transactions`, `users`. The new app gets a **legacy import** that reads this file:

- Convert pesos (floating point) to centavos, rounding to the nearest centavo.
- Each old transaction becomes one `orders` row, plus one `payments` row if `amountPaid > 0` (dated `datePaid` if present, otherwise `datePlaced`, with the stored channel and reference).
- The old add-ons text is kept as a note on the order. It cannot be reliably split back into items.
- Normalise channel and status text. Keep original IDs.
- Users are imported without passwords; the owner sets new passwords after import. (The old file contains them in plain text, and they should not be carried forward.)
- Old `WASH` and `WASH_DRY` orders are imported with their original service and totals, as read-only history.
- The price per load and custom statuses are not in the old file and are re-entered in Settings once.
- The import runs in a single database transaction and reports counts before committing, so a bad file changes nothing.

The new app's own backup format is versioned and includes every table, including machines and the unlock log.

---

## 7. Milestones

Each milestone ends with a commit and push, per `CLAUDE.md`. "Done when" is the acceptance test.

### Phase 0: Foundations and hardware spike
1. Create the Expo project at the repo root, TypeScript strict, ESLint, Prettier, Jest. Build a development APK and install it on the tablet.
2. Spike USB: minimal local module, one screen with six buttons that pulse the LEDs and show `OK`/`ERR`.
3. Spike printing: print a test receipt on the real Bluetooth printer.
4. Record the outcomes (library choices, tablet Android version, Expo SDK version) in `CLAUDE.md`.

Done when: the tablet lights each LED from the app and prints a test receipt. If either spike fails, the fallback in section 2 is used before going further.

### Phase 1: Data and domain layer
1. Drizzle schema and first migration for every table in section 4.
2. Domain functions with unit tests: load range, order total, promo, loyalty update, payment capping, stock consumption, ID formatting, role permissions.
3. Repositories and `orderService.createOrder` as a single database transaction.

Done when: unit tests pass and cover every rule in 1.2, using values checked against the old code.

### Phase 2: Core POS screens
1. First-run setup (owner account + PIN), login, session restore, logout.
2. Tab shell with role-based tabs; New Order button in the app bar.
3. Customers (list, search, add, edit, delete, promo progress, history).
4. New Order form (customer search with quick-create, weight and loads, add-ons, promo banner, payment method/channel, GCash reference, cash change, owner backdating).
5. Transactions list with all filters; order details with status update and receive payment; void with reason.
6. Dashboard.

Done when: a complete order can be taken, paid in two parts, moved through statuses and voided, and the numbers match the same order entered in the old app.

### Phase 3: Remaining POS features
1. Inventory (add, restock, consume, auto-consume, add-on price, low-stock badge and login alert).
2. Staff management with the owner/admin role rules.
3. Expenses and Reports (Summary, Yearly, Full Analysis, share as text).
4. Settings (price per load, statuses, receipt header and footer).
5. Receipt printing wired to order creation and reprint; printer selection.
6. Backup export/import and legacy import.

Done when: every row in table 1.1 works on the tablet, and a real export from the old app imports cleanly with matching totals.

### Phase 4: Machine integration (LED prototype)
1. `machines` and `machine_unlocks` tables. Before seeding, settle the open question in section 11: how many washers and dryers, and which channel each is on. Until then the table starts empty and machines are added in Settings.
2. `MachineController` interface, `protocol.ts`, `MockMachineController`, with tests.
3. `UsbSerialMachineController` on the module from Phase 0, with reply reading, `READY` wait, reconnect and command queue.
4. `unlockPolicy` and `unlockService` with tests for every allow/deny case in 5.3.
5. Owner PIN verification, lockout, override flow.
6. Machines tab, order-details section, post-order shortcut, Settings → Machines, owner log view.

Done when, on the tablet with the LED board:
- An unpaid (pay-later) order for 2 loads lights exactly 2 washer LEDs and 2 dryer LEDs, then refuses a third of either with a clear message.
- With no order selected, nothing can be pulsed without the owner PIN.
- An override with the correct PIN pulses and is logged with its reason; a wrong PIN is logged and five in a row locks overrides.
- Unplugging the cable shows "disconnected" and unlock attempts are logged as `NOT_CONNECTED`; plugging it back reconnects without restarting the app.
- Every pulse in the test session appears in the log with time, machine, order and employee.

### Phase 5: Hardening and cutover
1. Release build (signed APK), installed alongside the old app (different application ID).
2. Run both apps side by side for a few days of real orders; compare daily totals.
3. Final export from the old app → legacy import → retire the old app.
4. Short written guide for staff and for the owner (PIN, overrides, reading the log, backups).

Done when: the shop runs a full day on the new app only.

### Later (not in this plan's scope)
- Real locks: change `PULSE_MS` in the sketch to 3–5 s once relays and solenoids are fitted. No app change.
- Door sensors, current sensing, off-device logs, Wi-Fi/ESP32 controller, as listed in `CLAUDE.md`.

---

## 8. Testing approach

- **Domain rules:** unit tests, written before the screens, with expected values taken from the old code's behaviour.
- **Unlock rules:** table-driven tests over loads × machine type × prior unlocks × order state, including a check that payment state makes no difference.
- **Protocol:** tests for encoding and for parsing `READY`, `OK P3`, `ERR x`, partial lines and noise.
- **Services:** run against an in-memory SQLite database with `MockMachineController` and `MockReceiptPrinter`.
- **Screens:** a few flow tests (create order, receive payment, unlock) with React Native Testing Library.
- **Hardware:** the manual checklists under Phases 0 and 4, run on the actual tablet, Arduino and printer.

---

## 9. Risks

| Risk | Mitigation |
|---|---|
| USB or Bluetooth library does not work on the tablet or with the current React Native architecture. | Phase 0 proves both on real hardware before any feature work; fallbacks named in section 2. |
| The tablet has one USB port: with the Arduino on OTG it cannot charge. | Use a powered OTG hub or OTG+charge adapter; test in Phase 0. Worth raising with your dad when he plans the hardware. |
| Arduino resets every time the port opens, so a reconnect costs about 2 s. | Keep the port open for the life of the app; reconnect only on detach. |
| Tablet clock is wrong or changed, making log timestamps unreliable. | Log rows also carry an increasing sequence number so order of events is preserved. |
| Data loss on the single tablet. | Reminder to export a backup; off-device logs are a listed later upgrade. |
| Staff find the unlock step slow and prop doors open. | Two-tap path after order creation; this is also where door sensors would later help. |

---

## 10. What changes in `CLAUDE.md` as work proceeds

- Phase 0: record Expo SDK version, chosen USB and printer libraries, build commands.
- When the module is created: update the path of `ArduinoPulser.kt`.
- Phase 4: mark machine integration as implemented and describe the unlock allowance rule.
- If the serial protocol ever changes: sketch, client and `CLAUDE.md` in the same commit (already a rule).

---

## 11. Decisions and open questions

Answered on 2026-11-12:

| # | Topic | Decision |
|---|---|---|
| Q1 | Payment before unlock | Not required. Any existing order can unlock, paid or not. Unlocks on unpaid orders are flagged for the owner. |
| Q3 | Services and allowance | Wash-Dry-Fold is the only service. Each load allows one washer unlock and one dryer unlock. Extra cycles go through the owner PIN. |
| Q4 | Who may void an order | Admin and owner, with a required reason. |
| Q5 | Revenue date | Counted on the day it was paid, with the placed date shown alongside (section 4.1). |
| Q6 | Background sync | Not in use. Dropped. |
| Q7 | Override | Owner PIN only. Admins cannot override. |
| Q8 | GCash QR | Placeholder image kept for now. |
| Q9 | Receipt text | Keep "AR LAUNDRY SHOP" and the current footer. |

Still open:

| # | Question | When it is needed |
|---|---|---|
| Q2 | How many washers and dryers are there, and which Arduino channel is each on? | Start of Phase 4. Nothing before that depends on it. |
