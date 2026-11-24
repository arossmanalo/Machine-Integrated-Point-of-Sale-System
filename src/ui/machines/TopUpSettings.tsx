import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import type { DryerTopUpRow, MachineRow } from '@/db/schema';
import { centavosToInput, parsePesoInput } from '@/domain/money';
import { addTopUp, topUpProblem, type TopUpEdit } from '@/services/topUps';
import { useActor } from '@/state/AppProvider';
import { useAction } from '@/state/hooks';
import { useToast } from '@/state/toast';

import { Button } from '../Button';
import { Checkbox, Choice, Dialog, Toggle } from '../controls';
import { Notice, Row } from '../layout';
import { Text } from '../Text';
import { TextField } from '../TextField';
import { space } from '../theme';

/** A dryer top-up as it is being edited in the dryer's settings. */
export interface TopUpDraft {
  id: number;
  name: string;
  minutes: string;
  pulses: string;
  price: string;
  enabled: boolean;
}

export function toTopUpDraft(topUp: DryerTopUpRow): TopUpDraft {
  return {
    id: topUp.id,
    name: topUp.name,
    minutes: String(topUp.minutes),
    pulses: String(topUp.pulses),
    price: topUp.price > 0 ? centavosToInput(topUp.price) : '',
    enabled: topUp.enabled,
  };
}

/** Blank means 0. Null when the text is not a price. */
function priceOf(text: string): number | null {
  return text.trim() === '' ? 0 : parsePesoInput(text);
}

export function toTopUpEdits(drafts: readonly TopUpDraft[]): TopUpEdit[] {
  return drafts.map((draft) => ({
    id: draft.id,
    name: draft.name,
    minutes: Number(draft.minutes),
    pulses: Number(draft.pulses),
    price: priceOf(draft.price) ?? 0,
    enabled: draft.enabled,
  }));
}

/** The first problem with any top-up, checked against the dryer's pulse length and gap. */
export function topUpDraftsProblem(drafts: readonly TopUpDraft[], onMs: number, offMs: number): string | null {
  for (const draft of drafts) {
    const label = draft.name.trim() || 'A top-up';
    if (priceOf(draft.price) === null) return `${label}: enter a price like 20 or 20.50.`;
    const [edit] = toTopUpEdits([draft]);
    const problem = edit ? topUpProblem({ pulseOnMs: onMs, pulseOffMs: offMs }, edit) : null;
    if (problem) return `${label}: ${problem}`;
  }
  return null;
}

const digitsOnly = (text: string) => text.replace(/\D/g, '');

/**
 * A dryer's top-ups as a table: a tick box to offer it or not, then its name, minutes, pulses and
 * price. Unticked top-ups stay saved but are not offered.
 */
export function TopUpTable({
  drafts,
  onChange,
  onAdd,
}: {
  drafts: readonly TopUpDraft[];
  onChange: (draft: TopUpDraft) => void;
  onAdd: () => void;
}) {
  return (
    <View style={styles.table}>
      <Row>
        <Text variant="label" style={styles.on}>
          On
        </Text>
        <Text variant="label" style={styles.name}>
          Top-up
        </Text>
        <Text variant="label" style={styles.flex}>
          Minutes
        </Text>
        <Text variant="label" style={styles.flex}>
          Pulses
        </Text>
        <Text variant="label" style={styles.flex}>
          Price
        </Text>
      </Row>
      {drafts.map((draft) => (
        <Row key={draft.id}>
          <View style={styles.on}>
            <Checkbox
              label=""
              accessibilityLabel={`Offer the ${draft.name} top-up`}
              value={draft.enabled}
              onChange={(enabled) => onChange({ ...draft, enabled })}
            />
          </View>
          <TextField
            label={`Top-up ${draft.id} name`}
            hideLabel
            value={draft.name}
            onChangeText={(name) => onChange({ ...draft, name })}
            autoCapitalize="words"
            style={styles.name}
          />
          <TextField
            label={`${draft.name} minutes`}
            hideLabel
            value={draft.minutes}
            onChangeText={(text) => onChange({ ...draft, minutes: digitsOnly(text) })}
            keyboardType="number-pad"
            style={styles.flex}
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
            label={`${draft.name} price`}
            hideLabel
            value={draft.price}
            onChangeText={(price) => onChange({ ...draft, price })}
            keyboardType="decimal-pad"
            prefix="₱"
            style={styles.flex}
          />
        </Row>
      ))}
      <Row>
        <Button label="Add top-up" kind="secondary" icon="plus" onPress={onAdd} />
      </Row>
    </View>
  );
}

