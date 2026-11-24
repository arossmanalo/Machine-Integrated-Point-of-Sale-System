import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import type { MachineCycleRow, MachineRow } from '@/db/schema';
import { cycleNameProblem } from '@/domain/cycles';
import { RUN_MINUTES_LIMITS } from '@/domain/machinePolicy';
import { pulsesProblem } from '@/machines/protocol';
import { addCycle, type CycleEdit } from '@/services/cycles';
import { useActor } from '@/state/AppProvider';
import { useAction } from '@/state/hooks';
import { useToast } from '@/state/toast';

import { Button } from '../Button';
import { Checkbox, Choice, Dialog, Toggle } from '../controls';
import { Notice, Row } from '../layout';
import { Text } from '../Text';
import { TextField } from '../TextField';
import { space } from '../theme';

/** A cycle as it is being edited in the washer's settings. */
export interface CycleDraft {
  id: number;
  name: string;
  pulses: string;
  minutes: string;
  enabled: boolean;
}

export function toDraft(cycle: MachineCycleRow): CycleDraft {
  return {
    id: cycle.id,
    name: cycle.name,
    pulses: String(cycle.pulses),
    minutes: String(cycle.minutes),
    enabled: cycle.enabled,
  };
}

export function toEdits(drafts: readonly CycleDraft[]): CycleEdit[] {
  return drafts.map((draft) => ({
    id: draft.id,
    name: draft.name,
    pulses: Number(draft.pulses),
    minutes: Number(draft.minutes),
    enabled: draft.enabled,
  }));
}

function minutesProblem(minutes: number): string | null {
  const { min, max } = RUN_MINUTES_LIMITS;
  return Number.isInteger(minutes) && minutes >= min && minutes <= max ? null : `enter ${min} to ${max} minutes.`;
}

/** The first problem with any cycle, checked against the washer's pulse length and gap. */
export function draftsProblem(drafts: readonly CycleDraft[], onMs: number, offMs: number): string | null {
  for (const draft of drafts) {
    const label = draft.name.trim() || 'A cycle';
    const problem =
      cycleNameProblem(draft.name) ??
      pulsesProblem({ count: Number(draft.pulses), onMs, offMs }) ??
      minutesProblem(Number(draft.minutes));
    if (problem) return `${label}: ${problem}`;
  }
  return null;
}

const digitsOnly = (text: string) => text.replace(/\D/g, '');

/**
 * A washer's cycles as a table: a tick box to offer the cycle or not, then its name, pulses and
 * minutes. Unticked cycles stay saved but are not offered when the washer runs.
 */
export function CycleTable({
  drafts,
  onChange,
  onAdd,
}: {
  drafts: readonly CycleDraft[];
  onChange: (draft: CycleDraft) => void;
  onAdd: () => void;
}) {
  return (
    <View style={styles.table}>
      <Row>
        <Text variant="label" style={styles.on}>
          On
        </Text>
        <Text variant="label" style={styles.name}>
          Cycle
        </Text>
        <Text variant="label" style={styles.flex}>
          Pulses
        </Text>
        <Text variant="label" style={styles.flex}>
          Minutes
        </Text>
      </Row>
      {drafts.map((draft) => (
        <Row key={draft.id}>
          <View style={styles.on}>
            <Checkbox
              label=""
              accessibilityLabel={`Offer the ${draft.name} cycle`}
              value={draft.enabled}
              onChange={(enabled) => onChange({ ...draft, enabled })}
            />
          </View>
          <TextField
            label={`Cycle ${draft.id} name`}
            hideLabel
            value={draft.name}
            onChangeText={(name) => onChange({ ...draft, name })}
            autoCapitalize="words"
            style={styles.name}
          />
          <TextField
            label={`${draft.name} pulses`}
            hideLabel
            value={draft.pulses}
            onChangeText={(text) => onChange({ ...draft, pulses: digitsOnly(text) })}
            keyboardType="number-pad"
            style={styles.flex}
          />
          <TextField
            label={`${draft.name} minutes`}
            hideLabel
            value={draft.minutes}
            onChangeText={(text) => onChange({ ...draft, minutes: digitsOnly(text) })}
            keyboardType="number-pad"
            style={styles.flex}
          />
        </Row>
      ))}
      <Row>
        <Button label="Add cycle" kind="secondary" icon="plus" onPress={onAdd} />
      </Row>
    </View>
  );
}

