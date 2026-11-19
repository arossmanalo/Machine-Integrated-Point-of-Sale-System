import { createHmac } from 'crypto';

import { MockMachineController } from '../MockMachineController';
import { channelTerminal, DEVICE_NAME, MAX_CHANNEL, normalizeAddress, signCommand } from '../protocol';
import { WifiMachineController, type HttpReply, type HttpRequest } from '../WifiMachineController';

const KEY = 'correct horse battery';
const BASE = 'http://192.168.1.50';
const timings = { requestTimeoutMs: 100, healthIntervalMs: 1000 };
const COMMANDS = { '/unlock': 'unlock', '/lock': 'lock' } as const;

/** Behaves like lock_controller.ino: single-use challenges, HMAC-checked unlock and lock. */
class FakeEsp32 {
  key = KEY;
  down = false;
  device = DEVICE_NAME;
  /** The command is carried out but its reply never arrives. */
  loseNextCommandReply = false;
  /** The next this-many status or challenge replies arrive empty, as a dropped connection reads. */
  garbleNext = 0;
  /** Every channel unlocked, in order. */
  unlocks: number[] = [];
  unlocked = new Set<number>();
  log: string[] = [];
  private challenge: string | null = null;
  private counter = 0;

  /** A restart: every door locks. */
  restart(): void {
    this.unlocked.clear();
  }

  readonly http = async (request: HttpRequest): Promise<HttpReply> => {
    const path = request.url.replace(BASE, '');
    this.log.push(`${request.method} ${path}`);
    if (this.down) throw new Error('Network request failed');
    const command = request.method === 'POST' && (path === '/unlock' || path === '/lock') ? COMMANDS[path] : null;
    if (this.garbleNext > 0 && command === null) {
      this.garbleNext -= 1;
      return { status: 200, json: null };
    }
    if (path === '/status') {
      const unlocked = [...this.unlocked].sort((a, b) => a - b);
      return { status: 200, json: { device: this.device, channels: 6, unlocked } };
    }
    if (path === '/challenge') {
      this.counter += 1;
      this.challenge = this.counter.toString(16).padStart(32, '0');
      return { status: 200, json: { challenge: this.challenge } };
    }
    if (command !== null) {
      const form = new URLSearchParams(request.body);
      const channel = Number(form.get('channel'));
      const challenge = form.get('challenge');
      const issued = this.challenge;
      this.challenge = null;
      if (challenge === null || challenge !== issued) {
        return { status: 409, json: { ok: false, error: 'stale-challenge' } };
      }
      if (form.get('signature') !== signCommand(this.key, command, channel, challenge)) {
        return { status: 401, json: { ok: false, error: 'bad-signature' } };
      }
      if (channel < 1 || channel > 6) return { status: 400, json: { ok: false, error: 'bad-channel' } };
      if (command === 'unlock') {
        this.unlocks.push(channel);
        this.unlocked.add(channel);
      } else {
        this.unlocked.delete(channel);
      }
      if (this.loseNextCommandReply) {
        this.loseNextCommandReply = false;
        throw new Error('timed out');
      }
      return { status: 200, json: { ok: true, channel } };
    }
    return { status: 404, json: null };
  };
}

/** Every controller a test makes, so a failing test still stops its health-check timer. */
const made: WifiMachineController[] = [];

function track(controller: WifiMachineController): WifiMachineController {
  made.push(controller);
  return controller;
}

function setup(config: { baseUrl: string | null; key: string } = { baseUrl: BASE, key: KEY }) {
  const esp = new FakeEsp32();
  const controller = track(new WifiMachineController(config, esp.http, timings));
  return { esp, controller };
}

