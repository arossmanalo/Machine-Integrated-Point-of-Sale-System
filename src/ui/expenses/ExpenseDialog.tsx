import { useState } from 'react';
import { View } from 'react-native';

import { formatShopDate } from '@/domain/dates';
import { parsePesoInput } from '@/domain/money';
import { can } from '@/domain/permissions';
import { addExpense, EXPENSE_CATEGORIES } from '@/services/expenses';
import { useActor, useApp } from '@/state/AppProvider';
import { useAction } from '@/state/hooks';

import { Button } from '../Button';
import { Choice, Dialog, Stepper } from '../controls';
import { Notice, Row } from '../layout';
import { Text } from '../Text';
import { TextField } from '../TextField';

const DAY_MS = 24 * 60 * 60 * 1000;

/** Managers can date an expense up to a year back; employees only record today's. */
export function ExpenseDialog({ onClose, onSaved }: { onClose: () => void; onSaved?: () => void }) {
  const actor = useActor();
  const { ctx } = useApp();
  const action = useAction();
  const [name, setName] = useState('');
  const [category, setCategory] = useState<string>(EXPENSE_CATEGORIES[0]);
  const [costText, setCostText] = useState('');
  const [daysBack, setDaysBack] = useState(0);
  const cost = parsePesoInput(costText);
  const incurredAt = ctx.now() - daysBack * DAY_MS;
  const canBackdate = can.manageExpenses(actor.role);
  return (
    <Dialog
      visible
      title="Record expense"
      onClose={onClose}
      actions={
        <>
          <Button label="Cancel" kind="secondary" onPress={onClose} />
          <Button
            label="Save expense"
            busy={action.busy}
            disabled={cost === null || !name.trim()}
            onPress={async () => {
              const result = await action.run((c) =>
                addExpense(c, actor, { name, category, cost: cost ?? 0, incurredAt }),
              );
              if (result.ok) {
                onSaved?.();
                onClose();
              }
            }}
          />
        </>
      }
    >
      <TextField label="What for" value={name} onChangeText={setName} placeholder="For example: Meralco bill" />
      <Choice label="Category" value={category} onChange={setCategory} options={EXPENSE_CATEGORIES.map((c) => ({ value: c, label: c }))} />
      <TextField label="Cost" value={costText} onChangeText={setCostText} keyboardType="decimal-pad" prefix="₱" />
      {canBackdate ? (
        <Row>
          <View style={{ flex: 1 }}>
            <Text variant="label">Date</Text>
            <Text tone="muted">{daysBack === 0 ? 'Today' : formatShopDate(incurredAt)}</Text>
          </View>
          <Stepper label="days back" value={daysBack} min={0} max={365} onChange={setDaysBack} />
        </Row>
      ) : (
        <Text tone="muted">{`Recorded for today under your name, ${actor.username}.`}</Text>
      )}
      {action.error && <Notice tone="danger">{action.error}</Notice>}
    </Dialog>
  );
}
