import { useState } from 'react';

import type { MachineRow } from '@/db/schema';
import { can } from '@/domain/permissions';
import { MACHINE_TYPE_LABELS, MACHINE_TYPES, type MachineType } from '@/domain/machinePolicy';
import { STATUS_LABELS } from '@/machines/MachineController';
import { channelTerminal, MAX_CHANNEL, MIN_KEY_LENGTH, normalizeAddress, pulsesProblem } from '@/machines/protocol';
import { changeOwnerPin } from '@/services/auth';
import {
  addMachine,
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
                  }) · ${pulseSummary(machine)}`}
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
          nextChannel={machines.reduce((max, m) => Math.max(max, m.hardwareChannel), 0) + 1}
          onClose={() => setEditing(null)}
        />
      )}
      {changingPin && <PinDialog onClose={() => setChangingPin(false)} />}
    </ManageScreen>
  );
}

function MachineDialog({ machine, nextChannel, onClose }: { machine: MachineRow | null; nextChannel: number; onClose: () => void }) {
  const actor = useActor();
  const action = useAction();
  const [name, setName] = useState(machine?.name ?? '');
  const [type, setType] = useState<MachineType>(machine?.type ?? 'WASHER');
  const [channelText, setChannelText] = useState(String(machine?.hardwareChannel ?? nextChannel));
  const [enabled, setEnabled] = useState(machine?.enabled ?? true);
  const [countText, setCountText] = useState(String(machine?.pulseCount ?? 1));
  const [onText, setOnText] = useState(String(machine?.pulseOnMs ?? 500));
  const [offText, setOffText] = useState(String(machine?.pulseOffMs ?? 500));
  const pulses = { count: Number(countText), onMs: Number(onText), offMs: Number(offText) };
  const pulseError = pulsesProblem(pulses);
  const digits = (set: (value: string) => void) => (text: string) => set(text.replace(/\D/g, ''));

  async function save() {
    const input = {
      name,
      type,
      hardwareChannel: Number(channelText),
      enabled,
      pulseCount: pulses.count,
      pulseOnMs: pulses.onMs,
      pulseOffMs: pulses.offMs,
    };
    const result = await action.run((c) => {
      if (machine) updateMachine(c, actor, machine.id, input);
      else addMachine(c, actor, input);
    });
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
          <Button label={machine ? 'Save changes' : 'Add machine'} onPress={save} busy={action.busy} disabled={pulseError !== null} />
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
      <Toggle
        label="In use"
        description="Switch off while a machine is broken so nobody can be sent to it. Any order waiting on it is taken off."
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