type CycleTargets = 'this' | 'all' | 'selected';

/**
 * Adds a new cycle to this washer, every washer, or the washers picked. Each washer sends the
 * cycle's pulses with its own pulse length and gap.
 */
export function AddCycleDialog({
  machine,
  washers,
  onClose,
}: {
  machine: MachineRow;
  washers: readonly MachineRow[];
  onClose: () => void;
}) {
  const actor = useActor();
  const action = useAction();
  const toast = useToast();
  const [name, setName] = useState('');
  const [pulsesText, setPulsesText] = useState(String(machine.pulseCount));
  const [minutesText, setMinutesText] = useState(String(machine.runMinutes));
  const [targets, setTargets] = useState<CycleTargets>('this');
  const others = washers.filter((washer) => washer.id !== machine.id);
  const [selected, setSelected] = useState<ReadonlySet<number>>(new Set());
  const ids =
    targets === 'this'
      ? [machine.id]
      : targets === 'all'
        ? [machine.id, ...others.map((washer) => washer.id)]
        : [machine.id, ...selected];
  const problem =
    cycleNameProblem(name) ??
    pulsesProblem({ count: Number(pulsesText), onMs: machine.pulseOnMs, offMs: machine.pulseOffMs }) ??
    minutesProblem(Number(minutesText));

  function toggle(id: number, on: boolean) {
    const next = new Set(selected);
    if (on) next.add(id);
    else next.delete(id);
    setSelected(next);
  }

  async function add() {
    const input = { name, pulses: Number(pulsesText), minutes: Number(minutesText) };
    const result = await action.run((c) => addCycle(c, actor, input, ids));
    if (result.ok) {
      toast(`${name.trim()} added to ${ids.length} washer${ids.length === 1 ? '' : 's'}`, 'success');
      onClose();
    }
  }

  return (
    <Dialog
      visible
      title="Add a cycle"
      onClose={onClose}
      actions={
        <>
          <Button label="Cancel" kind="secondary" onPress={onClose} />
          <Button label="Add cycle" onPress={() => void add()} busy={action.busy} disabled={problem !== null} />
        </>
      }
    >
      <TextField label="Name" value={name} onChangeText={setName} placeholder="For example: Quick wash" autoCapitalize="words" />
      <Row wrap style={{ alignItems: 'flex-start' }}>
        <TextField
          label="Pulses"
          value={pulsesText}
          onChangeText={(text) => setPulsesText(digitsOnly(text))}
          keyboardType="number-pad"
          style={styles.flex}
        />
        <TextField
          label="Minutes"
          value={minutesText}
          onChangeText={(text) => setMinutesText(digitsOnly(text))}
          keyboardType="number-pad"
          style={styles.flex}
        />
      </Row>
      {name.trim() !== '' && problem && <Text tone="danger">{problem}</Text>}
      {others.length > 0 && (
        <Choice
          label="Add it to"
          value={targets}
          onChange={setTargets}
          options={[
            { value: 'this', label: `${machine.name} only` },
            { value: 'all', label: `All washers (${others.length + 1})` },
            { value: 'selected', label: 'Selected washers' },
          ]}
        />
      )}
      {targets === 'selected' &&
        others.map((washer) => (
          <Toggle
            key={washer.id}
            label={washer.name}
            value={selected.has(washer.id)}
            onChange={(on) => toggle(washer.id, on)}
          />
        ))}
      {action.error && <Notice tone="danger">{action.error}</Notice>}
    </Dialog>
  );
}

const styles = StyleSheet.create({
  table: { gap: space.sm },
  on: { width: 56 },
  name: { width: 170 },
  flex: { flex: 1 },
});
