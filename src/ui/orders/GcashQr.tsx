import { File, Paths } from 'expo-file-system';
import { launchImageLibraryAsync } from 'expo-image-picker';
import { useState } from 'react';
import { Image, StyleSheet, View } from 'react-native';

import { gcashQrFile, setGcashQrFile } from '@/services/gcashQr';
import { useActor, useApp } from '@/state/AppProvider';
import { useAction, useData } from '@/state/hooks';
import { useToast } from '@/state/toast';

import { Button } from '../Button';
import { Notice, Row } from '../layout';
import { Text } from '../Text';
import { colors, radius, space } from '../theme';

const QR_SIZE = 260;

function qrUri(fileName: string): string {
  return new File(Paths.document, fileName).uri;
}

/** Shown while a GCash payment is being taken, so the customer can scan and pay. */
export function GcashQrForCustomer() {
  const fileName = useData((c) => gcashQrFile(c));
  // A restored backup keeps the setting but not the image, so check the file is really there.
  if (fileName === null || !new File(Paths.document, fileName).exists) {
    return <Text tone="muted">No GCash QR code yet. The owner can add one in Manage › Shop settings.</Text>;
  }
  return (
    <View style={styles.forCustomer}>
      <Image
        source={{ uri: qrUri(fileName) }}
        style={styles.qr}
        resizeMode="contain"
        accessibilityLabel="Shop GCash QR code"
      />
      <Text tone="muted">Let the customer scan this with GCash, then enter the reference number from their receipt.</Text>
    </View>
  );
}

/**
 * Owner only. Picks an image from the gallery, lets the owner crop it to a square around the QR
 * code, and keeps a copy in the app so it still shows if the original is deleted.
 */
export function GcashQrSetting() {
  const actor = useActor();
  const { ctx } = useApp();
  const action = useAction();
  const toast = useToast();
  const fileName = useData((c) => gcashQrFile(c));
  const [picking, setPicking] = useState(false);

  async function upload() {
    setPicking(true);
    try {
      const picked = await launchImageLibraryAsync({
        mediaTypes: 'images',
        allowsEditing: true,
        aspect: [1, 1],
        quality: 0.9,
      });
      if (picked.canceled) return;
      const asset = picked.assets[0];
      if (!asset) return;
      const extension = (asset.fileName ?? asset.uri).split('.').pop()?.toLowerCase() ?? 'jpg';
      const safeExtension = ['jpg', 'jpeg', 'png', 'webp'].includes(extension) ? extension : 'jpg';
      // A new name each time, so the screen does not keep showing a cached copy of the old one.
      const name = `gcash-qr-${ctx.now()}.${safeExtension}`;
      const saved = new File(Paths.document, name);
      new File(asset.uri).copy(saved);
      const result = await action.run((c) => setGcashQrFile(c, actor, name));
      if (!result.ok) {
        saved.delete();
        return;
      }
      if (fileName) removeFile(fileName);
      toast('GCash QR code saved', 'success');
    } finally {
      setPicking(false);
    }
  }

  async function remove() {
    const result = await action.run((c) => setGcashQrFile(c, actor, null));
    if (result.ok && fileName) removeFile(fileName);
  }

  function removeFile(name: string) {
    const old = new File(Paths.document, name);
    // Only clean-up: the setting no longer points at it, so a leftover file is harmless.
    if (old.exists) old.delete();
  }

  if (actor.role !== 'OWNER') return null;
  return (
    <View style={styles.setting}>
      <Text variant="label">GCash QR code</Text>
      <Text tone="muted">
        Shown to the customer when they pay by GCash. Upload a screenshot of your GCash QR, then crop it to the square
        code. Only the owner can change it.
      </Text>
      {fileName ? (
        <Image source={{ uri: qrUri(fileName) }} style={styles.preview} resizeMode="contain" accessibilityLabel="Current GCash QR code" />
      ) : (
        <Text tone="muted">No QR code yet.</Text>
      )}
      <Row wrap>
        <Button
          label={fileName ? 'Replace QR code' : 'Upload QR code'}
          kind="secondary"
          icon="qrcode-plus"
          onPress={() => void upload()}
          busy={picking || action.busy}
        />
        {fileName && <Button label="Remove" kind="quiet" onPress={() => void remove()} busy={action.busy} />}
      </Row>
      {action.error && <Notice tone="danger">{action.error}</Notice>}
    </View>
  );
}

const styles = StyleSheet.create({
  forCustomer: { gap: space.sm, alignItems: 'flex-start' },
  qr: {
    width: QR_SIZE,
    height: QR_SIZE,
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
  },
  setting: { gap: space.sm },
  preview: { width: 160, height: 160, borderRadius: radius.sm, borderWidth: 1, borderColor: colors.border },
});
