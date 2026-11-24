import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import type { MachineCycleRow, MachineRow } from '@/db/schema';
import { MACHINE_TYPE_LABELS, topUpOptions, topUpPulseCountFor } from '@/domain/machinePolicy';
import { formatPeso } from '@/domain/money';
import { STATUS_LABELS } from '@/machines/MachineController';
import { listCycles } from '@/services/cycles';
import { listMachines } from '@/services/machines';
import { getSetting } from '@/services/settings';
import { useApp } from '@/state/AppProvider';
import { useData } from '@/state/hooks';

import { Button } from '../Button';
import { Badge, Dialog } from '../controls';
import { EmptyState, ListRow, Panel, Row, Section } from '../layout';
import { Text } from '../Text';
import { space } from '../theme';

/** What the owner calls a start signal: one coin, as if dropped in the machine's slot. */
export function coins(count: number): string {
  return `${count} coin${count === 1 ? '' : 's'}`;
}

function OnOff({ on }: { on: boolean }) {
  return <Badge label={on ? 'On' : 'Off'} tone={on ? 'accent' : 'neutral'} />;
}

/**
 * The owner's read-only view of the machine setup. It names each setting broadly and leaves out
 * how the machines are wired and signalled; only the built-in developer changes the setup.
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

      <Section title="Machines">
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

function MachineDetails({
  machine,
  cycles,
  onClose,
}: {
  machine: MachineRow;
  cycles: readonly MachineCycleRow[];
  onClose: () => void;
}) {
  const usesCycles = cycles.some((cycle) => cycle.enabled);
  return (
    <Dialog
      visible
      title={machine.name}
      onClose={onClose}
      actions={<Button label="Close" kind="secondary" onPress={onClose} />}
    >
      <Panel>
        <ListRow title="Type" right={<Text>{MACHINE_TYPE_LABELS[machine.type]}</Text>} />
        <ListRow title="In use" right={<OnOff on={machine.enabled} />} last={usesCycles} />
        {!usesCycles && <ListRow title="Run time" right={<Text>{`${machine.runMinutes} min`}</Text>} />}
        {!usesCycles && <ListRow title="Coins" right={<Text>{coins(machine.pulseCount)}</Text>} last />}
      </Panel>

      {cycles.length > 0 && (
        <View style={styles.table}>
          <Row>
            <Text variant="label" style={styles.name}>
              Cycle
            </Text>
            <Text variant="label" style={styles.flex}>
              Coins
            </Text>
            <Text variant="label" style={styles.flex}>
              Minutes
            </Text>
            <Text variant="label" style={styles.state}>
              Offered
            </Text>
          </Row>
          {cycles.map((cycle) => (
            <Row key={cycle.id}>
              <Text style={styles.name}>{cycle.name}</Text>
              <Text style={[styles.flex, styles.number]}>{cycle.pulses}</Text>
              <Text style={[styles.flex, styles.number]}>{cycle.minutes}</Text>
              <View style={styles.state}>
                <OnOff on={cycle.enabled} />
              </View>
            </Row>
          ))}
        </View>
      )}

      {machine.type === 'DRYER' && (
        <View style={styles.table}>
          <Row>
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
          {topUpOptions(machine).length === 0 ? (
            <Text tone="muted">No top-ups offered.</Text>
          ) : (
            topUpOptions(machine).map((option) => (
              <Row key={option.minutes}>
                <Text style={styles.name}>{`${option.minutes} min`}</Text>
                <Text style={[styles.flex, styles.number]}>{topUpPulseCountFor(machine, option.minutes)}</Text>
                <Text style={[styles.flex, styles.number]}>{formatPeso(option.price)}</Text>
              </Row>
            ))
          )}
        </View>
      )}
    </Dialog>
  );
}

const styles = StyleSheet.create({
  table: { gap: space.sm },
  name: { width: 110 },
  state: { width: 80 },
  flex: { flex: 1 },
  number: { fontVariant: ['tabular-nums'] },
});
