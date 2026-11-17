import { Redirect } from 'expo-router';

import { needsFirstRunSetup } from '@/services/auth';
import { useApp } from '@/state/AppProvider';

export default function Entry() {
  const { ctx, user } = useApp();
  if (needsFirstRunSetup(ctx)) return <Redirect href="/setup" />;
  if (!user) return <Redirect href="/login" />;
  return <Redirect href="/today" />;
}