type TopUpTargets = 'this' | 'all' | 'selected';

/**
 * Adds a new top-up type to this dryer, every dryer, or the dryers picked. Each dryer sends the
 * top-up's pulses with its own pulse length and gap. With a price it is offered straight away.
 */
export function AddTopUpDialog({
  machine,
  dryers,
  onClose,
}: {
  machine: MachineRow;
  dryers: readonly MachineRow[];
  onClose: () => void;
}) {
  const actor = useActor();
  const action = useAction();
  const toast = useToast();
  const [name, setName] = useState('');
  const [minutesText, setMinutesText] = useState('30');
  const [pulsesText, setPulsesText] = useState(String(machine.pulseCount));
  const [priceText, setPriceText] = useState('');
  const [targets, setTargets] = useState<TopUpTargets>('this');
  const others = dryers.filter((dryer) => dryer.id !== machine.id);
  const [selected, setSelected] = useState<ReadonlySet<number>>(new Set());
  const ids =
    targets === 'this'
      ? [machine.id]
      : targets === 'all'
        ? [machine.id, ...others.map((dryer) => dryer.id)]
        : [machine.id, ...selected];
  const price = priceOf(priceText);
  const input = { name, minutes: Number(minutesText), pulses: Number(pulsesText), price: price ?? 0 };
  const problem =
    price === null
      ? 'Enter a price like 20 or 20.50, or leave it blank to add it switched off.'
      : topUpProblem(machine, { ...input, enabled: input.price > 0 });

  function toggle(id: number, on: boolean) {
    const next = new Set(selected);
    if (on) next.add(id);
    else next.delete(id);
    setSelected(next);
  }

  async function add() {
    const result = await action.run((c) => addTopUp(c, actor, input, ids));
    if (result.ok) {
      toast(`${name.trim()} added to ${ids.length} dryer${ids.length === 1 ? '' : 's'}`, 'success');
      onClose();
    }
  }

  return (
    <Dialog
      visible
      title="Add a top-up"
      onClose={onClose}
      actions={
        <>
          <Button label="Cancel" kind="secondary" onPress={onClose} />
          <Button label="Add top-up" onPress={() => void add()} busy={action.busy} disabled={problem !== null} />
        </>
      }
    >
      <TextField label="Name" value={name} onChangeText={setName} placeholder="For example: Extra dry" autoCapitalize="words" />
      <Row wrap style={{ alignItems: 'flex-start' }}>
        <TextField
          label="Minutes"
          value={minutesText}
          onChangeText={(text) => setMinutesText(digitsOnly(text))}
          keyboardType="number-pad"
          style={styles.flex}
        />
        <TextField
          label="Pulses"
          value={pulsesText}
          onChangeText={(text) => setPulsesText(digitsOnly(text))}
          keyboardType="number-pad"
          style={styles.flex}
        />
        <TextField
          label="Price"
          value={priceText}
          onChangeText={setPriceText}
          keyboardType="decimal-pad"
          prefix="₱"
          style={styles.flex}
        />
      </Row>
      <Text tone="muted">Leave the price blank to add it switched off; the owner can price it later.</Text>
      {name.trim() !== '' && problem && <Text tone="danger">{problem}</Text>}
      {others.length > 0 && (
        <Choice
          label="Add it to"
          value={targets}
          onChange={setTargets}
          options={[
            { value: 'this', label: `${machine.name} only` },
            { value: 'all', label: `All dryers (${others.length + 1})` },
            { value: 'selected', label: 'Selected dryers' },
          ]}
        />
      )}
      {targets === 'selected' &&
        others.map((dryer) => (
          <Toggle key={dryer.id} label={dryer.name} value={selected.has(dryer.id)} onChange={(on) => toggle(dryer.id, on)} />
        ))}
      {action.error && <Notice tone="danger">{action.error}</Notice>}
    </Dialog>
  );
}

const styles = StyleSheet.create({
  table: { gap: space.sm },
  on: { width: 56 },
  name: { width: 150 },
  flex: { flex: 1 },
});
