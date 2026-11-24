import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import type { MachineCycleRow, MachineRow } from '@/db/schema';
import {
  MACHINE_TYPE_LABELS,
  TOP_UP_CHOICES,
  topUpOptions,
  topUpPriceFor,
  topUpPulseCountFor,
  type TopUpMinutes,
  type TopUpPrices,
} from '@/domain/machinePolicy';
import { centavosToInput, parsePesoInput } from '@/domain/money';
import { STATUS_LABELS } from '@/machines/MachineController';
import { listCycles } from '@/services/cycles';
import { listMachines, saveOwnerMachineChanges } from '@/services/machines';
import { getSetting } from '@/services/settings';
import { useActor, useApp } from '@/state/AppProvider';
import { useAction, useData } from '@/state/hooks';
import { useToast } from '@/state/toast';

import { Button } from '../Button';
import { Badge, Checkbox, Dialog, Toggle } from '../controls';
import { EmptyState, ListRow, Notice, Panel, Row, Section } from '../layout';
import { Text } from '../Text';
import { TextField } from '../TextField';
import { space } from '../theme';

/** What the owner calls a start signal: one coin, as if dropped in the machine's slot. */
export function coins(count: number): string {
  return `${count} coin${count === 1 ? '' : 's'}`;
}

function OnOff({ on }: { on: boolean }) {
  return <Badge label={on ? 'On' : 'Off'} tone={on ? 'accent' : 'neutral'} />;
}

/**
 * The owner's view of the machine setup. It names each setting broadly and leaves out how the
 * machines are wired and signalled. The owner may switch machines and cycles on or off and set
 * dryer top-up prices; everything else stays with the built-in developer.
 */
export function MachineOverview() {
  const { controller, controllerState } = useApp();
  const [viewing, setViewing] = useState<MachineRow | null>(null);
  const machines = useData(listMachines);
  const cycles = useData(listCycles);
  const settings = useData((c) => ({
    receiptScan: getSetting(c.db, 'requireReceiptScan'),
    multiCycle: getSetting(c.db, 'multiCycle'),
    simulate: getSetting(c.db, 'simulateMachines'),
  }));
  const cyclesOf = (machine: MachineRow) =>
    settings.multiCycle && machine.type === 'WASHER' ? cycles.filter((cycle) => cycle.machineId === machine.id) : [];

  function summary(machine: MachineRow): string {
    const own = cyclesOf(machine);
    const onCycles = own.filter((cycle) => cycle.enabled);
    const start =
      onCycles.length > 0
        ? `${onCycles.length} cycle${onCycles.length === 1 ? '' : 's'}`
        : `${machine.runMinutes} min · ${coins(machine.pulseCount)}`;
    if (machine.type !== 'DRYER') return `${MACHINE_TYPE_LABELS[machine.type]} · ${start}`;
    const topUps = topUpOptions(machine);
    const topUpText = topUps.length === 0 ? 'no top-ups' : `top-ups ${topUps.map((o) => `${o.minutes}`).join(', ')} min`;
    return `${MACHINE_TYPE_LABELS[machine.type]} · ${start} · ${topUpText}`;
  }

  return (
    <>
      <Section title="Connection">
        <Row wrap>
          <Text style={styles.flex}>{STATUS_LABELS[controllerState.status]}</Text>
          <Button label="Check connection" kind="secondary" icon="wifi" onPress={() => void controller.connect()} />
        </Row>
      </Section>

      <Section title="Settings">
        <Panel>
          <ListRow title="Scan receipt to run a machine" right={<OnOff on={settings.receiptScan} />} />
          <ListRow title="Multi-cycle" right={<OnOff on={settings.multiCycle} />} last={!settings.simulate} />
          {settings.simulate && <ListRow title="Simulated machines" right={<OnOff on />} last />}
        </Panel>
      </Section>

      <Section title="Machines" description="Tap a machine to switch it off, choose its cycles or set top-up prices.">
        <Panel>
          {machines.length === 0 ? (
            <EmptyState icon="washing-machine" title="No machines yet" body="Machines are added by support." />
          ) : (
            machines.map((machine, index) => (
              <ListRow
                key={machine.id}
                title={machine.name}
                subtitle={summary(machine)}
                right={!machine.enabled ? <Badge label="Off" tone="warning" /> : undefined}
                onPress={() => setViewing(machine)}
                last={index === machines.length - 1}
              />
            ))
          )}
        </Panel>
      </Section>

      {viewing && (
        <MachineDetails machine={viewing} cycles={cyclesOf(viewing)} onClose={() => setViewing(null)} />
      )}
    </>
  );
}

type PriceDrafts = Record<TopUpMinutes, { offered: boolean; price: string }>;

function priceDrafts(machine: MachineRow): PriceDrafts {
  const draft = (minutes: TopUpMinutes) => {
    const price = topUpPriceFor(machine, minutes);
    return { offered: price > 0, price: price > 0 ? centavosToInput(price) : '' };
  };
  return { 5: draft(5), 10: draft(10), 15: draft(15), 20: draft(20) };
}

/** The price for each length: an offered length needs a price above zero, others are 0. */
function parsePrices(drafts: PriceDrafts): { prices: TopUpPrices | null; missing: TopUpMinutes[] } {
  const missing: TopUpMinutes[] = [];
  const priceOf = (minutes: TopUpMinutes) => {
    if (!drafts[minutes].offered) return 0;
    const price = parsePesoInput(drafts[minutes].price);
    if (price === null || price === 0) missing.push(minutes);
    return price ?? 0;
  };
  const prices = { topUpPrice: priceOf(5), topUpPrice10: priceOf(10), topUpPrice15: priceOf(15), topUpPrice20: priceOf(20) };
  return { prices: missing.length === 0 ? prices : null, missing };
}

