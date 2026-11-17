import { useState } from 'react';

import type { MachineRow } from '@/db/schema';
import { can } from '@/domain/permissions';
import { MACHINE_TYPE_LABELS, MACHINE_TYPES, type MachineType } from '@/domain/unlockPolicy';
import { STATUS_LABELS } from '@/machines/MachineController';
import { changeOwnerPin } from '@/services/auth';
import { addMachine, listMachines, RESULT_MESSAGES, testPulse, updateMachine } from '@/services/machines';
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
  const { controller, controllerState, setSimulatedLocks } = useApp();
  const action = useAction();
  const toast = useToast();
  const [editing, setEditing] = useState<MachineRow | 'new' | null>(null);
  const [changingPin, setChangingPin] = useState(false);
  const machines = useData(listMachines);
  const simulate = useData((c) => getSetting(c.db, 'simulateMachines'));

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
            <Button label="Reconnect" kind="secondary" icon="usb" onPress={() => void controller.connect()} />
          </Row>
          <Toggle
            label="Simulate locks"
            description="For demos and training: unlocks are recorded but no command goes to the Arduino."
            value={simulate}
            onChange={async (value) => {
              const result = await action.run((c) => setSetting(c.db, 'simulateMachines', value));
              if (result.ok) setSimulatedLocks(value);
            }}
          />
        </Section>

        <Section
          title="Machines"
          description="The lock channel is the Arduino output wired to that machine's door lock (P1 is pin 2, P2 is pin 3, and so on)."
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
                  subtitle={`${MACHINE_TYPE_LABELS[machine.type]} · lock channel ${machine.hardwareChannel}`}
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
        hint="The number n the app sends as P<n>. The LED board uses 1 to 6."
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
