import { useState } from 'react';

import { changeDue, PAYMENT_CHANNEL_LABELS, PAYMENT_CHANNELS, type PaymentChannel } from '@/domain/payments';
import { formatPeso, parsePesoInput } from '@/domain/money';
import { receivePayment } from '@/services/orders';
import { useActor } from '@/state/AppProvider';
import { useAction } from '@/state/hooks';
import { useToast } from '@/state/toast';

import { Button } from '../Button';
import { Choice, Dialog } from '../controls';
import { Notice } from '../layout';
import { Text } from '../Text';
import { TextField } from '../TextField';

import { GcashQrForCustomer } from './GcashQr';

/** Records a payment on an order, starting with the full balance filled in. */
export function PaymentDialog({ orderId, balance, onClose }: { orderId: string; balance: number; onClose: () => void }) {
  const actor = useActor();
  const action = useAction();
  const toast = useToast();
  const [amountText, setAmountText] = useState(String(balance / 100));
  const [channel, setChannel] = useState<PaymentChannel>('CASH');
  const [cashText, setCashText] = useState('');
  const [reference, setReference] = useState('');
  const amount = parsePesoInput(amountText);
  const cash = cashText.trim() ? parsePesoInput(cashText) : null;

  async function submit() {
    if (amount === null) return;
    const result = await action.run((c) =>
      receivePayment(c, actor, orderId, { amount, channel, gcashReference: reference, cashReceived: channel === 'CASH' ? cash : null }),
    );
    if (result.ok) {
      toast(`${formatPeso(result.value)} recorded for ${orderId}`);
      onClose();
    }
  }

  return (
    <Dialog
      visible
      title="Receive payment"
      onClose={onClose}
      actions={
        <>
          <Button label="Cancel" kind="secondary" onPress={onClose} />
          <Button
            label={amount !== null ? `Record ${formatPeso(Math.min(amount, balance))}` : 'Record payment'}
            onPress={submit}
            busy={action.busy}
            disabled={amount === null || amount <= 0 || (channel === 'GCASH' && !reference.trim())}
          />
        </>
      }
    >
      <Text>{`Balance due: ${formatPeso(balance)}`}</Text>
      <TextField
        label="Amount"
        value={amountText}
        onChangeText={setAmountText}
        keyboardType="decimal-pad"
        prefix="₱"
        error={amountText && amount === null ? 'Enter an amount like 150 or 150.50.' : null}
        hint={amount !== null && amount > balance ? `Only ${formatPeso(balance)} will be recorded.` : undefined}
      />
      <Choice
        label="Paid with"
        value={channel}
        onChange={setChannel}
        options={PAYMENT_CHANNELS.map((c) => ({ value: c, label: PAYMENT_CHANNEL_LABELS[c] }))}
      />
      {channel === 'CASH' ? (
        <TextField
          label="Cash received (optional)"
          value={cashText}
          onChangeText={setCashText}
          keyboardType="decimal-pad"
          prefix="₱"
          hint={
            cash !== null && amount !== null ? `Change: ${formatPeso(changeDue(cash, Math.min(amount, balance)))}` : undefined
          }
        />
      ) : (
        <>
          <GcashQrForCustomer />
          <TextField label="GCash reference number" value={reference} onChangeText={setReference} keyboardType="number-pad" />
        </>
      )}
      {action.error && <Notice tone="danger">{action.error}</Notice>}
    </Dialog>
  );
}
