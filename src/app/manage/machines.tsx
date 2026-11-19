import { useState } from 'react';

import type { MachineRow } from '@/db/schema';
import { can } from '@/domain/permissions';
import { MACHINE_TYPE_LABELS, MACHINE_TYPES, type MachineType } from '@/domain/unlockPolicy';
import { STATUS_LABELS } from '@/machines/MachineController';
import { channelTerminal, MAX_CHANNEL, MIN_KEY_LENGTH, normalizeAddress } from '@/machines/protocol';
import { changeOwnerPin } from '@/services/auth';
import {
  addMachine,
  listMachines,
  RESULT_MESSAGES,
  saveLockController,
  testPulse,
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
      toast('Lock controller settings saved');
    }
  }

  async function test(machine: MachineRow) {
    const result = await action.run((c) => testPulse(c, controller, actor, machine.id));
    if (result.ok) {
      toast(
        result.value === 'acked' ? `${machine.name}: test pulse sent` : `${machine.name}: ${RESULT_MESSAGES[result.value]}`,
        result.value === 'acked' ? 'success' : 'danger',
      );
    }
  }

  return (
    <ManageScreen title="Machines and locks" allowed={can.manageMachines}>
      <Screen>
        <Section title="Lock controller">
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
            hint="The lock controller shows it on the serial monitor when it starts. Reserve it in the router so it stays the same."
            error={addressError ? 'Enter an address like 192.168.1.50.' : null}
          />
          <TextField
            label="Lock key"
            value={key}
            onChangeText={setKey}
            autoCapitalize="none"
            secureTextEntry
            hint={`The same passphrase as LOCK_KEY on the lock controller, at least ${MIN_KEY_LENGTH} characters. Anyone who knows it can open doors.`}
          />
          <Button
            label="Save lock settings"
            onPress={saveConnection}
            busy={action.busy}
            disabled={!changed || addressError}
          />
          <Toggle
            label="Simulate locks"
            description="For demos and training: unlocks are recorded but nothing is sent to the lock controller."
            value={simulate}
            onChange={async (value) => {
              const result = await action.run((c) => setSetting(c.db, 'simulateMachines', value));
              if (result.ok) reloadLockController();
            }}
          />
        </Section>

        <Section
          title="Machines"
          description={`Each machine's lock channel (1 to ${MAX_CHANNEL}) is the lock controller terminal its door lock is wired to.`}
          action={<Button label="Add machine" icon="plus" onPress={() => setEditing('new')} />}
        >
          <Panel>
            {machines.length === 0 ? (
              <EmptyState icon="washing-machine" title="No machines yet" body="Add each washer and dryer once its lock is wired." />
            ) : (
              machines.map((machine, index) => (
                <ListRow
                  key={machine.id}
                  title={machine.name}
                  subtitle={`${MACHINE_TYPE_LABELS[machine.type]} · lock channel ${machine.hardwareChannel} (${
                    channelTerminal(machine.hardwareChannel) ?? 'not on the board'
                  })`}
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

  async function save() {
    const input = { name, type, hardwareChannel: Number(channelText), enabled };
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
          <Button label={machine ? 'Save changes' : 'Add machine'} onPress={save} busy={action.busy} />
        </>
      }
    >
      <TextField label="Name" value={name} onChangeText={setName} placeholder="Washer 1" autoCapitalize="words" />
      <Choice label="Type" value={type} onChange={setType} options={MACHINE_TYPES.map((t) => ({ value: t, label: MACHINE_TYPE_LABELS[t] }))} />
      <TextField
        label="Lock channel"
        value={channelText}
        onChangeText={(text) => setChannelText(text.replace(/\D/g, ''))}
        keyboardType="number-pad"
        hint={
          channelTerminal(Number(channelText)) === null
            ? `A number from 1 to ${MAX_CHANNEL}.`
            : `Wire this door's lock to terminal ${channelTerminal(Number(channelText))} on the lock controller.`
        }
      />
      <Toggle
        label="In use"
        description="Switch off while a machine is broken so nobody can be sent to it."
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
