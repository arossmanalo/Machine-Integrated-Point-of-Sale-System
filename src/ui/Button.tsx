import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import type { ComponentProps } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

import { Text } from './Text';
import { colors, MIN_TOUCH, radius, space } from './theme';

export type IconName = ComponentProps<typeof MaterialCommunityIcons>['name'];
type Kind = 'primary' | 'secondary' | 'quiet' | 'danger';

interface Props {
  label: string;
  onPress: () => void;
  kind?: Kind;
  icon?: IconName;
  disabled?: boolean;
  busy?: boolean;
  /** Fill the width of the parent. */
  block?: boolean;
  style?: StyleProp<ViewStyle>;
  accessibilityHint?: string;
}

const kinds: Record<Kind, { bg: string; pressed: string; text: 'onAccent' | 'accent' | 'danger' | 'default'; border?: string }> = {
  primary: { bg: colors.accent, pressed: colors.accentPressed, text: 'onAccent' },
  secondary: { bg: colors.surface, pressed: colors.surfaceSunken, text: 'default', border: colors.border },
  quiet: { bg: 'transparent', pressed: colors.surfaceSunken, text: 'accent' },
  danger: { bg: colors.surface, pressed: colors.dangerSoft, text: 'danger', border: colors.danger },
};

const iconColors = {
  onAccent: colors.textOnAccent,
  accent: colors.accent,
  danger: colors.danger,
  default: colors.text,
};

export function Button({
  label,
  onPress,
  kind = 'primary',
  icon,
  disabled = false,
  busy = false,
  block = false,
  style,
  accessibilityHint,
}: Props) {
  const look = kinds[kind];
  const inactive = disabled || busy;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint={accessibilityHint}
      accessibilityState={{ disabled: inactive, busy }}
      disabled={inactive}
      onPress={onPress}
      style={({ pressed }) => [
        styles.base,
        { backgroundColor: pressed ? look.pressed : look.bg },
        look.border !== undefined && { borderWidth: 1, borderColor: look.border },
        block ? styles.block : styles.fit,
        inactive && styles.inactive,
        style,
      ]}
    >
      <View style={styles.content}>
        {busy ? (
          <ActivityIndicator color={iconColors[look.text]} />
        ) : (
          icon !== undefined && <MaterialCommunityIcons name={icon} size={20} color={iconColors[look.text]} />
        )}
        <Text variant="label" tone={look.text === 'default' ? 'default' : look.text} numberOfLines={1}>
          {label}
        </Text>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    minHeight: MIN_TOUCH,
    paddingHorizontal: space.lg,
    borderRadius: radius.sm,
    justifyContent: 'center',
  },
  block: { alignSelf: 'stretch' },
  fit: { alignSelf: 'flex-start' },
  content: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: space.sm,
  },
  inactive: { opacity: 0.45 },
});
