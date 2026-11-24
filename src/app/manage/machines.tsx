import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import type { MachineCycleRow, MachineRow } from '@/db/schema';
import { can } from '@/domain/permissions';
import {
  MACHINE_TYPE_LABELS,
  MACHINE_TYPES,
  RUN_MINUTES_LIMITS,
  TOP_UP_CHOICES,
  topUpOptions,
  topUpPulseCountFor,
  type MachineType,
  type TopUpMinutes,
  type TopUpPrices,
  type TopUpPulses,
} from '@/domain/machinePolicy';
import { centavosToInput, formatPeso, parsePesoInput } from '@/domain/money';
import { STATUS_LABELS } from '@/machines/MachineController';
import { channelTerminal, MAX_CHANNEL, MIN_KEY_LENGTH, normalizeAddress, pulsesProblem } from '@/machines/protocol';
import { changeOwnerPin } from '@/services/auth';
import {
  addMachine,
  applyPulsesToMachines,
  applyTopUpPricesToDryers,
  listMachines,
  RESULT_MESSAGES,
  saveLockController,
  setMultiCycle,
  setReceiptScanRequired,
  setSimulateMachines,
  testStart,
  updateMachine,
} from '@/services/machines';
import { listCycles, updateCycles } from '@/services/cycles';
import { getSetting } from '@/services/settings';
import { useActor, useApp } from '@/state/AppProvider';
import { useAction, useData } from '@/state/hooks';
import { useToast } from '@/state/toast';
import { Button } from '@/ui/Button';
import { Badge, Choice, Dialog, Toggle } from '@/ui/controls';
import { EmptyState, ListRow, Notice, Panel, Row, Screen, Section } from '@/ui/layout';
import { AddCycleDialog, CycleTable, draftsProblem, toDraft, toEdits, type CycleDraft } from '@/ui/machines/CycleSettings';
import { useCyclePicker } from '@/ui/machines/MachineDialogs';
import { MachineOverview } from '@/ui/machines/MachineOverview';
import { ManageScreen } from '@/ui/ManagerGate';
import { Text } from '@/ui/Text';
import { TextField } from '@/ui/TextField';
import { space } from '@/ui/theme';

function pulseSummary(machine: MachineRow): string {
  return `${machine.pulseCount} × ${machine.pulseOnMs} ms on, ${machine.pulseOffMs} ms off`;
}

function topUpSummary(prices: TopUpPrices): string {
  const options = topUpOptions(prices);
  return options.length === 0
    ? 'no top-ups'
    : `top-ups ${options.map((o) => `${o.minutes} min ${formatPeso(o.price)}`).join(', ')}`;
}

/** `cycles`: the washer's cycles that are switched on, when Multi-cycle is on; empty otherwise. */
function machineSummary(machine: MachineRow, cycles: readonly MachineCycleRow[]): string {
  const topUp = machine.type === 'DRYER' ? ` · ${topUpSummary(machine)}` : '';
  if (cycles.length > 0) {
    const list = cycles.map((cycle) => `${cycle.name} ${cycle.pulses}× ${cycle.minutes} min`).join(', ');
    return `${list} · ${machine.pulseOnMs} ms on, ${machine.pulseOffMs} ms off${topUp}`;
  }
  return `${machine.runMinutes} min run · ${pulseSummary(machine)}${topUp}`;
}

/** Blank means 0, which switches that top-up length off. */
function priceInput(text: string): number | null {
  return text.trim() === '' ? 0 : parsePesoInput(text);
}

export default function MachineSettings() {
  const actor = useActor();
  const [changingPin, setChangingPin] = useState(false);
  return (
    <ManageScreen title="Machines" allowed={can.viewMachineSettings}>
      <Screen>
        {can.manageMachines(actor.role) ? <MachineSetup /> : <MachineOverview />}
        <Section title="Owner PIN" description="Needed for every override. Change it if anyone else may have seen it.">
          <Button label="Change owner PIN" kind="secondary" icon="shield-key-outline" onPress={() => setChangingPin(true)} />
        </Section>
      </Screen>
      {changingPin && <PinDialog onClose={() => setChangingPin(false)} />}
    </ManageScreen>
  );
}

