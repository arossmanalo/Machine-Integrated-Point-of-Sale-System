import { useState } from 'react';

import type { CustomerRow } from '@/db/schema';
import { createCustomer, updateCustomer, type CustomerInput } from '@/services/customers';
import { useAction } from '@/state/hooks';

import { Button } from './Button';
import { Dialog } from './controls';
import { Notice } from './layout';
import { TextField } from './TextField';

/** Register a new customer, or edit one when `customer` is given. */
export function CustomerDialog({
  visible,
  customer,
  initialName = '',
  onClose,
  onSaved,
}: {
  visible: boolean;
  customer: CustomerRow | null;
  initialName?: string;
  onClose: () => void;
  onSaved?: (customerId: string) => void;
}) {
  const action = useAction();
  const [form, setForm] = useState<CustomerInput>(() => ({
    name: customer?.name ?? initialName,
    phone: customer?.phone ?? '',
    address: customer?.address ?? '',
    notes: customer?.notes ?? '',
  }));
  const set = (key: keyof CustomerInput) => (value: string) => setForm((f) => ({ ...f, [key]: value }));

  async function save() {
    const result = await action.run((ctx) => {
      if (customer) {
        updateCustomer(ctx, customer.id, form);
        return customer.id;
      }
      return createCustomer(ctx, form).id;
    });
    if (result.ok) {
      onSaved?.(result.value);
      onClose();
    }
  }

  return (
    <Dialog
      visible={visible}
      title={customer ? 'Edit customer' : 'New customer'}
      onClose={onClose}
      actions={
        <>
          <Button label="Cancel" kind="secondary" onPress={onClose} />
          <Button label={customer ? 'Save changes' : 'Add customer'} onPress={save} busy={action.busy} />
        </>
      }
    >
      <TextField label="Full name" value={form.name} onChangeText={set('name')} autoCapitalize="words" autoFocus />
      <TextField label="Phone (optional)" value={form.phone} onChangeText={set('phone')} keyboardType="phone-pad" />
      <TextField label="Address (optional)" value={form.address} onChangeText={set('address')} />
      <TextField label="Notes (optional)" value={form.notes} onChangeText={set('notes')} multiline />
      {action.error && <Notice tone="danger">{action.error}</Notice>}
    </Dialog>
  );
}
