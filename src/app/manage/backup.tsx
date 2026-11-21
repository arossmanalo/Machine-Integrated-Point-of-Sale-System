import { getDocumentAsync } from 'expo-document-picker';
import { File, Paths } from 'expo-file-system';
import { router } from 'expo-router';
import { shareAsync } from 'expo-sharing';
import { useState } from 'react';

import { formatShopDateStamp } from '@/domain/dates';
import { can } from '@/domain/permissions';
import { logOut } from '@/services/auth';
import { detectBackupKind, exportBackup, importLegacyExport, restoreBackup } from '@/services/backup';
import { useActor, useApp } from '@/state/AppProvider';
import { useAction } from '@/state/hooks';
import { useToast } from '@/state/toast';
import { Button } from '@/ui/Button';
import { Dialog } from '@/ui/controls';
import { Notice, Screen, Section } from '@/ui/layout';
import { ManageScreen } from '@/ui/ManagerGate';
import { Text } from '@/ui/Text';

type Picked = { kind: 'backup' | 'legacy'; data: unknown; name: string };

export default function Backup() {
  const { ctx, setUser } = useApp();
  const actor = useActor();
  const action = useAction();
  const toast = useToast();
  const [picked, setPicked] = useState<Picked | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  async function exportData() {
    const result = await action.run(async (c) => {
      const file = new File(Paths.cache, `laundry-pos-backup-${formatShopDateStamp(c.now())}.json`);
      if (file.exists) file.delete();
      file.create();
      await file.write(JSON.stringify(exportBackup(c, actor)));
      await shareAsync(file.uri, { mimeType: 'application/json', dialogTitle: 'Save the backup' });
    });
    if (result.ok) toast('Backup ready. Save it to Drive, email or another phone.');
  }

  async function pickFile() {
    setMessage(null);
    const result = await action.run(async () => {
      const choice = await getDocumentAsync({ type: ['application/json', 'text/plain', '*/*'], copyToCacheDirectory: true });
      if (choice.canceled) return null;
      const asset = choice.assets[0];
      const text = await new File(asset.uri).text();
      let data: unknown;
      try {
        data = JSON.parse(text);
      } catch {
        throw new Error('That file is not JSON. Pick a backup or an export from the old app.');
      }
      const kind = detectBackupKind(data);
      if (kind === 'unknown') throw new Error('This file is not a Laundry POS backup or an old-app export.');
      return { kind, data, name: asset.name };
    });
    if (result.ok && result.value) setPicked(result.value);
  }

  async function apply() {
    if (!picked) return;
    const result = await action.run((c) =>
      picked.kind === 'backup' ? { restored: restoreBackup(c, actor, picked.data) }
        : { imported: importLegacyExport(c, actor, picked.data) },
    );
    setPicked(null);
    if (!result.ok) return;
    if ('restored' in result.value) {
      // The restored staff list may not include the person signed in now.
      logOut(ctx);
      setUser(null);
      router.replace('/login');
      return;
    }
    const s = result.value.imported;
    setMessage(
      `Imported ${s.orders} orders, ${s.payments} payments, ${s.customers} customers, ${s.inventoryItems} stock items, ` +
        `${s.expenses} expenses and ${s.users} staff accounts.` +
        (s.renumbered > 0 ? ` ${s.renumbered} records got new numbers because theirs were taken.` : '') +
        (s.users > 0 ? ' Imported staff need a new password from Staff before they can sign in.' : ''),
    );
  }

  return (
    <ManageScreen title="Backup and import" allowed={can.manageBackups}>
      <Screen>
        <Section
          title="Back up"
          description="Everything is stored only on this tablet. Save a backup at least once a week and keep it somewhere else."
        >
          <Button label="Save a backup" icon="database-export-outline" onPress={exportData} busy={action.busy} />
        </Section>
        <Section
          title="Restore or import"
          description="Pick a backup made by this app to replace all data, or an export from the old app to add its records."
        >
          <Button label="Pick a file" kind="secondary" icon="file-upload-outline" onPress={pickFile} busy={action.busy} />
        </Section>
        {message && <Notice tone="success">{message}</Notice>}
        {action.error && <Notice tone="danger">{action.error}</Notice>}
      </Screen>
      {picked && (
        <Dialog
          visible
          title={picked.kind === 'backup' ? 'Replace all data?' : 'Import from the old app?'}
          onClose={() => setPicked(null)}
          actions={
            <>
              <Button label="Cancel" kind="secondary" onPress={() => setPicked(null)} />
              <Button
                label={picked.kind === 'backup' ? 'Replace everything' : 'Import records'}
                kind={picked.kind === 'backup' ? 'danger' : 'primary'}
                onPress={apply}
                busy={action.busy}
              />
            </>
          }
        >
          <Text>{picked.name}</Text>
          {picked.kind === 'backup' ? (
            <Notice tone="warning">
              Every order, customer, staff account, setting and machine log entry on this tablet is replaced by the backup.
              This cannot be undone, so save a backup of the current data first. You will be signed out.
            </Notice>
          ) : (
            <Text tone="muted">
              Customers, stock, expenses, orders and payments are added to what is already here. Passwords are not
              copied. Prices and statuses are not in the old file, so check Shop settings afterwards.
            </Text>
          )}
        </Dialog>
      )}
    </ManageScreen>
  );
}