/** The developer's full machine setup: connection, wiring, signals, cycles and tests. */
function MachineSetup() {
  const actor = useActor();
  const { controller, controllerState, reloadLockController } = useApp();
  const action = useAction();
  const toast = useToast();
  const [editing, setEditing] = useState<MachineRow | 'new' | null>(null);
  const machines = useData(listMachines);
  const simulate = useData((c) => getSetting(c.db, 'simulateMachines'));
  const receiptScan = useData((c) => getSetting(c.db, 'requireReceiptScan'));
  const multiCycle = useData((c) => getSetting(c.db, 'multiCycle'));
  const cyclesFor = useCyclePicker();
  const saved = useData((c) => ({
    address: getSetting(c.db, 'lockControllerAddress'),
    key: getSetting(c.db, 'lockControllerKey'),
  }));
  const [address, setAddress] = useState(saved.address);
  const [key, setKey] = useState(saved.key);
  const changed = address.trim() !== saved.address || key !== saved.key;
  const addressError = address.trim() !== '' && normalizeAddress(address) === null;

  async function saveConnection() {
    const result = await action.run((c) => saveLockController(c, actor, { address, key }));
    if (result.ok) {
      reloadLockController();
      toast('Machine controller settings saved');
    }
  }

  async function test(machine: MachineRow) {
    const result = await action.run((c) => testStart(c, controller, actor, machine.id));
    if (result.ok) {
      toast(
        result.value === 'acked'
          ? `${machine.name}: test pulses sent (${pulseSummary(machine)})`
          : `${machine.name}: ${RESULT_MESSAGES[result.value]}`,
        result.value === 'acked' ? 'success' : 'danger',
      );
    }
  }

  return (
    <>
      <Section title="Machine controller">
        <Row wrap>
          <Text style={{ flex: 1 }}>
            {`${STATUS_LABELS[controllerState.status]}${controllerState.detail ? `. ${controllerState.detail}` : ''}`}
          </Text>
          <Button label="Check connection" kind="secondary" icon="wifi" onPress={() => void controller.connect()} />
        </Row>
        <TextField
          label="Address"
          value={address}
          onChangeText={setAddress}
          placeholder="192.168.1.50"
          autoCapitalize="none"
          keyboardType="url"
          hint="The machine controller shows it on the serial monitor when it starts. Reserve it in the router so it stays the same."
          error={addressError ? 'Enter an address like 192.168.1.50.' : null}
        />
        <TextField
          label="Key"
          value={key}
          onChangeText={setKey}
          autoCapitalize="none"
          secureTextEntry
          hint={`The same passphrase as LOCK_KEY on the machine controller, at least ${MIN_KEY_LENGTH} characters. Anyone who knows it can start machines.`}
        />
        <Button
          label="Save controller settings"
          onPress={saveConnection}
          busy={action.busy}
          disabled={!changed || addressError}
        />
        <Toggle
          label="Simulate machines"
          description="For demos and training: starts are recorded but nothing is sent to the machine controller."
          value={simulate}
          onChange={async (value) => {
            const result = await action.run((c) => setSimulateMachines(c, actor, value));
            if (result.ok) reloadLockController();
          }}
        />
        <Toggle
          label="Scan receipt to run a machine"
          description={
            receiptScan
              ? "Staff scan the QR code on the order's receipt before a machine runs. The receipt allows one washer and one dryer per load."
              : 'Off: staff pick the order from a list, with no receipt needed. Anyone at the tablet can run a machine for any open order.'
          }
          value={receiptScan}
          onChange={(value) => void action.run((c) => setReceiptScanRequired(c, actor, value))}
        />
      </Section>

      <Section
        title="Machines"
        description={`Each machine's channel (1 to ${MAX_CHANNEL}) is the machine controller terminal it is wired to. A start sends that machine's pulses.`}
        action={<Button label="Add machine" icon="plus" onPress={() => setEditing('new')} />}
      >
        <Toggle
          label="Multi-cycle"
          description={
            multiCycle
              ? 'Staff pick a cycle before a washer runs. Each washer\'s settings list its cycles: tick the ones to offer, change their pulses and minutes, or add your own. Dryers keep one start and their top-ups.'
              : 'Off: every start sends the machine\'s one pulse count. Turn on to give each washer cycles (Delicates, Light, Medium, Heavy and any you add).'
          }
          value={multiCycle}
          onChange={(value) => void action.run((c) => setMultiCycle(c, actor, value))}
        />
        <Panel>
          {machines.length === 0 ? (
            <EmptyState icon="washing-machine" title="No machines yet" body="Add each washer and dryer once it is wired to the controller." />
          ) : (
            machines.map((machine, index) => (
              <ListRow
                key={machine.id}
                title={machine.name}
                subtitle={`${MACHINE_TYPE_LABELS[machine.type]} · channel ${machine.hardwareChannel} (${
                  channelTerminal(machine.hardwareChannel) ?? 'not on the board'
                }) · ${machineSummary(machine, cyclesFor(machine))}`}
                right={
                  <Row>
                    {!machine.enabled && <Badge label="Off" tone="warning" />}
                    <Button label="Test" kind="quiet" onPress={() => void test(machine)} />
                  </Row>
                }
                onPress={() => setEditing(machine)}
                last={index === machines.length - 1}
              />
            ))
          )}
        </Panel>
        {action.error && <Notice tone="danger">{action.error}</Notice>}
      </Section>
      {editing && (
        <MachineDialog
          machine={editing === 'new' ? null : editing}
          machines={machines}
          multiCycle={multiCycle}
          nextChannel={machines.reduce((max, m) => Math.max(max, m.hardwareChannel), 0) + 1}
          onClose={() => setEditing(null)}
        />
      )}
    </>
  );
}

