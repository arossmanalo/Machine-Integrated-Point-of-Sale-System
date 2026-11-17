import { useState } from 'react';

import type { InventoryItemRow } from '@/db/schema';
import { isLowStock } from '@/domain/inventory';
import { centavosToInput, formatPeso, parsePesoInput } from '@/domain/money';
import { can } from '@/domain/permissions';
import {
  adjustStock,
  archiveInventoryItem,
  createInventoryItem,
  listInventory,
  updateInventoryItem,
} from '@/services/inventory';
import { useActor } from '@/state/AppProvider';
import { useAction, useData } from '@/state/hooks';
import { Button } from '@/ui/Button';
import { Badge, Choice, Dialog, Toggle } from '@/ui/controls';
import { EmptyState, ListRow, Notice, Panel, Row, Screen, Section } from '@/ui/layout';
import { Text } from '@/ui/Text';
import { TextField } from '@/ui/TextField';

export default function Stock() {
  const actor = useActor();
  const manager = can.manageInventoryItems(actor.role);
  const [query, setQuery] = useState('');
  const [adjusting, setAdjusting] = useState<InventoryItemRow | null>(null);
  const [editing, setEditing] = useState<InventoryItemRow | 'new' | null>(null);
  const items = useData(listInventory);
  const q = query.trim().toLowerCase();
  const filtered = items.filter((item) => !q || item.name.toLowerCase().includes(q));
  const lowCount = items.filter(isLowStock).length;

  return (
    <Screen>
      {lowCount > 0 && <Notice tone="warning">{`${lowCount} item${lowCount === 1 ? ' is' : 's are'} low on stock.`}</Notice>}
      <Section
        title="Stock"
        action={manager ? <Button label="Add item" icon="plus" onPress={() => setEditing('new')} /> : undefined}
      >
        <TextField label="Search" value={query} onChangeText={setQuery} placeholder="Item name" />
        <Panel>
          {filtered.length === 0 ? (
            <EmptyState
              icon="package-variant"
              title={items.length === 0 ? 'No stock items yet' : 'Nothing matches'}
              body={
                items.length === 0
                  ? 'Add detergent, fabric softener and other supplies to track them. Items with an add-on price can be sold with orders.'
                  : 'Try another name.'
              }
            />
          ) : (
            filtered.map((item, index) => (
              <ListRow
                key={item.id}
                title={item.name}
                subtitle={[
                  `${item.id}`,
                  item.autoConsume ? '1 used per load' : null,
                  item.addOnPrice > 0 ? `Add-on ${formatPeso(item.addOnPrice)}` : null,
                ]
                  .filter(Boolean)
                  .join(' · ')}
                right={
                  <Row>
                    {isLowStock(item) && <Badge label="Low" tone="danger" />}
                    <Text variant="bodyStrong" numeric>
                      {`${item.currentStock} ${item.unit}`}
                    </Text>
                  </Row>
                }
                onPress={() => setAdjusting(item)}
                last={index === filtered.length - 1}
              />
            ))
          )}
        </Panel>
      </Section>

      {adjusting && (
        <AdjustDialog
          item={adjusting}
          canEdit={manager}
          onClose={() => setAdjusting(null)}
          onEdit={() => {
            setEditing(adjusting);
            setAdjusting(null);
          }}
        />
      )}
      {editing && <ItemDialog item={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}
    </Screen>
  );
}

function AdjustDialog({
  item,
  canEdit,
  onClose,
  onEdit,
}: {
  item: InventoryItemRow;
  canEdit: boolean;
  onClose: () => void;
  onEdit: () => void;
}) {
  const action = useAction();
  const [mode, setMode] = useState<'restock' | 'use'>('restock');
  const [qtyText, setQtyText] = useState('');
  const qty = Number(qtyText);
  const valid = Number.isInteger(qty) && qty > 0;
  return (
    <Dialog
      visible
      title={item.name}
      onClose={onClose}
      actions={
        <>
          {canEdit && <Button label="Edit item" kind="secondary" onPress={onEdit} />}
          <Button
            label={mode === 'restock' ? 'Add to stock' : 'Take from stock'}
            busy={action.busy}
            disabled={!valid}
            onPress={async () => {
              const result = await action.run((c) => adjustStock(c, item.id, mode === 'restock' ? qty : -qty));
              if (result.ok) onClose();
            }}
          />
        </>
      }
    >
      <Text>{`In stock: ${item.currentStock} ${item.unit}. Low-stock level: ${item.lowStockThreshold}.`}</Text>
      <Choice
        value={mode}
        onChange={setMode}
        options={[
          { value: 'restock', label: 'Restock' },
          { value: 'use', label: 'Use / remove' },
        ]}
      />
      <TextField label={`Quantity (${item.unit})`} value={qtyText} onChangeText={setQtyText} keyboardType="number-pad" />
      {action.error && <Notice tone="danger">{action.error}</Notice>}
    </Dialog>
  );
}

function ItemDialog({ item, onClose }: { item: InventoryItemRow | null; onClose: () => void }) {
  const action = useAction();
  const [name, setName] = useState(item?.name ?? '');
  const [unit, setUnit] = useState(item?.unit ?? 'pcs');
  const [stockText, setStockText] = useState(String(item?.currentStock ?? 0));
  const [thresholdText, setThresholdText] = useState(String(item?.lowStockThreshold ?? 5));
  const [priceText, setPriceText] = useState(item ? centavosToInput(item.addOnPrice) : '0');
  const [autoConsume, setAutoConsume] = useState(item?.autoConsume ?? false);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const price = parsePesoInput(priceText);

  async function save() {
    const input = {
      name,
      unit,
      currentStock: Number(stockText),
      lowStockThreshold: Number(thresholdText),
      autoConsume,
      addOnPrice: price ?? -1,
    };
    const result = await action.run((c) => {
      if (item) updateInventoryItem(c, item.id, input);
      else createInventoryItem(c, input);
    });
    if (result.ok) onClose();
  }

  return (
    <Dialog
      visible
      title={item ? `Edit ${item.name}` : 'New stock item'}
      onClose={onClose}
      actions={
        <>
          {item &&
            (confirmRemove ? (
              <Button
                label="Yes, remove"
                kind="danger"
                onPress={async () => {
                  const result = await action.run((c) => archiveInventoryItem(c, item.id));
                  if (result.ok) onClose();
                }}
              />
            ) : (
              <Button label="Remove item" kind="danger" onPress={() => setConfirmRemove(true)} />
            ))}
          <Button label={item ? 'Save changes' : 'Add item'} onPress={save} busy={action.busy} />
        </>
      }
    >
      <TextField label="Name" value={name} onChangeText={setName} autoCapitalize="words" />
      <Row wrap>
        <TextField label="In stock" value={stockText} onChangeText={setStockText} keyboardType="number-pad" style={{ flex: 1 }} />
        <TextField label="Unit" value={unit} onChangeText={setUnit} autoCapitalize="none" hint="pcs, L, kg, scoops" style={{ flex: 1 }} />
      </Row>
      <TextField
        label="Low-stock level"
        value={thresholdText}
        onChangeText={setThresholdText}
        keyboardType="number-pad"
        hint="Warn when stock reaches this number."
      />
      <TextField
        label="Add-on price"
        value={priceText}
        onChangeText={setPriceText}
        keyboardType="decimal-pad"
        prefix="₱"
        hint="Above 0 lets staff add it to orders. 0 keeps it as a supply only."
        error={price === null ? 'Enter an amount like 15 or 15.50.' : null}
      />
      <Toggle
        label="Use one per load"
        description="Takes one unit off for every load ordered, such as detergent."
        value={autoConsume}
        onChange={setAutoConsume}
      />
      {confirmRemove && <Notice tone="danger">The item is hidden from stock and add-ons. Past orders keep it.</Notice>}
      {action.error && <Notice tone="danger">{action.error}</Notice>}
    </Dialog>
  );
}
