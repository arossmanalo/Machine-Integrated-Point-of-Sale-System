import { useState } from 'react';

import type { DryerTopUpRow, MachineCycleRow, MachineRow } from '@/db/schema';
import { can } from '@/domain/permissions';
import {
  MACHINE_TYPE_LABELS,
  MACHINE_TYPES,
  RUN_MINUTES_LIMITS,
  type MachineType,
} from '@/domain/machinePolicy';
import { formatPeso } from '@/domain/money';
import { STATUS_LABELS } from '@/machines/MachineController';
import { channelTerminals, MAX_CHANNEL, MIN_KEY_LENGTH, normalizeAddress, pulsesProblem } from '@/machines/protocol';
import { changeOwnerPin } from '@/services/auth';
import {
  addMachine,
  applyPulsesToMachines,
  listMachines,
  removeMachine,
  RESULT_MESSAGES,
  saveLockController,
  setMultiCycle,
  setRealTimeSync,
  setReceiptScanRequired,
  setSimulateMachines,
  testStart,
  updateMachine,
} from '@/services/machines';
import { listCycles, updateCycles } from '@/services/cycles';
import { getSetting } from '@/services/settings';
import { listTopUps, updateTopUps } from '@/services/topUps';
import { useActor, useApp } from '@/state/AppProvider';
import { useAction, useData } from '@/state/hooks';
import { useToast } from '@/state/toast';
import { Button } from '@/ui/Button';
import { Badge, Choice, Dialog, Toggle } from '@/ui/controls';
import { EmptyState, ListRow, Notice, Panel, Row, Screen, Section } from '@/ui/layout';
import { AddCycleDialog, CycleTable, draftsProblem, toDraft, toEdits, type CycleDraft } from '@/ui/machines/CycleSettings';
import { useCyclePicker } from '@/ui/machines/MachineDialogs';
import { MachineOverview, REAL_TIME_SYNC_TEXT } from '@/ui/machines/MachineOverview';
import {
  AddTopUpDialog,
  TopUpTable,
  topUpDraftsProblem,
  toTopUpDraft,
  toTopUpEdits,
  type TopUpDraft,
} from '@/ui/machines/TopUpSettings';
import { ManageScreen } from '@/ui/ManagerGate';
import { Text } from '@/ui/Text';
import { TextField } from '@/ui/TextField';

function terminalsLabel(channel: number): string {
  const terminals = channelTerminals(channel);
  return terminals ? `${terminals.start}, signal ${terminals.signal}` : 'not on the board';
}

function wiringHint(channel: number): string {
  const terminals = channelTerminals(channel);
  if (!terminals) return `A number from 1 to ${MAX_CHANNEL}.`;
  return (
    `Wire the machine's coin input to terminal ${terminals.start} and its running signal to ` +
    `${terminals.signal} on the machine controller.`
  );
}

function pulseSummary(machine: MachineRow): string {
  return `${machine.pulseCount} × ${machine.pulseOnMs} ms on, ${machine.pulseOffMs} ms off`;
}

function topUpSummary(topUps: readonly DryerTopUpRow[]): string {
  const offered = topUps.filter((topUp) => topUp.enabled);
  return offered.length === 0
    ? 'no top-ups'
    : `top-ups ${offered.map((t) => `${t.name} ${t.minutes} min ${t.pulses}× ${formatPeso(t.price)}`).join(', ')}`;
}

/**
 * `cycles`: the washer's cycles that are switched on, when Multi-cycle is on; empty otherwise.
 * `topUps`: the dryer's top-ups.
 */