type PulseTargets = 'this' | 'all' | 'selected';

function MachineDialog({
  machine,
  machines,
  multiCycle,
  nextChannel,
  onClose,
}: {
  machine: MachineRow | null;
  machines: readonly MachineRow[];
  multiCycle: boolean;
  nextChannel: number;
  onClose: () => void;
}) {
  const actor = useActor();
  const action = useAction();
  const [name, setName] = useState(machine?.name ?? '');
  const [type, setType] = useState<MachineType>(machine?.type ?? 'WASHER');
  const [channelText, setChannelText] = useState(String(machine?.hardwareChannel ?? nextChannel));
  const [enabled, setEnabled] = useState(machine?.enabled ?? true);
  const [countText, setCountText] = useState(String(machine?.pulseCount ?? 1));
  const [onText, setOnText] = useState(String(machine?.pulseOnMs ?? 500));
  const [offText, setOffText] = useState(String(machine?.pulseOffMs ?? 500));
  const [runText, setRunText] = useState(String(machine?.runMinutes ?? 40));
  // Cycles are set on a saved washer: a new one gets the four starting cycles when it is added.
  const cyclesOn = multiCycle && type === 'WASHER' && machine !== null && machine.type === 'WASHER';
  const storedCycles = useData(
    (c) => (machine ? listCycles(c).filter((cycle) => cycle.machineId === machine.id) : []),
    [machine?.id],
  );
  const [cycleEdits, setCycleEdits] = useState<Record<number, CycleDraft>>({});
  const drafts = storedCycles.map((cycle) => cycleEdits[cycle.id] ?? toDraft(cycle));
  // With every cycle unticked the washer starts with its own pulse count and run time.
  const usesOwnStart = !cyclesOn || !drafts.some((draft) => draft.enabled);
  const [addingCycle, setAddingCycle] = useState(false);
  const [pulseTexts, setPulseTexts] = useState<Record<TopUpMinutes, string>>(() => ({
    5: String(machine?.topUpPulseCount ?? 1),
    10: String(machine?.topUpPulses10 ?? 2),
    15: String(machine?.topUpPulses15 ?? 3),
    20: String(machine?.topUpPulses20 ?? 4),
  }));
  const [priceTexts, setPriceTexts] = useState<Record<TopUpMinutes, string>>(() => ({
    5: centavosToInput(machine?.topUpPrice ?? 0),
    10: centavosToInput(machine?.topUpPrice10 ?? 0),
    15: centavosToInput(machine?.topUpPrice15 ?? 0),
    20: centavosToInput(machine?.topUpPrice20 ?? 0),
  }));
  const pulses = { count: Number(countText), onMs: Number(onText), offMs: Number(offText) };
  const pulseError = pulsesProblem(pulses);
  const runMinutes = Number(runText);
  const runError =
    Number.isInteger(runMinutes) && runMinutes >= RUN_MINUTES_LIMITS.min && runMinutes <= RUN_MINUTES_LIMITS.max
      ? null
      : `Enter ${RUN_MINUTES_LIMITS.min} to ${RUN_MINUTES_LIMITS.max} minutes.`;
  const dryer = type === 'DRYER';
  const parsedPrices = TOP_UP_CHOICES.map((minutes) => priceInput(priceTexts[minutes]));
  const topUpPrices: TopUpPrices = {
    topUpPrice: parsedPrices[0] ?? 0,
    topUpPrice10: parsedPrices[1] ?? 0,
    topUpPrice15: parsedPrices[2] ?? 0,
    topUpPrice20: parsedPrices[3] ?? 0,
  };
  const topUpPriceError =
    dryer && parsedPrices.some((price) => price === null) ? 'Enter prices like 20 or 20.50, or leave blank.' : null;
  const topUpPulses: TopUpPulses = {
    topUpPulseCount: Number(pulseTexts[5]),
    topUpPulses10: Number(pulseTexts[10]),
    topUpPulses15: Number(pulseTexts[15]),
    topUpPulses20: Number(pulseTexts[20]),
  };
  // Only the lengths on offer (with a price) have to send a valid number of pulses.
  const topUpPulseError = !dryer
    ? null
    : (topUpOptions(topUpPrices)
        .map((option) => {
          const problem = pulsesProblem({ ...pulses, count: topUpPulseCountFor(topUpPulses, option.minutes) });
          return problem ? `${option.minutes} minutes: ${problem}` : null;
        })
        .find((problem) => problem !== null) ?? null);
  const cycleError = cyclesOn ? draftsProblem(drafts, pulses.onMs, pulses.offMs) : null;
  const invalid =
    cycleError !== null ||
    (usesOwnStart && (pulseError !== null || runError !== null)) ||
    pulsesProblem({ ...pulses, count: 1 }) !== null ||
    topUpPulseError !== null ||
    topUpPriceError !== null;
  const digits = (set: (value: string) => void) => (text: string) => set(text.replace(/\D/g, ''));
  const others = machines.filter((m) => m.id !== machine?.id);
  const [targets, setTargets] = useState<PulseTargets>('this');
  const [selected, setSelected] = useState<ReadonlySet<number>>(new Set());
  const copyTo = targets === 'all' ? others.map((m) => m.id) : targets === 'selected' ? [...selected] : [];
  const otherDryers = others.filter((m) => m.type === 'DRYER');
  const [priceTargets, setPriceTargets] = useState<PulseTargets>('this');
  const [priceSelected, setPriceSelected] = useState<ReadonlySet<number>>(new Set());
  const priceCopyTo = !dryer
    ? []
    : priceTargets === 'all'
      ? otherDryers.map((m) => m.id)
      : priceTargets === 'selected'
        ? [...priceSelected]
        : [];

  function togglePriceSelected(id: number, on: boolean) {
    const next = new Set(priceSelected);
    if (on) next.add(id);
    else next.delete(id);
    setPriceSelected(next);
  }

  function toggleSelected(id: number, on: boolean) {
    const next = new Set(selected);
    if (on) next.add(id);
    else next.delete(id);
    setSelected(next);
  }

  async function save() {
    const input = {
      name,
      type,
      hardwareChannel: Number(channelText),
      enabled,
      pulseCount: pulses.count,
      pulseOnMs: pulses.onMs,
      pulseOffMs: pulses.offMs,
      runMinutes,
      ...topUpPulses,
      ...topUpPrices,
    };
    const result = await action.run((c) =>
      c.db.transaction((tx) => {
        const txCtx = { ...c, db: tx };
        if (machine) updateMachine(txCtx, actor, machine.id, input);
        else addMachine(txCtx, actor, input);
        applyPulsesToMachines(txCtx, actor, pulses, copyTo);
        if (cyclesOn && machine) updateCycles(txCtx, actor, machine.id, toEdits(drafts));
        applyTopUpPricesToDryers(txCtx, actor, topUpPrices, priceCopyTo);
      }),
    );
    if (result.ok) onClose();
  }

  return (
    <Dialog
      visible
      title={machine ? `Edit ${machine.name}` : 'Add machine'}
      onClose={onClose}
      actions={
        <>
          <Button label="Cancel" kind="secondary" onPress={onClose} />
          <Button label={machine ? 'Save changes' : 'Add machine'} onPress={save} busy={action.busy} disabled={invalid} />
        </>
      }
    >
      <TextField label="Name" value={name} onChangeText={setName} placeholder="Washer 1" autoCapitalize="words" />
      <Choice label="Type" value={type} onChange={setType} options={MACHINE_TYPES.map((t) => ({ value: t, label: MACHINE_TYPE_LABELS[t] }))} />
      <TextField
        label="Channel"
        value={channelText}
        onChangeText={(text) => setChannelText(text.replace(/\D/g, ''))}
        keyboardType="number-pad"
        hint={
          channelTerminal(Number(channelText)) === null
            ? `A number from 1 to ${MAX_CHANNEL}.`
            : `Wire this machine to terminal ${channelTerminal(Number(channelText))} on the machine controller.`
        }
      />
      <Text variant="label">Start pulses</Text>
      <Text tone="muted">
        {cyclesOn
          ? `Each cycle sends its own number of pulses of ${pulses.onMs || '?'} ms with ${pulses.offMs || '?'} ms between them, like coins in the slot.`
          : `A start sends ${pulses.count || '?'} pulse${pulses.count === 1 ? '' : 's'} of ${pulses.onMs || '?'} ms with ${pulses.offMs || '?'} ms between them, like coins in the slot.`}
      </Text>
      {cyclesOn && (
        <CycleTable
          drafts={drafts}
          onChange={(draft) => setCycleEdits({ ...cycleEdits, [draft.id]: draft })}
          onAdd={() => setAddingCycle(true)}
        />
      )}
      {cycleError && <Text tone="danger">{cycleError}</Text>}
      {multiCycle && type === 'WASHER' && !machine && (
        <Text tone="muted">
          A new washer gets Delicates, Light, Medium and Heavy with the pulses and run time below. Open it again after
          adding to change them or add your own.
        </Text>
      )}
      <Row wrap style={{ alignItems: 'flex-start' }}>
        {usesOwnStart && (
          <TextField label="Number of pulses" value={countText} onChangeText={digits(setCountText)} keyboardType="number-pad" style={{ flex: 1 }} />
        )}
        <TextField label="Pulse length (ms)" value={onText} onChangeText={digits(setOnText)} keyboardType="number-pad" style={{ flex: 1 }} />
        <TextField label="Gap (ms)" value={offText} onChangeText={digits(setOffText)} keyboardType="number-pad" style={{ flex: 1 }} />
      </Row>
      {usesOwnStart && pulseError && <Text tone="danger">{pulseError}</Text>}
      {others.length > 0 && (
        <Choice
          label="Use these pulses on"
          value={targets}
          onChange={setTargets}
          options={[
            { value: 'this', label: 'This machine only' },
            { value: 'all', label: `All machines (${others.length + 1})` },
            { value: 'selected', label: 'Selected machines' },
          ]}
        />
      )}
      {targets === 'selected' &&
        others.map((other) => (
          <Toggle
            key={other.id}
            label={other.name}
            description={`${MACHINE_TYPE_LABELS[other.type]} · now ${pulseSummary(other)}`}
            value={selected.has(other.id)}
            onChange={(on) => toggleSelected(other.id, on)}
          />
        ))}
      {copyTo.length > 0 && (
        <Text tone="muted">
          {`Saving also gives ${copyTo.length} other machine${copyTo.length === 1 ? '' : 's'} these start pulses. Their cycles, run times and top-up settings stay as they are.`}
        </Text>
      )}
      {usesOwnStart && (
        <TextField
          label="Run time (minutes)"
          value={runText}
          onChangeText={digits(setRunText)}
          keyboardType="number-pad"
          hint="How long one start runs. The Machines tab counts it down and keeps the machine in use until then."
          error={runText !== '' ? runError : null}
        />
      )}
      {dryer && (
        <>
          <Text variant="label">Top-ups</Text>
          <Text tone="muted">
            {"For damp laundry, while the dryer is running: staff pick 5, 10, 15 or 20 more minutes and the price goes on the order's bill. Each length sends its own number of pulses (same length and gap as a start). Leave a price blank or 0 to not offer that length."}
          </Text>
          <View style={styles.cycleTable}>
            <Row>
              <Text variant="label" style={styles.cycleName}>
                Extra time
              </Text>
              <Text variant="label" style={styles.flex}>
                Pulses
              </Text>
              <Text variant="label" style={styles.flex}>
                Price
              </Text>
            </Row>
            {TOP_UP_CHOICES.map((minutes) => (
              <Row key={minutes}>
                <Text style={styles.cycleName}>{`${minutes} minutes`}</Text>
                <TextField
                  label={`${minutes} minute top-up pulses`}
                  hideLabel
                  value={pulseTexts[minutes]}
                  onChangeText={(text) => setPulseTexts({ ...pulseTexts, [minutes]: text.replace(/\D/g, '') })}
                  keyboardType="number-pad"
                  style={styles.flex}
                />
                <TextField
                  label={`${minutes} minute top-up price`}
                  hideLabel
                  value={priceTexts[minutes]}
                  onChangeText={(text) => setPriceTexts({ ...priceTexts, [minutes]: text })}
                  keyboardType="decimal-pad"
                  prefix="₱"
                  style={styles.flex}
                />
              </Row>
            ))}
          </View>
          {topUpPulseError && <Text tone="danger">{`Top-up: ${topUpPulseError}`}</Text>}
          {topUpPriceError && <Text tone="danger">{topUpPriceError}</Text>}
          {otherDryers.length > 0 && (
            <Choice
              label="Use these top-up prices on"
              value={priceTargets}
              onChange={setPriceTargets}
              options={[
                { value: 'this', label: 'This dryer only' },
                { value: 'all', label: `All dryers (${otherDryers.length + 1})` },
                { value: 'selected', label: 'Selected dryers' },
              ]}
            />
          )}
          {priceTargets === 'selected' &&
            otherDryers.map((other) => (
              <Toggle
                key={other.id}
                label={other.name}
                description={`Now ${topUpSummary(other)}`}
                value={priceSelected.has(other.id)}
                onChange={(on) => togglePriceSelected(other.id, on)}
              />
            ))}
          {priceCopyTo.length > 0 && (
            <Text tone="muted">
              {`Saving also gives ${priceCopyTo.length} other dryer${priceCopyTo.length === 1 ? '' : 's'} these top-up prices. Their top-up pulses stay as they are.`}
            </Text>
          )}
        </>
      )}
      <Toggle
        label="In use"
        description="Switch off while a machine is broken so nobody can start it. An order whose start did not go out is taken off it."
        value={enabled}
        onChange={setEnabled}
      />
      {action.error && <Notice tone="danger">{action.error}</Notice>}
      {addingCycle && machine && (
        <AddCycleDialog
          machine={machine}
          washers={machines.filter((m) => m.type === 'WASHER')}
          onClose={() => setAddingCycle(false)}
        />
      )}
    </Dialog>
  );
}

