import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Text } from '@/ui/Text';
import { colors, elevation, radius, space } from '@/ui/theme';

type ToastTone = 'success' | 'danger' | 'info';
interface ToastMessage {
  id: number;
  text: string;
  tone: ToastTone;
}

const ToastContext = createContext<(text: string, tone?: ToastTone) => void>(() => {});

const SHOW_MS = 3500;
const icons = { success: 'check-circle', danger: 'alert-circle', info: 'information' } as const;
const iconColors = { success: '#7EE2AE', danger: '#FFB4AB', info: '#AFC8FF' } as const;

/** Short confirmations ("Payment recorded") that do not need a tap to dismiss. */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [message, setMessage] = useState<ToastMessage | null>(null);
  const counter = useRef(0);
  const insets = useSafeAreaInsets();

  const show = useCallback((text: string, tone: ToastTone = 'success') => {
    counter.current += 1;
    setMessage({ id: counter.current, text, tone });
  }, []);

  useEffect(() => {
    if (!message) return undefined;
    const timer = setTimeout(() => setMessage(null), SHOW_MS);
    return () => clearTimeout(timer);
  }, [message]);

  return (
    <ToastContext.Provider value={show}>
      {children}
      {message && (
        <View pointerEvents="none" style={[styles.wrap, { bottom: insets.bottom + 88 }]}>
          <View style={styles.toast} accessibilityLiveRegion="polite" accessibilityRole="alert">
            <MaterialCommunityIcons name={icons[message.tone]} size={20} color={iconColors[message.tone]} />
            <Text tone="onAccent" style={styles.text}>
              {message.text}
            </Text>
          </View>
        </View>
      )}
    </ToastContext.Provider>
  );
}

export function useToast() {
  return useContext(ToastContext);
}

const styles = StyleSheet.create({
  wrap: { position: 'absolute', left: space.lg, right: space.lg, alignItems: 'center' },
  toast: {
    maxWidth: 560,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    backgroundColor: colors.text,
    borderRadius: radius.sm,
    paddingHorizontal: space.lg,
    paddingVertical: space.md,
    ...elevation,
  },
  text: { flexShrink: 1 },
});
