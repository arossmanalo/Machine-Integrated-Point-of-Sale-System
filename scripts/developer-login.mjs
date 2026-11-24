// Sets the developer sign-in that is built into the app. Run on the developer's PC:
//   npm run developer-login
// It asks for a username and password and writes only the username and a salted hash to .env
// (git-ignored). The next `eas update` or APK build carries them; the password is never stored.
import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { stdin, stdout } from 'node:process';
import { createInterface } from 'node:readline';

import { pbkdf2Async } from '@noble/hashes/pbkdf2.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex, utf8ToBytes } from '@noble/hashes/utils.js';

// The same format as hashSecret in src/domain/secrets.ts. More rounds than staff passwords,
// because the hash ships inside the app; the developer signs in rarely, so the wait is fine.
const ITERATIONS = 20000;
const MIN_PASSWORD_LENGTH = 12;
const ENV_FILE = '.env';

const rl = createInterface({ input: stdin, output: stdout, terminal: stdin.isTTY === true });
let muted = false;
const writeToOutput = rl._writeToOutput.bind(rl);
// While a password is typed, show nothing but the question itself.
rl._writeToOutput = (text) => {
  if (!muted) writeToOutput(text);
};

const lines = rl[Symbol.asyncIterator]();

/** Reads one line; with `hidden`, typed characters are not echoed. */
async function ask(question, hidden = false) {
  stdout.write(question);
  muted = hidden;
  const { value } = await lines.next();
  muted = false;
  if (hidden) stdout.write('\n');
  return value ?? '';
}

function stop(message) {
  console.error(message);
  rl.close();
  process.exit(1);
}

function setEnvValue(text, key, value) {
  const line = `${key}=${value}`;
  const pattern = new RegExp(`^${key}=.*$`, 'm');
  if (pattern.test(text)) return text.replace(pattern, line);
  return `${text}${text === '' || text.endsWith('\n') ? '' : '\n'}${line}\n`;
}

const username = (await ask('Developer username: ')).trim();
if (username.length < 2) stop('Use at least 2 characters for the username. Nothing was changed.');
const password = await ask(`Developer password (at least ${MIN_PASSWORD_LENGTH} characters): `, true);
if (password.length < MIN_PASSWORD_LENGTH) {
  stop(`Use at least ${MIN_PASSWORD_LENGTH} characters for the password. Nothing was changed.`);
}
if ((await ask('Type the password again: ', true)) !== password) stop('The passwords do not match. Nothing was changed.');
rl.close();

const salt = randomBytes(16);
const key = await pbkdf2Async(sha256, utf8ToBytes(password), salt, { c: ITERATIONS, dkLen: 32 });
// ':' instead of '$', because Expo expands '$' in .env values; the app turns them back.
const hash = ['pbkdf2-sha256', ITERATIONS, bytesToHex(salt), bytesToHex(key)].join(':');

let env = existsSync(ENV_FILE) ? readFileSync(ENV_FILE, 'utf8') : '';
env = setEnvValue(env, 'EXPO_PUBLIC_DEVELOPER_USERNAME', username);
env = setEnvValue(env, 'EXPO_PUBLIC_DEVELOPER_PASSWORD_HASH', hash);
writeFileSync(ENV_FILE, env);
console.log(`Saved the developer sign-in for "${username}" to ${ENV_FILE}. Publish an update to put it on the tablets.`);
