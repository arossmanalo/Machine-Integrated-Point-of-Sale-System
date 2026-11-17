import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import type { ReactNode } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';

import type { IconName } from './Button';
import { Text } from './Text';
import { colors, CONTENT_MAX_WIDTH, MIN_TOUCH, radius, space } from './theme';

/** Scrollable page with a readable maximum width on wide tablets. */
export function Screen({
  children,
  onRefresh,
  refreshing = false,
}: {
  children: ReactNode;
  onRefresh?: () => void;
  refreshing?: boolean;
}) {
  return (
    <KeyboardAvoidingView
      style={styles.flex}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView
        style={styles.screen}
        contentContainerStyle={styles.screenContent}
        keyboardShouldPersistTaps="handled"
        refreshControl={
          onRefresh ? <RefreshControl refreshing={refreshing} onRefresh={onRefresh} /> : undefined
        }
      >
        <View style={styles.column}>{children}</View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

/** Heading with optional action on the right, then content. Spacing, not boxes, groups things. */
export function Section({
  title,
  action,
  children,
  description,
}: {
  title: string;
  action?: ReactNode;
  description?: string;
  children: ReactNode;
}) {
  return (
    <View style={styles.section}>
      <View style={styles.sectionHeader}>
        <View style={styles.flex}>
          <Text variant="heading">{title}</Text>
          {description !== undefined && <Text tone="muted">{description}</Text>}
        </View>
        {action}
      </View>
      {children}
    </View>
  );
}

/** A white sheet for lists and forms. Flat: a border, no shadow. */
export function Panel({ children, style }: { children: ReactNode; style?: StyleProp<ViewStyle> }) {
  return <View style={[styles.panel, style]}>{children}</View>;
}

export function Row({
  children,
  style,
  wrap = false,
}: {
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
  wrap?: boolean;
}) {
  return <View style={[styles.row, wrap && styles.wrap, style]}>{children}</View>;
}

/** A tappable line in a list. */
export function ListRow({
  title,
  subtitle,
  meta,
  right,
  onPress,
  last = false,
  accessibilityLabel,
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  meta?: ReactNode;
  right?: ReactNode;
  onPress?: () => void;
  last?: boolean;
  accessibilityLabel?: string;
}) {
  const body = (
    <>
      <View style={styles.flex}>
        {typeof title === 'string' ? <Text variant="bodyStrong">{title}</Text> : title}
        {typeof subtitle === 'string' ? <Text tone="muted">{subtitle}</Text> : subtitle}
        {meta}
      </View>
      {right}
      {onPress && <MaterialCommunityIcons name="chevron-right" size={22} color={colors.textMuted} />}
    </>
  );
  const rowStyle = [styles.listRow, !last && styles.divider];
  if (!onPress) return <View style={rowStyle}>{body}</View>;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      onPress={onPress}
      style={({ pressed }) => [rowStyle, pressed && { backgroundColor: colors.surfaceSunken }]}
    >
      {body}
    </Pressable>
  );
}

export function EmptyState({ icon, title, body, action }: { icon: IconName; title: string; body: string; action?: ReactNode }) {
  return (
    <View style={styles.empty}>
      <MaterialCommunityIcons name={icon} size={32} color={colors.textMuted} />
      <Text variant="bodyStrong">{title}</Text>
      <Text tone="muted" style={styles.emptyBody}>
        {body}
      </Text>
      {action}
    </View>
  );
}

type NoticeTone = 'info' | 'success' | 'warning' | 'danger';

const noticeColors: Record<NoticeTone, { bg: string; fg: string; icon: IconName }> = {
  info: { bg: colors.accentSoft, fg: colors.accent, icon: 'information-outline' },
  success: { bg: colors.successSoft, fg: colors.success, icon: 'check-circle-outline' },
  warning: { bg: colors.warningSoft, fg: colors.warning, icon: 'alert-outline' },
  danger: { bg: colors.dangerSoft, fg: colors.danger, icon: 'alert-circle-outline' },
};

/** An inline message. Colour is never the only signal: there is always an icon and text. */
export function Notice({ tone, children, action }: { tone: NoticeTone; children: ReactNode; action?: ReactNode }) {
  const look = noticeColors[tone];
  return (
    <View style={[styles.notice, { backgroundColor: look.bg }]} accessibilityRole="alert">
      <MaterialCommunityIcons name={look.icon} size={20} color={look.fg} />
      <View style={styles.flex}>{typeof children === 'string' ? <Text>{children}</Text> : children}</View>
      {action}
    </View>
  );
}

/** A label above a big number. */
export function Stat({
  label,
  value,
  tone = 'default',
  note,
}: {
  label: string;
  value: string;
  tone?: 'default' | 'success' | 'danger';
  note?: string;
}) {
  return (
    <View style={styles.stat}>
      <Text variant="label" tone="muted">
        {label}
      </Text>
      <Text variant="figure" tone={tone} numeric>
        {value}
      </Text>
      {note !== undefined && (
        <Text variant="caption" tone="muted">
          {note}
        </Text>
      )}
    </View>
  );
}

export function Divider() {
  return <View style={styles.dividerLine} />;
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  screen: { flex: 1, backgroundColor: colors.background },
  screenContent: { padding: space.lg, paddingBottom: space.xxl * 2 },
  column: { width: '100%', maxWidth: CONTENT_MAX_WIDTH, alignSelf: 'center', gap: space.xl },
  section: { gap: space.md },
  sectionHeader: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  panel: {
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    overflow: 'hidden',
  },
  row: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  wrap: { flexWrap: 'wrap' },
  listRow: {
    minHeight: MIN_TOUCH + space.md,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    paddingHorizontal: space.lg,
    paddingVertical: space.md,
  },
  divider: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
  dividerLine: { height: StyleSheet.hairlineWidth, backgroundColor: colors.border },
  empty: { alignItems: 'flex-start', gap: space.sm, padding: space.xl },
  emptyBody: { maxWidth: 480 },
  notice: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    padding: space.md,
    borderRadius: radius.sm,
  },
  stat: { gap: space.xs, minWidth: 150, flexGrow: 1 },
});