function machineSummary(
  machine: MachineRow,
  cycles: readonly MachineCycleRow[],
  topUps: readonly DryerTopUpRow[],
): string {
  const topUp = machine.type === 'DRYER' ? ` · ${topUpSummary(topUps)}` : '';
  if (cycles.length > 0) {
    const list = cycles.map((cycle) => `${cycle.name} ${cycle.pulses}× ${cycle.minutes} min`).join(', ');
    return `${list} · ${machine.pulseOnMs} ms on, ${machine.pulseOffMs} ms off${topUp}`;
  }
  return `${machine.runMinutes} min run · ${pulseSummary(machine)}${topUp}`;
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
  const realTimeSync = useData((c) => getSetting(c.db, 'realTimeSync'));
  const cyclesFor = useCyclePicker();
  const allTopUps = useData(listTopUps);
  const topUpsFor = (machine: MachineRow) => allTopUps.filter((topUp) => topUp.machineId === machine.id);
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
        <Toggle
          label="Real-time sync"
          description={`${REAL_TIME_SYNC_TEXT} Needs each machine's running signal wired to its channel's signal terminal; the app checks every 3 seconds instead of every 20.`}
          value={realTimeSync}
          onChange={async (value) => {
            const result = await action.run((c) => setRealTimeSync(c, actor, value));
            if (result.ok) reloadLockController();
          }}
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
                  terminalsLabel(machine.hardwareChannel)
                }) · ${machineSummary(machine, cyclesFor(machine), topUpsFor(machine))}`}
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
  // Top-ups are set on a saved dryer: a new one gets 5, 10, 15 and 20 minutes when it is added.
  const topUpsOn = type === 'DRYER' && machine !== null && machine.type === 'DRYER';
  const storedTopUps = useData(
    (c) => (machine ? listTopUps(c).filter((topUp) => topUp.machineId === machine.id) : []),
    [machine?.id],
  );
  const [topUpEdits, setTopUpEdits] = useState<Record<number, TopUpDraft>>({});
  const topUpDrafts = storedTopUps.map((topUp) => topUpEdits[topUp.id] ?? toTopUpDraft(topUp));
  const [addingTopUp, setAddingTopUp] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const pulses = { count: Number(countText), onMs: Number(onText), offMs: Number(offText) };
  const pulseError = pulsesProblem(pulses);
  const runMinutes = Number(runText);
  const runError =
    Number.isInteger(runMinutes) && runMinutes >= RUN_MINUTES_LIMITS.min && runMinutes <= RUN_MINUTES_LIMITS.max
      ? null
      : `Enter ${RUN_MINUTES_LIMITS.min} to ${RUN_MINUTES_LIMITS.max} minutes.`;
  const topUpError = topUpsOn ? topUpDraftsProblem(topUpDrafts, pulses.onMs, pulses.offMs) : null;
  const cycleError = cyclesOn ? draftsProblem(drafts, pulses.onMs, pulses.offMs) : null;
  const invalid =
    cycleError !== null ||
    (usesOwnStart && (pulseError !== null || runError !== null)) ||
    pulsesProblem({ ...pulses, count: 1 }) !== null ||
    topUpError !== null;
  const digits = (set: (value: string) => void) => (text: string) => set(text.replace(/\D/g, ''));
  const others = machines.filter((m) => m.id !== machine?.id);
  const [targets, setTargets] = useState<PulseTargets>('this');
  const [selected, setSelected] = useState<ReadonlySet<number>>(new Set());
  const copyTo = targets === 'all' ? others.map((m) => m.id) : targets === 'selected' ? [...selected] : [];
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
    };
    const result = await action.run((c) =>
      c.db.transaction((tx) => {
        const txCtx = { ...c, db: tx };
        if (machine) updateMachine(txCtx, actor, machine.id, input);
        else addMachine(txCtx, actor, input);
        applyPulsesToMachines(txCtx, actor, pulses, copyTo);
        if (cyclesOn && machine) updateCycles(txCtx, actor, machine.id, toEdits(drafts));
        if (topUpsOn && machine) updateTopUps(txCtx, actor, machine.id, toTopUpEdits(topUpDrafts));
      }),
    );
    if (result.ok) onClose();
  }

  async function remove(id: number) {
    const result = await action.run((c) => removeMachine(c, actor, id));
    if (result.ok) onClose();
  }

  return (
    <Dialog
      visible
      title={machine ? `Edit ${machine.name}` : 'Add machine'}
      onClose={onClose}
      actions={
        <>
          {machine &&
            (confirmRemove ? (
              <Button label="Yes, remove" kind="danger" busy={action.busy} onPress={() => void remove(machine.id)} />
            ) : (
              <Button label="Remove machine" kind="danger" onPress={() => setConfirmRemove(true)} />
            ))}
          <Button label="Cancel" kind="secondary" onPress={onClose} />
          {!confirmRemove && (
            <Button label={machine ? 'Save changes' : 'Add machine'} onPress={save} busy={action.busy} disabled={invalid} />
          )}
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
        hint={wiringHint(Number(channelText))}
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
      {topUpsOn && (
        <>
          <Text variant="label">Top-ups</Text>
          <Text tone="muted">
            {"For damp laundry: staff add one of these while the dryer runs, or on its start screen, and the price goes on the order's bill. Each sends its own number of pulses (same length and gap as a start). Unticked top-ups are kept but not offered; an offered one needs a price."}
          </Text>
          <TopUpTable
            drafts={topUpDrafts}
            onChange={(draft) => setTopUpEdits({ ...topUpEdits, [draft.id]: draft })}
            onAdd={() => setAddingTopUp(true)}
          />
          {topUpError && <Text tone="danger">{topUpError}</Text>}
        </>
      )}
      {type === 'DRYER' && !machine && (
        <Text tone="muted">
          A new dryer gets 5, 10, 15 and 20-minute top-ups at the shop prices. Open it again after adding to change them or
          add your own.
        </Text>
      )}
      <Toggle
        label="In use"
        description="Switch off while a machine is broken so nobody can start it. An order whose start did not go out is taken off it."
        value={enabled}
        onChange={setEnabled}
      />
      {confirmRemove && machine && (
        <Notice tone="danger">
          {`${machine.name} and its cycles and top-ups will be removed, and channel ${machine.hardwareChannel} will be free. ` +
            'Its past runs stay in the machine log and reports.'}
        </Notice>
      )}
      {action.error && <Notice tone="danger">{action.error}</Notice>}
      {addingTopUp && machine && (
        <AddTopUpDialog
          machine={machine}
          dryers={machines.filter((m) => m.type === 'DRYER')}
          onClose={() => setAddingTopUp(false)}
        />
      )}
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
