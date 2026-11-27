import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import type { DryerTopUpRow, MachineCycleRow, MachineRow } from '@/db/schema';
import { MACHINE_TYPE_LABELS } from '@/domain/machinePolicy';
import { centavosToInput, parsePesoInput } from '@/domain/money';
import { STATUS_LABELS } from '@/machines/MachineController';
import { PULSE_LIMITS } from '@/machines/protocol';
import { listCycles } from '@/services/cycles';
import {
  listMachines,
  saveOwnerMachineChanges,
  setMultiCycle,
  setRealTimeSync,
  setReceiptScanRequired,
} from '@/services/machines';
import { getSetting } from '@/services/settings';
import { listTopUps } from '@/services/topUps';
import { useActor, useApp } from '@/state/AppProvider';
import { useAction, useData } from '@/state/hooks';
import { useToast } from '@/state/toast';

import { Button } from '../Button';
import { Badge, Checkbox, Dialog, Toggle } from '../controls';
import { EmptyState, ListRow, Notice, Panel, Row, Section } from '../layout';
import { Text } from '../Text';
import { TextField } from '../TextField';
import { space } from '../theme';

/** The Real-time sync switch's explanation, the same for the owner and the developer. */
export const REAL_TIME_SYNC_TEXT =
  'Machines report when they start and stop. A running machine shows how long it has been running instead of ' +
  'a countdown, and it is free as soon as it stops.';

/** What the owner calls a start signal: one coin, as if dropped in the machine's slot. */
export function coins(count: number): string {
  return `${count} coin${count === 1 ? '' : 's'}`;
}

/**
 * The owner's view of the machine setup. It names each setting broadly and leaves out how the
 * machines are wired and signalled. The owner may switch machines and cycles on or off and set
 * coins and dryer top-up prices; everything else stays with the built-in developer.
 */
export function MachineOverview() {
  const actor = useActor();
  const action = useAction();
  const { controller, controllerState, reloadLockController } = useApp();
  const [viewing, setViewing] = useState<MachineRow | null>(null);
  const machines = useData(listMachines);
  const cycles = useData(listCycles);
  const topUps = useData(listTopUps);
  const settings = useData((c) => ({
    receiptScan: getSetting(c.db, 'requireReceiptScan'),
    multiCycle: getSetting(c.db, 'multiCycle'),
    realTimeSync: getSetting(c.db, 'realTimeSync'),
  }));
  const topUpsOf = (machine: MachineRow) => topUps.filter((topUp) => topUp.machineId === machine.id);
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
    const offered = topUpsOf(machine).filter((topUp) => topUp.enabled);
    const topUpText =
      offered.length === 0 ? 'no top-ups' : `top-ups ${offered.map((topUp) => topUp.name).join(', ')}`;
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
        <Toggle
          label="Scan receipt to run a machine"
          value={settings.receiptScan}
          onChange={(on) => void action.run((c) => setReceiptScanRequired(c, actor, on))}
        />
        <Toggle
          label="Multi-cycle"
          value={settings.multiCycle}
          onChange={(on) => void action.run((c) => setMultiCycle(c, actor, on))}
        />
        <Toggle
          label="Real-time sync"
          description={REAL_TIME_SYNC_TEXT}
          value={settings.realTimeSync}
          onChange={async (on) => {
            const result = await action.run((c) => setRealTimeSync(c, actor, on));
            if (result.ok) reloadLockController();
          }}
        />
        {action.error && <Notice tone="danger">{action.error}</Notice>}
      </Section>

      <Section title="Machines" description="Tap a machine to switch it off, choose its cycles, or change its coins and top-up prices.">
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
        <MachineDetails
          machine={viewing}
          cycles={cyclesOf(viewing)}
          topUps={topUpsOf(viewing)}
          onClose={() => setViewing(null)}
        />
      )}
    </>
  );
}

interface TopUpDraft {
  offered: boolean;
  coins: string;
  price: string;
}

function topUpDraft(topUp: DryerTopUpRow): TopUpDraft {
  return { offered: topUp.enabled, coins: String(topUp.pulses), price: topUp.price > 0 ? centavosToInput(topUp.price) : '' };
}

const digitsOnly = (text: string) => text.replace(/\D/g, '');

/** Each coin count the owner typed, labelled; the first one out of range is the error. */
function coinsError(entries: readonly [string, string][]): string | null {
  const { maxCount } = PULSE_LIMITS;
  const bad = entries.find(([, text]) => {
    const coins = Number(text);
    return text === '' || !Number.isInteger(coins) || coins < 1 || coins > maxCount;
  });
  return bad ? `${bad[0]}: enter 1 to ${maxCount} coins.` : null;
}

/**
 * The owner switches the machine and its cycles on or off and sets coins and a dryer's top-up
 * prices. Run times, timings and the cycles themselves stay with support.
 */
