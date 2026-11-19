import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import type { ReactNode } from 'react';
import { KeyboardAvoidingView, Modal, Pressable, ScrollView, StyleSheet, Switch, View } from 'react-native';
import { SafeAreaProvider, useSafeAreaInsets } from 'react-native-safe-area-context';

import { Text } from './Text';
import { colors, elevation, MIN_TOUCH, radius, space } from './theme';

/** One choice from a short list, shown as a row of options. */
export function Choice<T extends string>({
  label,
  options,
  value,
  onChange,
}: {
  label?: string;
  options: readonly { value: T; label: string }[];
  value: T;
  onChange: (value: T) => void;
}) {
  return (
    <View style={styles.choiceWrap}>
      {label !== undefined && <Text variant="label">{label}</Text>}
      <View style={styles.choiceRow} accessibilityRole="radiogroup">
        {options.map((option) => {
          const selected = option.value === value;
          return (
            <Pressable
              key={option.value}
              accessibilityRole="radio"
              accessibilityState={{ selected }}
              onPress={() => onChange(option.value)}
              style={({ pressed }) => [
                styles.choice,
                selected && styles.choiceSelected,
                pressed && !selected && { backgroundColor: colors.surfaceSunken },
              ]}
            >
              {selected && <MaterialCommunityIcons name="check" size={18} color={colors.accent} />}
              <Text variant="label" tone={selected ? 'accent' : 'default'}>
                {option.label}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

export function Toggle({
  label,
  description,
  value,
  onChange,
  disabled = false,
}: {
  label: string;
  description?: string;
  value: boolean;
  onChange: (value: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <Pressable
      accessibilityRole="switch"
      accessibilityState={{ checked: value, disabled }}
      disabled={disabled}
      onPress={() => onChange(!value)}
      style={styles.toggle}
    >
      <View style={styles.flex}>
        <Text variant="bodyStrong">{label}</Text>
        {description !== undefined && <Text tone="muted">{description}</Text>}
      </View>
      <Switch
        value={value}
        onValueChange={onChange}
        disabled={disabled}
        trackColor={{ true: colors.accent, false: colors.border }}
        thumbColor={colors.surface}
      />
    </Pressable>
  );
}

/** Minus / number / plus, for quantities. */
export function Stepper({
  value,
  onChange,
  min = 0,
  max = 99,
  label,
}: {
  value: number;
  onChange: (value: number) => void;
  min?: number;
  max?: number;
  label: string;
}) {
  return (
    <View style={styles.stepper} accessibilityLabel={`${label}: ${value}`}>
      <StepButton icon="minus" label={`Fewer ${label}`} disabled={value <= min} onPress={() => onChange(value - 1)} />
      <Text variant="bodyStrong" numeric style={styles.stepValue}>
        {value}
      </Text>
      <StepButton icon="plus" label={`More ${label}`} disabled={value >= max} onPress={() => onChange(value + 1)} />
    </View>
  );
}

function StepButton({
  icon,
  label,
  disabled,
  onPress,
}: {
  icon: 'minus' | 'plus';
  label: string;
  disabled: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [styles.stepButton, pressed && { backgroundColor: colors.surfaceSunken }, disabled && { opacity: 0.4 }]}
    >
      <MaterialCommunityIcons name={icon} size={20} color={colors.text} />
    </Pressable>
  );
}

const badgeTones = {
  neutral: { bg: colors.surfaceSunken, fg: 'default' as const },
  accent: { bg: colors.accentSoft, fg: 'accent' as const },
  success: { bg: colors.successSoft, fg: 'success' as const },
  warning: { bg: colors.warningSoft, fg: 'warning' as const },
  danger: { bg: colors.dangerSoft, fg: 'danger' as const },
};

export type BadgeTone = keyof typeof badgeTones;

export function Badge({ label, tone = 'neutral' }: { label: string; tone?: BadgeTone }) {
  const look = badgeTones[tone];
  return (
    <View style={[styles.badge, { backgroundColor: look.bg }]}>
      <Text variant="caption" tone={look.fg} style={styles.badgeText}>
        {label}
      </Text>
    </View>
  );
}

interface DialogProps {
  visible: boolean;
  title: string;
  onClose: () => void;
  children: ReactNode;
  actions: ReactNode;
}

/**
 * A modal sheet with a title, scrollable body and actions along the bottom. The modal is its own
 * window, so it gets its own SafeAreaProvider: the insets of the main screen do not cover it, and
 * without this the actions slid under tablet taskbars and navigation bars.
 */
export function Dialog({ visible, onClose, ...rest }: DialogProps) {
  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onClose}
      statusBarTranslucent
      navigationBarTranslucent
    >
      <SafeAreaProvider>
        <DialogFrame visible={visible} onClose={onClose} {...rest} />
      </SafeAreaProvider>
    </Modal>
  );
}

function DialogFrame({ title, onClose, children, actions }: DialogProps) {
  const insets = useSafeAreaInsets();
  return (
    <KeyboardAvoidingView
      behavior="padding"
      style={[
        styles.scrim,
        {
          paddingTop: insets.top + space.lg,
          paddingBottom: insets.bottom + space.lg,
          paddingLeft: insets.left + space.lg,
          paddingRight: insets.right + space.lg,
        },
      ]}
    >
      <View style={styles.dialog} accessibilityViewIsModal>
        <View style={styles.dialogHeader}>
          <Text variant="heading" style={styles.flex}>
            {title}
          </Text>
          <Pressable accessibilityRole="button" accessibilityLabel="Close" onPress={onClose} style={styles.close}>
            <MaterialCommunityIcons name="close" size={22} color={colors.textMuted} />
          </Pressable>
        </View>
        <ScrollView contentContainerStyle={styles.dialogBody} keyboardShouldPersistTaps="handled">
          {children}
        </ScrollView>
        <View style={styles.dialogActions}>{actions}</View>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  choiceWrap: { gap: space.xs },
  choiceRow: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  choice: {
    minHeight: MIN_TOUCH,
    paddingHorizontal: space.lg,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.xs,
  },
  choiceSelected: { borderColor: colors.accent, borderWidth: 2, backgroundColor: colors.accentSoft },
  toggle: { flexDirection: 'row', alignItems: 'center', gap: space.md, minHeight: MIN_TOUCH },
  stepper: { flexDirection: 'row', alignItems: 'center', gap: space.xs },
  stepButton: {
    width: MIN_TOUCH,
    height: MIN_TOUCH,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepValue: { minWidth: 36, textAlign: 'center' },
  badge: { alignSelf: 'flex-start', borderRadius: radius.sm, paddingHorizontal: space.sm, paddingVertical: 2 },
  badgeText: { fontFamily: 'IBMPlexSans_500Medium' },
  scrim: {
    flex: 1,
    backgroundColor: 'rgba(11, 18, 32, 0.45)',
    justifyContent: 'center',
  },
  dialog: {
    width: '100%',
    maxWidth: 560,
    maxHeight: '100%',
    alignSelf: 'center',
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    ...elevation,
  },
  dialogHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingLeft: space.xl,
    paddingRight: space.sm,
    paddingTop: space.md,
  },
  close: { width: MIN_TOUCH, height: MIN_TOUCH, alignItems: 'center', justifyContent: 'center' },
  dialogBody: { paddingHorizontal: space.xl, paddingVertical: space.md, gap: space.lg },
  dialogActions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'flex-end',
    gap: space.sm,
    padding: space.lg,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
  },
});
