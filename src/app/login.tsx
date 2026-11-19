import { Redirect, router } from 'expo-router';
import { useState } from 'react';

import { logIn, needsFirstRunSetup } from '@/services/auth';
import { useApp } from '@/state/AppProvider';
import { useAction } from '@/state/hooks';
import { AuthFrame } from '@/ui/AuthFrame';
import { Button } from '@/ui/Button';
import { Notice } from '@/ui/layout';
import { TextField } from '@/ui/TextField';

export default function Login() {
  const { ctx, user, setUser } = useApp();
  const action = useAction();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');

  if (needsFirstRunSetup(ctx)) return <Redirect href="/setup" />;
  if (user) return <Redirect href="/today" />;

  async function submit() {
    const result = await action.run((c) => logIn(c, username, password));
    if (result.ok) {
      setUser(result.value);
      setPassword('');
      router.replace('/today');
    }
  }

  return (
    <AuthFrame title="Sign in" intro="Use your own account so orders and machine starts are recorded under your name.">
      <TextField
        label="Username"
        value={username}
        onChangeText={setUsername}
        autoCapitalize="none"
        returnKeyType="next"
      />
      <TextField
        label="Password"
        value={password}
        onChangeText={setPassword}
        secureTextEntry
        autoCapitalize="none"
        returnKeyType="done"
        onSubmitEditing={submit}
      />
      {action.error && <Notice tone="danger">{action.error}</Notice>}
      <Button label="Sign in" onPress={submit} busy={action.busy} block />
    </AuthFrame>
  );
}
