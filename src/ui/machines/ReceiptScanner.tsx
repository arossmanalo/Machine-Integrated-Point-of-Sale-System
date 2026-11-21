import { CameraView, useCameraPermissions, type BarcodeScanningResult, type CameraType } from 'expo-camera';
import { useRef, useState } from 'react';
import { Linking, StyleSheet, View } from 'react-native';

import { errorMessage, type ServiceContext } from '@/db/types';
import { useApp } from '@/state/AppProvider';

import { Button } from '../Button';
import { Notice, Row } from '../layout';
import { Text } from '../Text';
import { colors, radius, space } from '../theme';

/** Kept while the app runs, so staff pick the camera that faces the counter once. */
let preferredFacing: CameraType = 'front';

/**
 * Reads the QR code on an order receipt with the tablet's camera. `check` decides whether the
 * code is good for this start and throws with a message if not; the camera then pauses until
 * staff tap Scan again, so one wrong receipt held in view does not repeat the error.
 */
export function ReceiptScanner({
  prompt,
  check,
  onAccepted,
}: {
  prompt: string;
  check: (ctx: ServiceContext, scanned: string) => void;
  onAccepted: (scanned: string) => void;
}) {
  const { ctx } = useApp();
  const [permission, requestPermission] = useCameraPermissions();
  const [facing, setFacing] = useState<CameraType>(preferredFacing);
  const [problem, setProblem] = useState<string | null>(null);
  // The camera reports the same code many times a second; only the first read counts.
  const handled = useRef(false);

  function scanned({ data }: BarcodeScanningResult) {
    if (handled.current) return;
    handled.current = true;
    try {
      check(ctx, data);
      onAccepted(data);
    } catch (caught: unknown) {
      setProblem(errorMessage(caught));
    }
  }

  function scanAgain() {
    setProblem(null);
    handled.current = false;
  }

  function switchCamera() {
    preferredFacing = facing === 'front' ? 'back' : 'front';
    setFacing(preferredFacing);
  }

  if (!permission) return <Text tone="muted">Opening the camera…</Text>;
  if (!permission.granted) {
    return permission.canAskAgain ? (
      <Notice tone="warning" action={<Button label="Allow camera" onPress={() => void requestPermission()} />}>
        The app needs the camera to read the QR code on the receipt.
      </Notice>
    ) : (
      <Notice
        tone="warning"
        action={<Button label="Open settings" kind="secondary" onPress={() => void Linking.openSettings()} />}
      >
        Camera access is turned off for Laundry POS. Turn on Camera in the app settings, then come back.
      </Notice>
    );
  }

  return (
    <View style={styles.wrap}>
      <Text>{prompt}</Text>
      {problem ? (
        <Notice tone="danger" action={<Button label="Scan again" kind="secondary" onPress={scanAgain} />}>
          {problem}
        </Notice>
      ) : (
        <View style={styles.viewfinder}>
          <CameraView
            style={StyleSheet.absoluteFill}
            facing={facing}
            // A set ratio makes Android fit the preview inside the box; the default fill draws past
            // the dialog's edges, because the camera surface ignores overflow clipping.
            ratio="4:3"
            barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
            onBarcodeScanned={scanned}
          />
        </View>
      )}
      <Row>
        <Text variant="caption" tone="muted" style={styles.flex}>
          Hold the QR code on the receipt in front of the camera.
        </Text>
        <Button label="Switch camera" kind="quiet" icon="camera-flip-outline" onPress={switchCamera} />
      </Row>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: space.sm },
  viewfinder: {
    height: 300,
    overflow: 'hidden',
    borderRadius: radius.md,
    backgroundColor: colors.surfaceSunken,
  },
  flex: { flex: 1 },
});
