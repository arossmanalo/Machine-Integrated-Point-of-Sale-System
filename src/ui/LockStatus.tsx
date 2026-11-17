import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { Pressable, StyleSheet } from 'react-native';

import { STATUS_LABELS } from '@/machines/MachineController';
import { useApp } from '@/state/AppProvider';

import { Text } from './Text';
import { colors, MIN_TOUCH, radius, space } from './theme';

/** Header chip showing whether the door-lock controller is connected. Tap to reconnect. */
export function LockStatusChip() {
  const { controller, controllerState } = useApp();
  const { status } = controllerState;
  const simulated = controller.kind === 'mock';
  const ok = status === 'ready';
  const color = ok ? colors.success : status === 'connecting' ? colors.warning : colors.danger;
  const label = simulated && ok ? 'Locks simulated' : STATUS_LABELS[status];
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${label}. ${ok ? '' : 'Tap to reconnect.'}`}
      onPress={() => {
        if (!ok) void controller.connect();
      }}
      style={({ pressed }) => [styles.chip, pressed && { backgroundColor: colors.surfaceSunken }]}
    >
      <MaterialCommunityIcons
        name={ok ? 'lock-check-outline' : status === 'connecting' ? 'lock-clock' : 'lock-alert-outline'}
        size={18}
        color={color}
      />
      <Text variant="caption" style={{ color }}>
        {label}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  chip: {
    minHeight: MIN_TOUCH,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.xs,
    paddingHorizontal: space.sm,
    borderRadius: radius.sm,
  },
});