/**
 * The owner switches the machine and its cycles on or off and sets a dryer's top-up prices.
 * Coins, run times and the cycles themselves are shown but stay with support.
 */
function MachineDetails({
  machine,
  cycles,
  onClose,
}: {
  machine: MachineRow;
  cycles: readonly MachineCycleRow[];
  onClose: () => void;
}) {
  const actor = useActor();
  const action = useAction();
  const toast = useToast();
  const dryer = machine.type === 'DRYER';
  const [enabled, setEnabled] = useState(machine.enabled);
  const [offered, setOffered] = useState<Record<number, boolean>>(() =>
    Object.fromEntries(cycles.map((cycle) => [cycle.id, cycle.enabled])),
  );
  const [drafts, setDrafts] = useState<PriceDrafts>(() => priceDrafts(machine));
  const isOffered = (cycle: MachineCycleRow) => offered[cycle.id] ?? cycle.enabled;
  const usesCycles = cycles.some(isOffered);
  const { prices, missing } = parsePrices(drafts);
  const topUpError =
    dryer && missing.length > 0
      ? `Enter a price for ${missing.map((minutes) => `${minutes} min`).join(', ')}, or untick it.`
      : null;

  function setDraft(minutes: TopUpMinutes, change: Partial<PriceDrafts[TopUpMinutes]>) {
    setDrafts({ ...drafts, [minutes]: { ...drafts[minutes], ...change } });
  }

  async function save() {
    const changes = {
      enabled,
      cycles: cycles.map((cycle) => ({ id: cycle.id, enabled: isOffered(cycle) })),
      topUpPrices: dryer ? prices : null,
    };
    const result = await action.run((c) => saveOwnerMachineChanges(c, actor, machine.id, changes));
    if (result.ok) {
      toast(`${machine.name} saved`, 'success');
      onClose();
    }
  }

  return (
    <Dialog
      visible
      title={machine.name}
      onClose={onClose}
      actions={
        <>
          <Button label="Cancel" kind="secondary" onPress={onClose} />
          <Button label="Save changes" onPress={() => void save()} busy={action.busy} disabled={topUpError !== null} />
        </>
      }
    >
      <Toggle
        label="In use"
        description="Switch it off while it is broken so nobody can start it."
        value={enabled}
        onChange={setEnabled}
      />
      <Panel>
        <ListRow title="Type" right={<Text>{MACHINE_TYPE_LABELS[machine.type]}</Text>} last={usesCycles} />
        {!usesCycles && <ListRow title="Run time" right={<Text>{`${machine.runMinutes} min`}</Text>} />}
        {!usesCycles && <ListRow title="Coins" right={<Text>{coins(machine.pulseCount)}</Text>} last />}
      </Panel>

      {cycles.length > 0 && (
        <View style={styles.table}>
          <Row>
            <Text variant="label" style={styles.check}>
              Offered
            </Text>
            <Text variant="label" style={styles.name}>
              Cycle
            </Text>
            <Text variant="label" style={styles.flex}>
              Coins
            </Text>
            <Text variant="label" style={styles.flex}>
              Minutes
            </Text>
          </Row>
          {cycles.map((cycle) => (
            <Row key={cycle.id}>
              <View style={styles.check}>
                <Checkbox
                  label=""
                  accessibilityLabel={`Offer the ${cycle.name} cycle`}
                  value={isOffered(cycle)}
                  onChange={(on) => setOffered({ ...offered, [cycle.id]: on })}
                />
              </View>
              <Text style={styles.name}>{cycle.name}</Text>
              <Text style={[styles.flex, styles.number]}>{cycle.pulses}</Text>
              <Text style={[styles.flex, styles.number]}>{cycle.minutes}</Text>
            </Row>
          ))}
          {!usesCycles && (
            <Text tone="muted">
              {`With no cycle offered, staff are not asked for one and the washer runs ${machine.runMinutes} min.`}
            </Text>
          )}
        </View>
      )}

      {dryer && (
        <View style={styles.table}>
          <Row>
            <Text variant="label" style={styles.check}>
              Offered
            </Text>
            <Text variant="label" style={styles.name}>
              Top-up
            </Text>
            <Text variant="label" style={styles.flex}>
              Coins
            </Text>
            <Text variant="label" style={styles.flex}>
              Price
            </Text>
          </Row>
          {TOP_UP_CHOICES.map((minutes) => (
            <Row key={minutes}>
              <View style={styles.check}>
                <Checkbox
                  label=""
                  accessibilityLabel={`Offer the ${minutes}-minute top-up`}
                  value={drafts[minutes].offered}
                  onChange={(on) => setDraft(minutes, { offered: on })}
                />
              </View>
              <Text style={styles.name}>{`${minutes} min`}</Text>
              <Text style={[styles.flex, styles.number]}>{topUpPulseCountFor(machine, minutes)}</Text>
              <TextField
                label={`${minutes}-minute top-up price`}
                hideLabel
                value={drafts[minutes].price}
                onChangeText={(price) => setDraft(minutes, { price })}
                editable={drafts[minutes].offered}
                keyboardType="decimal-pad"
                prefix="₱"
                style={styles.flex}
              />
            </Row>
          ))}
          {topUpError && <Text tone="danger">{topUpError}</Text>}
        </View>
      )}
      {action.error && <Notice tone="danger">{action.error}</Notice>}
    </Dialog>
  );
}

const styles = StyleSheet.create({
  table: { gap: space.sm },
  check: { width: 72 },
  name: { width: 90 },
  flex: { flex: 1 },
  number: { fontVariant: ['tabular-nums'] },
});
