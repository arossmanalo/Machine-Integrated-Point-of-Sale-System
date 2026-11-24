/** The built-in developer sign-in: the username and a hash of its password (`hashSecret` format). */
export interface DeveloperLogin {
  username: string;
  passwordHash: string;
}

/** The developer's row in `users`; outside the U0001… staff numbering. */
export const DEVELOPER_ID = 'D0001';

/**
 * Read from `.env` when the app is bundled (`npm run developer-login` writes it). `.env` is
 * git-ignored, so the repo holds neither the username nor the hash. Without both, there is no
 * developer sign-in.
 */
function readBuiltInDeveloper(): DeveloperLogin | null {
  const username = process.env.EXPO_PUBLIC_DEVELOPER_USERNAME?.trim() ?? '';
  // Written with ':' for '$', because Expo expands '$' in .env values.
  const written = process.env.EXPO_PUBLIC_DEVELOPER_PASSWORD_HASH?.trim() ?? '';
  const passwordHash = written.replaceAll(':', '$');
  return username !== '' && passwordHash !== '' ? { username, passwordHash } : null;
}

export const BUILT_IN_DEVELOPER = readBuiltInDeveloper();