/** Lets a status check the controller started in the background finish. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

afterEach(async () => {
  await Promise.all(made.splice(0).map((controller) => controller.disconnect()));
  jest.useRealTimers();
});

describe('protocol', () => {
  it('turns what the owner types into a base URL', () => {
    expect(normalizeAddress(' 192.168.1.50 ')).toBe('http://192.168.1.50');
    expect(normalizeAddress('http://192.168.1.50:8080/')).toBe('http://192.168.1.50:8080');
    expect(normalizeAddress('Laundry-Locks.local')).toBe('http://laundry-locks.local');
    expect(normalizeAddress('')).toBeNull();
    expect(normalizeAddress('https://192.168.1.50')).toBeNull();
    expect(normalizeAddress('192.168.1.50/unlock')).toBeNull();
    expect(normalizeAddress('192.168.1.50:99999')).toBeNull();
  });

  it('names the board terminal for each of the 14 channels', () => {
    expect(MAX_CHANNEL).toBe(14);
    expect(channelTerminal(1)).toBe('D25');
    expect(channelTerminal(7)).toBe('D18');
    expect(channelTerminal(14)).toBe('TX2');
    expect(channelTerminal(0)).toBeNull();
    expect(channelTerminal(15)).toBeNull();
  });

  it('signs exactly like a standard HMAC-SHA256, as the ESP32 computes it', () => {
    const challenge = '0123456789abcdef0123456789abcdef';
    const hmacOf = (message: string) => createHmac('sha256', KEY).update(message).digest('hex');
    expect(signCommand(KEY, 'unlock', 3, challenge)).toBe(hmacOf(`U3:${challenge}`));
    expect(signCommand(KEY, 'lock', 3, challenge)).toBe(hmacOf(`L3:${challenge}`));
    expect(signCommand(KEY, 'unlock', 3, challenge)).not.toBe(signCommand(KEY, 'lock', 3, challenge));
  });
});

describe('WifiMachineController', () => {
  it('asks for setup and sends nothing until an address and key are set', async () => {
    for (const config of [{ baseUrl: null, key: KEY }, { baseUrl: BASE, key: 'short' }]) {
      const { esp, controller } = setup(config);
      await expect(controller.connect()).resolves.toBe('not-configured');
      expect(controller.state()).toMatchObject({ status: 'disconnected', detail: expect.stringContaining('Set the lock') });
      await expect(controller.unlock(1)).resolves.toBe('not-connected');
      expect(esp.log).toEqual([]);
    }
  });

  it('connects, then sends each command with a fresh signed challenge', async () => {
    const { esp, controller } = setup();
    await expect(controller.connect()).resolves.toBe('connected');
    expect(controller.state().status).toBe('ready');
    await expect(controller.unlock(3)).resolves.toBe('acked');
    await expect(controller.lock(3)).resolves.toBe('acked');
    expect(esp.unlocks).toEqual([3]);
    expect(esp.log).toEqual(['GET /status', 'GET /challenge', 'POST /unlock', 'GET /challenge', 'POST /lock']);
  });

  it('runs one command at a time so challenges never cross', async () => {
    const { esp, controller } = setup();
    await controller.connect();
    await expect(Promise.all([controller.unlock(1), controller.unlock(2)])).resolves.toEqual(['acked', 'acked']);
    expect(esp.unlocks).toEqual([1, 2]);
  });

  it('reports a wrong key and opens nothing', async () => {
    const { esp, controller } = setup();
    esp.key = 'a different passphrase';
    await controller.connect();
    await expect(controller.unlock(1)).resolves.toBe('rejected');
    expect(esp.unlocks).toEqual([]);
    expect(controller.state()).toMatchObject({ status: 'error', detail: expect.stringContaining('does not match') });
  });

  it('rejects channels the board does not have, and bad channels without asking', async () => {
    const { esp, controller } = setup();
    await controller.connect();
    await expect(controller.unlock(9)).resolves.toBe('rejected');
    await expect(controller.unlock(0)).resolves.toBe('rejected');
    expect(esp.log.filter((line) => line === 'POST /unlock')).toHaveLength(1);
  });

  it('says timeout and does not retry when a command reply is lost', async () => {
    const { esp, controller } = setup();
    await controller.connect();
    esp.loseNextCommandReply = true;
    await expect(controller.unlock(2)).resolves.toBe('timeout');
    expect(esp.log.filter((line) => line === 'POST /unlock')).toHaveLength(1);
    expect(esp.unlocks).toEqual([2]);
  });

  it('shrugs off one unreadable reply to a status or challenge request', async () => {
    const { esp, controller } = setup();
    esp.garbleNext = 1;
    await expect(controller.connect()).resolves.toBe('connected');
    esp.garbleNext = 1;
    await expect(controller.unlock(2)).resolves.toBe('acked');
    expect(esp.log).toEqual(['GET /status', 'GET /status', 'GET /challenge', 'GET /challenge', 'POST /unlock']);
  });

  it('calls repeated unreadable replies unreachable, not the wrong device', async () => {
    const { esp, controller } = setup();
    esp.garbleNext = 2;
    await expect(controller.connect()).resolves.toBe('unreachable');
    expect(controller.state()).toMatchObject({ status: 'disconnected', detail: expect.stringContaining('Cannot reach') });
  });

  it('never repeats a command, even when its reply is unreadable', async () => {
    const esp = new FakeEsp32();
    const unreadableCommands = async (request: HttpRequest): Promise<HttpReply> => {
      const reply = await esp.http(request);
      return request.method === 'POST' ? { status: 200, json: null } : reply;
    };
    const controller = track(new WifiMachineController({ baseUrl: BASE, key: KEY }, unreadableCommands, timings));
    await controller.connect();
    await expect(controller.unlock(3)).resolves.toBe('timeout');
    expect(esp.unlocks).toEqual([3]);
    expect(esp.log.filter((line) => line === 'POST /unlock')).toHaveLength(1);
  });

  it('tells an unreachable controller from the wrong device', async () => {
    const offline = setup();
    offline.esp.down = true;
    await expect(offline.controller.connect()).resolves.toBe('unreachable');
    expect(offline.controller.state()).toMatchObject({ status: 'disconnected', detail: expect.stringContaining('Cannot reach') });
    await expect(offline.controller.unlock(1)).resolves.toBe('not-connected');

    const stranger = setup();
    stranger.esp.device = 'some-printer';
    await expect(stranger.controller.connect()).resolves.toBe('failed');
    expect(stranger.controller.state()).toMatchObject({ status: 'error', detail: expect.stringContaining('not the lock controller') });
  });

  it('notices when the controller drops off and when it comes back', async () => {
    jest.useFakeTimers();
    const { esp, controller } = setup();
    await controller.connect();
    esp.down = true;
    await jest.advanceTimersByTimeAsync(timings.healthIntervalMs);
    expect(controller.state().status).toBe('disconnected');
    esp.down = false;
    await jest.advanceTimersByTimeAsync(timings.healthIntervalMs);
    expect(controller.state().status).toBe('ready');
    await controller.disconnect();
    const checks = esp.log.length;
    await jest.advanceTimersByTimeAsync(timings.healthIntervalMs * 3);
    expect(esp.log).toHaveLength(checks);
  });

  it('reconnects on its own when an unlock finds it offline', async () => {
    const { esp, controller } = setup();
    esp.down = true;
    await controller.connect();
    esp.down = false;
    await expect(controller.unlock(4)).resolves.toBe('acked');
    expect(controller.state().status).toBe('ready');
  });
});

describe('unlocked doors', () => {
  it('keeps a door unlocked until it is locked', async () => {
    jest.useFakeTimers();
    const { controller } = setup();
    await controller.connect();
    await controller.unlock(3);
    await controller.unlock(1);
    expect(controller.state().unlockedChannels).toEqual([1, 3]);
    await jest.advanceTimersByTimeAsync(10 * 60 * 1000);
    expect(controller.state().unlockedChannels).toEqual([1, 3]);
    await expect(controller.lock(3)).resolves.toBe('acked');
    expect(controller.state().unlockedChannels).toEqual([1]);
  });

  it('takes the real state from the board, including after a board restart', async () => {
    jest.useFakeTimers();
    const { esp, controller } = setup();
    esp.unlocked.add(2);
    await controller.connect();
    expect(controller.state().unlockedChannels).toEqual([2]);
    esp.restart();
    await jest.advanceTimersByTimeAsync(timings.healthIntervalMs);
    expect(controller.state().unlockedChannels).toEqual([]);
  });

  it('finds out from the board when a lost reply did unlock the door', async () => {
    const { esp, controller } = setup();
    await controller.connect();
    esp.loseNextCommandReply = true;
    await expect(controller.unlock(2)).resolves.toBe('timeout');
    await settle();
    expect(controller.state().unlockedChannels).toEqual([2]);
  });

  it('keeps a door unlocked when the lock is refused', async () => {
    const { esp, controller } = setup();
    await controller.connect();
    await controller.unlock(1);
    esp.key = 'a different passphrase';
    await expect(controller.lock(1)).resolves.toBe('rejected');
    expect(controller.state().unlockedChannels).toEqual([1]);
    expect(esp.unlocked.has(1)).toBe(true);
  });
});

describe('MockMachineController', () => {
  it('acks when connected and can be told to fail', async () => {
    const mock = new MockMachineController(0);
    await expect(mock.unlock(1)).resolves.toBe('not-connected');
    await mock.connect();
    await expect(mock.unlock(2)).resolves.toBe('acked');
    mock.failNextUnlock('timeout');
    await expect(mock.unlock(2)).resolves.toBe('timeout');
    expect(mock.pulses).toEqual([2]);
  });

  it('keeps simulated doors unlocked until locked', async () => {
    const mock = new MockMachineController(0);
    await mock.connect();
    await mock.unlock(4);
    await mock.unlock(1);
    expect(mock.state().unlockedChannels).toEqual([1, 4]);
    await expect(mock.lock(4)).resolves.toBe('acked');
    expect(mock.state().unlockedChannels).toEqual([1]);
  });
});
