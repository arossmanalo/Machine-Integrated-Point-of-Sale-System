import { useState } from 'react';

import type { MachineRow } from '@/db/schema';
import { can } from '@/domain/permissions';
import { MACHINE_TYPE_LABELS, MACHINE_TYPES, RUN_MINUTES_LIMITS, TOP_UP_MINUTES, type MachineType } from '@/domain/machinePolicy';
import { centavosToInput, formatPeso, parsePesoInput } from '@/domain/money';
import { STATUS_LABELS } from '@/machines/MachineController';
import { channelTerminal, MAX_CHANNEL, MIN_KEY_LENGTH, normalizeAddress, pulsesProblem } from '@/machines/protocol';
import { changeOwnerPin } from '@/services/auth';
import {
  addMachine,
  applyPulsesToMachines,
  listMachines,
  RESULT_MESSAGES,
  saveLockController,
  testStart,
  updateMachine,
} from '@/services/machines';
import { getSetting, setSetting } from '@/services/settings';
import { useActor, useApp } from '@/state/AppProvider';
import { useAction, useData } from '@/state/hooks';
import { useToast } from '@/state/toast';
import { Button } from '@/ui/Button';
import { Badge, Choice, Dialog, Toggle } from '@/ui/controls';
import { EmptyState, ListRow, Notice, Panel, Row, Screen, Section } from '@/ui/layout';
import { ManageScreen } from '@/ui/ManagerGate';
import { Text } from '@/ui/Text';
import { TextField } from '@/ui/TextField';

function pulseSummary(machine: MachineRow): string {
  return `${machine.pulseCount} × ${machine.pulseOnMs} ms on, ${machine.pulseOffMs} ms off`;
}

function machineSummary(machine: MachineRow): string {
  const topUp =
    machine.type !== 'DRYER'
      ? ''
      : machine.topUpPrice > 0
        ? ` · top-up ${formatPeso(machine.topUpPrice)}`
        : ' · no top-ups';
  return `${machine.runMinutes} min run · ${pulseSummary(machine)}${topUp}`;
}

