import { Redirect, router } from 'expo-router';
import { useState } from 'react';

import { completeFirstRunSetup, needsFirstRunSetup } from '@/services/auth';
import { useApp } from '@/state/AppProvider';
import { useAction } from '@/state/hooks';
import { AuthFrame } from '@/ui/AuthFrame';
import { Button } from '@/ui/Button';
import { Notice } from '@/ui/layout';
import { TextField } from '@/ui/TextField';

export default function FirstRunSetup() {
  const { ctx, setUser } = useApp();
  const action = useAction();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [pin, setPin] = useState('');
  const [mismatch, setMismatch] = useState<string | null>(null);

  if (!needsFirstRunSetup(ctx)) return <Redirect href="/login" />;

  async function submit() {
    if (password !== confirm) {
      setMismatch('The two passwords do not match.');
      return;
    }
    setMismatch(null);
    const result = await action.run((c) => completeFirstRunSetup(c, { username, password, pin }));
    if (result.ok) {
      setUser(result.value);
      router.replace('/today');
    }
  }

  return (
    <AuthFrame
      title="Set up this tablet"
      intro="Create the owner account. The owner PIN approves machine overrides, so keep it to yourself."
    >
      <TextField label="Owner username" value={username} onChangeText={setUsername} autoCapitalize="none" />
      <TextField
        label="Password"
        value={password}
        onChangeText={setPassword}
        secureTextEntry
        autoCapitalize="none"
        hint="At least 6 characters."
      />
      <TextField
        label="Repeat password"
        value={confirm}
        onChangeText={setConfirm}
        secureTextEntry
        autoCapitalize="none"
        error={mismatch}
      />
      <TextField
        label="Owner PIN"
        value={pin}
        onChangeText={(text) => setPin(text.replace(/\D/g, ''))}
        keyboardType="number-pad"
        secureTextEntry
        maxLength={6}
        hint="4 to 6 digits. Different from your password."
      />
      {action.error && <Notice tone="danger">{action.error}</Notice>}
      <Button label="Create owner account" onPress={submit} busy={action.busy} block />
    </AuthFrame>
  );
}
