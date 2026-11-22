import { useState } from 'react';
import { StyleSheet, TextInput, View, type KeyboardTypeOptions, type StyleProp, type ViewStyle } from 'react-native';

import { Text } from './Text';
import { colors, MIN_TOUCH, radius, space, type } from './theme';

interface Props {
  label: string;
  /** For inputs in a table whose column heading already names them; the label stays for screen readers. */
  hideLabel?: boolean;
  value: string;
  onChangeText: (text: string) => void;
  placeholder?: string;
  hint?: string;
  error?: string | null;
  keyboardType?: KeyboardTypeOptions;
  secureTextEntry?: boolean;
  autoCapitalize?: 'none' | 'sentences' | 'words' | 'characters';
  multiline?: boolean;
  editable?: boolean;
  /** Text shown before the input, such as "₱". */
  prefix?: string;
  maxLength?: number;
  autoFocus?: boolean;
  onSubmitEditing?: () => void;
  returnKeyType?: 'done' | 'next' | 'search';
  style?: StyleProp<ViewStyle>;
}

export function TextField({
  label,
  hideLabel = false,
  value,
  onChangeText,
  placeholder,
  hint,
  error,
  keyboardType,
  secureTextEntry,
  autoCapitalize = 'sentences',
  multiline = false,
  editable = true,
  prefix,
  maxLength,
  autoFocus,
  onSubmitEditing,
  returnKeyType,
  style,
}: Props) {
  const [focused, setFocused] = useState(false);
  const borderColor = error ? colors.danger : focused ? colors.accent : colors.border;
  return (
    <View style={[styles.wrap, style]}>
      {!hideLabel && <Text variant="label">{label}</Text>}
      <View
        style={[
          styles.box,
          { borderColor, borderWidth: focused || error ? 2 : 1 },
          !editable && styles.readOnly,
          multiline && styles.multiline,
        ]}
      >
        {prefix !== undefined && (
          <Text tone="muted" style={styles.prefix}>
            {prefix}
          </Text>
        )}
        <TextInput
          accessibilityLabel={label}
          value={value}
          onChangeText={onChangeText}
          placeholder={placeholder}
          placeholderTextColor={colors.textMuted}
          keyboardType={keyboardType}
          secureTextEntry={secureTextEntry}
          autoCapitalize={autoCapitalize}
          autoCorrect={false}
          multiline={multiline}
          editable={editable}
          maxLength={maxLength}
          autoFocus={autoFocus}
          onSubmitEditing={onSubmitEditing}
          returnKeyType={returnKeyType}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          style={[styles.input, multiline && styles.inputMultiline]}
        />
      </View>
      {error ? (
        <Text variant="caption" tone="danger">
          {error}
        </Text>
      ) : hint ? (
        <Text variant="caption" tone="muted">
          {hint}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: space.xs },
  box: {
    minHeight: MIN_TOUCH,
    borderRadius: radius.sm,
    backgroundColor: colors.surface,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: space.md,
  },
  readOnly: { backgroundColor: colors.surfaceSunken },
  multiline: { alignItems: 'flex-start', paddingVertical: space.sm },
  prefix: { marginRight: space.xs },
  input: { ...type.body, flex: 1, color: colors.text, paddingVertical: space.sm },
  inputMultiline: { minHeight: 72, textAlignVertical: 'top' },
});