function MachineDetails({
  machine,
  cycles,
  topUps,
  onClose,
}: {
  machine: MachineRow;
  cycles: readonly MachineCycleRow[];
  topUps: readonly DryerTopUpRow[];
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
  const [drafts, setDrafts] = useState<Record<number, TopUpDraft>>(() =>
    Object.fromEntries(topUps.map((topUp) => [topUp.id, topUpDraft(topUp)])),
  );
  const draftOf = (topUp: DryerTopUpRow) => drafts[topUp.id] ?? topUpDraft(topUp);
  const [coinsText, setCoinsText] = useState(String(machine.pulseCount));
  const [cycleCoins, setCycleCoins] = useState<Record<number, string>>(() =>
    Object.fromEntries(cycles.map((cycle) => [cycle.id, String(cycle.pulses)])),
  );
  const cycleCoinsOf = (cycle: MachineCycleRow) => cycleCoins[cycle.id] ?? String(cycle.pulses);
  const isOffered = (cycle: MachineCycleRow) => offered[cycle.id] ?? cycle.enabled;
  const usesCycles = cycles.some(isOffered);
  // An offered top-up needs a price above zero; an unticked one keeps its price for later.
  const priceOf = (topUp: DryerTopUpRow) => {
    const text = draftOf(topUp).price;
    return text.trim() === '' ? 0 : parsePesoInput(text);
  };
  const badPrice = topUps.find((topUp) => {
    const price = priceOf(topUp);
    return price === null || (draftOf(topUp).offered && price === 0);
  });
  const topUpError = badPrice ? `${badPrice.name}: enter a price like 20 or 20.50, or untick it.` : null;
  const coinError = coinsError([
    ['Coins', coinsText],
    ...cycles.map((cycle): [string, string] => [cycle.name, cycleCoinsOf(cycle)]),
    ...topUps.map((topUp): [string, string] => [`${topUp.name} top-up`, draftOf(topUp).coins]),
  ]);

  function setDraft(topUp: DryerTopUpRow, change: Partial<TopUpDraft>) {
    setDrafts({ ...drafts, [topUp.id]: { ...draftOf(topUp), ...change } });
  }

  async function save() {
    const changes = {
      enabled,
      coins: Number(coinsText),
      cycles: cycles.map((cycle) => ({ id: cycle.id, enabled: isOffered(cycle), coins: Number(cycleCoinsOf(cycle)) })),
      topUps: topUps.map((topUp) => ({
        id: topUp.id,
        enabled: draftOf(topUp).offered,
        coins: Number(draftOf(topUp).coins),
        price: priceOf(topUp) ?? 0,
      })),
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
          <Button label="Save changes" onPress={() => void save()} busy={action.busy} disabled={topUpError !== null || coinError !== null} />
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
        {!usesCycles && <ListRow title="Run time" right={<Text>{`${machine.runMinutes} min`}</Text>} last />}
      </Panel>
      {!usesCycles && (
        <TextField
          label="Coins per start"
          value={coinsText}
          onChangeText={(text) => setCoinsText(digitsOnly(text))}
          keyboardType="number-pad"
        />
      )}

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
              <TextField
                label={`${cycle.name} coins`}
                hideLabel
                value={cycleCoinsOf(cycle)}
                onChangeText={(text) => setCycleCoins({ ...cycleCoins, [cycle.id]: digitsOnly(text) })}
                keyboardType="number-pad"
                style={styles.flex}
              />
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
          {topUps.length === 0 && <Text tone="muted">No top-ups on this dryer. Support adds them.</Text>}
          {topUps.map((topUp) => (
            <Row key={topUp.id}>
              <View style={styles.check}>
                <Checkbox
                  label=""
                  accessibilityLabel={`Offer the ${topUp.name} top-up`}
                  value={draftOf(topUp).offered}
                  onChange={(on) => setDraft(topUp, { offered: on })}
                />
              </View>
              <View style={styles.name}>
                <Text>{topUp.name}</Text>
                <Text variant="caption" tone="muted">{`${topUp.minutes} min`}</Text>
              </View>
              <TextField
                label={`${topUp.name} top-up coins`}
                hideLabel
                value={draftOf(topUp).coins}
                onChangeText={(text) => setDraft(topUp, { coins: digitsOnly(text) })}
                keyboardType="number-pad"
                style={styles.flex}
              />
              <TextField
                label={`${topUp.name} top-up price`}
                hideLabel
                value={draftOf(topUp).price}
                onChangeText={(price) => setDraft(topUp, { price })}
                keyboardType="decimal-pad"
                prefix="₱"
                style={styles.flex}
              />
            </Row>
          ))}
          {topUpError && <Text tone="danger">{topUpError}</Text>}
        </View>
      )}
      {coinError && <Text tone="danger">{coinError}</Text>}
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
