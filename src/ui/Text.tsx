import type { ReactNode } from 'react';
import { Text as NativeText, type StyleProp, type TextStyle } from 'react-native';

import { colors, type } from './theme';

type Variant = keyof typeof type;
type Tone = 'default' | 'muted' | 'accent' | 'success' | 'warning' | 'danger' | 'onAccent';

const toneColors: Record<Tone, string> = {
  default: colors.text,
  muted: colors.textMuted,
  accent: colors.accent,
  success: colors.success,
  warning: colors.warning,
  danger: colors.danger,
  onAccent: colors.textOnAccent,
};

interface Props {
  children: ReactNode;
  variant?: Variant;
  tone?: Tone;
  /** Tabular digits so columns of money line up. */
  numeric?: boolean;
  numberOfLines?: number;
  style?: StyleProp<TextStyle>;
  accessibilityRole?: 'header' | 'text';
}

export function Text({
  children,
  variant = 'body',
  tone = 'default',
  numeric = false,
  numberOfLines,
  style,
  accessibilityRole,
}: Props) {
  return (
    <NativeText
      accessibilityRole={accessibilityRole ?? (variant === 'title' || variant === 'heading' ? 'header' : 'text')}
      numberOfLines={numberOfLines}
      style={[
        type[variant],
        { color: toneColors[tone] },
        numeric && { fontVariant: ['tabular-nums'] },
        style,
      ]}
    >
      {children}
    </NativeText>
  );
}