export default function MachineSettings() {
  const actor = useActor();
  const { controller, controllerState, reloadLockController } = useApp();
  const action = useAction();
  const toast = useToast();
  const [editing, setEditing] = useState<MachineRow | 'new' | null>(null);
  const [changingPin, setChangingPin] = useState(false);
  const machines = useData(listMachines);
  const simulate = useData((c) => getSetting(c.db, 'simulateMachines'));
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
    <ManageScreen title="Machines" allowed={can.manageMachines}>
      <Screen>
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
              const result = await action.run((c) => setSetting(c.db, 'simulateMachines', value));
              if (result.ok) reloadLockController();
            }}
          />
        </Section>

        <Section
          title="Machines"
          description={`Each machine's channel (1 to ${MAX_CHANNEL}) is the machine controller terminal it is wired to. A start sends that machine's pulses.`}
          action={<Button label="Add machine" icon="plus" onPress={() => setEditing('new')} />}
        >
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
                  }) · ${machineSummary(machine)}`}
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

        <Section title="Owner PIN" description="Needed for every override. Change it if anyone else may have seen it.">
          <Button label="Change owner PIN" kind="secondary" icon="shield-key-outline" onPress={() => setChangingPin(true)} />
        </Section>
      </Screen>
      {editing && (
        <MachineDialog
          machine={editing === 'new' ? null : editing}
          machines={machines}
          nextChannel={machines.reduce((max, m) => Math.max(max, m.hardwareChannel), 0) + 1}
          onClose={() => setEditing(null)}
        />
      )}
      {changingPin && <PinDialog onClose={() => setChangingPin(false)} />}
    </ManageScreen>
  );
}

type PulseTargets = 'this' | 'all' | 'selected';

function MachineDialog({
  machine,
  machines,
  nextChannel,
  onClose,
}: {
  machine: MachineRow | null;
  machines: readonly MachineRow[];
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
  const [topUpCountText, setTopUpCountText] = useState(String(machine?.topUpPulseCount ?? 1));
  const [topUpPriceText, setTopUpPriceText] = useState(centavosToInput(machine?.topUpPrice ?? 0));
  const pulses = { count: Number(countText), onMs: Number(onText), offMs: Number(offText) };
  const pulseError = pulsesProblem(pulses);
  const runMinutes = Number(runText);
  const runError =
    Number.isInteger(runMinutes) && runMinutes >= RUN_MINUTES_LIMITS.min && runMinutes <= RUN_MINUTES_LIMITS.max
      ? null
      : `Enter ${RUN_MINUTES_LIMITS.min} to ${RUN_MINUTES_LIMITS.max} minutes.`;
  const topUpPrice = topUpPriceText.trim() === '' ? 0 : parsePesoInput(topUpPriceText);
  const dryer = type === 'DRYER';
  const topUpPulseError = dryer ? pulsesProblem({ ...pulses, count: Number(topUpCountText) }) : null;
  const topUpPriceError = dryer && topUpPrice === null ? 'Enter a price like 20 or 20.50.' : null;
  const invalid = pulseError !== null || runError !== null || topUpPulseError !== null || topUpPriceError !== null;
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
      topUpPulseCount: Number(topUpCountText),
      topUpPrice: topUpPrice ?? 0,
    };
    const result = await action.run((c) =>
      c.db.transaction((tx) => {
        const txCtx = { ...c, db: tx };
        if (machine) updateMachine(txCtx, actor, machine.id, input);
        else addMachine(txCtx, actor, input);
        applyPulsesToMachines(txCtx, actor, pulses, copyTo);
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
        {`A start sends ${pulses.count || '?'} pulse${pulses.count === 1 ? '' : 's'} of ${pulses.onMs || '?'} ms with ${pulses.offMs || '?'} ms between them, like coins in the slot.`}
      </Text>
      <Row wrap style={{ alignItems: 'flex-start' }}>
        <TextField label="Number of pulses" value={countText} onChangeText={digits(setCountText)} keyboardType="number-pad" style={{ flex: 1 }} />
        <TextField label="Pulse length (ms)" value={onText} onChangeText={digits(setOnText)} keyboardType="number-pad" style={{ flex: 1 }} />
        <TextField label="Gap (ms)" value={offText} onChangeText={digits(setOffText)} keyboardType="number-pad" style={{ flex: 1 }} />
      </Row>
      {pulseError && <Text tone="danger">{pulseError}</Text>}
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
          {`Saving also gives ${copyTo.length} other machine${copyTo.length === 1 ? '' : 's'} these start pulses. Their run time and top-up settings stay as they are.`}
        </Text>
      )}
      <TextField
        label="Run time (minutes)"
        value={runText}
        onChangeText={digits(setRunText)}
        keyboardType="number-pad"
        hint="How long one start runs. The Machines tab counts it down and keeps the machine in use until then."
        error={runText !== '' ? runError : null}
      />
      {dryer && (
        <>
          <Text variant="label">{`Top-up (${TOP_UP_MINUTES} minutes)`}</Text>
          <Text tone="muted">
            {`For damp laundry: each top-up adds ${TOP_UP_MINUTES} minutes, sends these pulses (same length and gap as a start) and adds the price to the order's bill. Leave the price at 0 to switch top-ups off.`}
          </Text>
          <Row wrap style={{ alignItems: 'flex-start' }}>
            <TextField
              label="Top-up pulses"
              value={topUpCountText}
              onChangeText={digits(setTopUpCountText)}
              keyboardType="number-pad"
              style={{ flex: 1 }}
            />
            <TextField
              label="Top-up price"
              value={topUpPriceText}
              onChangeText={setTopUpPriceText}
              keyboardType="decimal-pad"
              prefix="₱"
              style={{ flex: 1 }}
            />
          </Row>
          {topUpPulseError && <Text tone="danger">{`Top-up: ${topUpPulseError}`}</Text>}
          {topUpPriceError && <Text tone="danger">{topUpPriceError}</Text>}
        </>
      )}
      <Toggle
        label="In use"
        description="Switch off while a machine is broken so nobody can start it. An order whose start did not go out is taken off it."
        value={enabled}
        onChange={setEnabled}
      />
      {action.error && <Notice tone="danger">{action.error}</Notice>}
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