function PinDialog({ onClose }: { onClose: () => void }) {
  const actor = useActor();
  const action = useAction();
  const toast = useToast();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const digits = (set: (value: string) => void) => (text: string) => set(text.replace(/\D/g, ''));
  return (
    <Dialog
      visible
      title="Change owner PIN"
      onClose={onClose}
      actions={
        <>
          <Button label="Cancel" kind="secondary" onPress={onClose} />
          <Button
            label="Save new PIN"
            busy={action.busy}
            onPress={async () => {
              const result = await action.run((c) => changeOwnerPin(c, actor, current, next));
              if (result.ok) {
                toast('Owner PIN changed');
                onClose();
              }
            }}
          />
        </>
      }
    >
      <TextField label="Current PIN" value={current} onChangeText={digits(setCurrent)} keyboardType="number-pad" secureTextEntry maxLength={6} />
      <TextField label="New PIN" value={next} onChangeText={digits(setNext)} keyboardType="number-pad" secureTextEntry maxLength={6} hint="4 to 6 digits." />
      {action.error && <Notice tone="danger">{action.error}</Notice>}
    </Dialog>
  );
}

const styles = StyleSheet.create({
  cycleTable: { gap: space.sm },
  cycleName: { width: 110 },
  flex: { flex: 1 },
});
