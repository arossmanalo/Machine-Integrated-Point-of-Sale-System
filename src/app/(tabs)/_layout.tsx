import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { Redirect, router } from 'expo-router';
import { Tabs } from 'expo-router/tabs';
import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { isManager } from '@/domain/permissions';
import { logOut } from '@/services/auth';
import { useApp } from '@/state/AppProvider';
import { Button, type IconName } from '@/ui/Button';
import { Dialog } from '@/ui/controls';
import { LockStatusChip } from '@/ui/LockStatus';
import { Text } from '@/ui/Text';
import { colors, fonts, MIN_TOUCH, space } from '@/ui/theme';

function tabIcon(name: IconName) {
  return function TabIcon({ focused, size }: { focused: boolean; size: number }) {
    return (
      <MaterialCommunityIcons name={name} color={focused ? colors.accent : colors.textMuted} size={size} />
    );
  };
}

function HeaderActions() {
  const { ctx, user, setUser } = useApp();
  const [confirming, setConfirming] = useState(false);
  return (
    <View style={styles.actions}>
      <LockStatusChip />
      <Button label="New order" icon="plus" onPress={() => router.push('/orders/new')} />
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Sign out"
        onPress={() => setConfirming(true)}
        style={styles.iconButton}
      >
        <MaterialCommunityIcons name="logout" size={22} color={colors.textMuted} />
      </Pressable>
      <Dialog
        visible={confirming}
        title="Sign out?"
        onClose={() => setConfirming(false)}
        actions={
          <>
            <Button label="Stay signed in" kind="secondary" onPress={() => setConfirming(false)} />
            <Button
              label="Sign out"
              kind="danger"
              onPress={() => {
                logOut(ctx);
                setConfirming(false);
                setUser(null);
                router.replace('/login');
              }}
            />
          </>
        }
      >
        <Text>{user ? `${user.username} will be signed out of this tablet.` : ''}</Text>
      </Dialog>
    </View>
  );
}

export default function TabsLayout() {
  const { user } = useApp();
  if (!user) return <Redirect href="/login" />;
  return (
    <Tabs
      screenOptions={{
        headerStyle: { backgroundColor: colors.surface },
        headerShadowVisible: false,
        headerTitleStyle: { fontFamily: fonts.semibold, fontSize: 20, color: colors.text },
        headerTitleAlign: 'left',
        headerRight: () => <HeaderActions />,
        tabBarActiveTintColor: colors.accent,
        tabBarInactiveTintColor: colors.textMuted,
        tabBarLabelStyle: { fontFamily: fonts.medium, fontSize: 13 },
        tabBarStyle: { backgroundColor: colors.surface, borderTopColor: colors.border, minHeight: 60 },
        sceneStyle: { backgroundColor: colors.background },
      }}
    >
      <Tabs.Screen name="today" options={{ title: 'Today', tabBarIcon: tabIcon('view-dashboard-outline') }} />
      <Tabs.Screen name="orders" options={{ title: 'Orders', tabBarIcon: tabIcon('receipt-text-outline') }} />
      <Tabs.Screen name="machines" options={{ title: 'Machines', tabBarIcon: tabIcon('washing-machine') }} />
      <Tabs.Screen name="customers" options={{ title: 'Customers', tabBarIcon: tabIcon('account-group-outline') }} />
      <Tabs.Screen name="stock" options={{ title: 'Stock', tabBarIcon: tabIcon('package-variant-closed') }} />
      <Tabs.Screen
        name="manage"
        options={{
          // Employees get the tab too, for app updates; the shop management links stay hidden.
          title: isManager(user.role) ? 'Manage' : 'Settings',
          tabBarIcon: tabIcon('cog-outline'),
        }}
      />
    </Tabs>
  );
}

const styles = StyleSheet.create({
  actions: { flexDirection: 'row', alignItems: 'center', gap: space.sm, paddingRight: space.md },
  iconButton: { width: MIN_TOUCH, height: MIN_TOUCH, alignItems: 'center', justifyContent: 'center' },
});
