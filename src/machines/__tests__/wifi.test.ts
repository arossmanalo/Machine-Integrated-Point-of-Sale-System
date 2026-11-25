import { createHmac } from 'crypto';

import type { PulseSettings } from '../MachineController';
import { MockMachineController } from '../MockMachineController';
import {
  channelTerminal,
  DEVICE_NAME,
  MAX_CHANNEL,
  normalizeAddress,
  pulsesProblem,
  signStart,
} from '../protocol';
import { WifiMachineController, type HttpReply, type HttpRequest } from '../WifiMachineController';

const KEY = 'correct horse battery';
const BASE = 'http://192.168.1.50';
const timings = { requestTimeoutMs: 100, healthIntervalMs: 1000 };
const TWO_COINS: PulseSettings = { count: 2, onMs: 500, offMs: 500 };

/** Behaves like lock_controller.ino: single-use challenges and HMAC-checked pulse starts. */
class FakeEsp32 {
  key = KEY;
  down = false;
  device = DEVICE_NAME;
  /** The start is carried out but its reply never arrives. */
  loseNextReply = false;
  /** The start request is lost on the way: nothing is carried out and no reply arrives. */
  dropNextStart = false;
  /** The ESP32 becomes unreachable right after carrying out the next start. */
  vanishAfterNextStart = false;
  /** The next this-many status or challenge replies arrive empty, as a dropped connection reads. */
  garbleNext = 0;
  /** Channels still sending pulses. */
  busy = new Set<number>();
  starts: { channel: number; pulses: PulseSettings }[] = [];
  log: string[] = [];
  private challenge: string | null = null;
  private lastAccepted = '';
  private counter = 0;

  readonly http = async (request: HttpRequest): Promise<HttpReply> => {
    const path = request.url.replace(BASE, '');
    this.log.push(`${request.method} ${path}`);
    if (this.down) throw new Error('Network request failed');
    const isStart = request.method === 'POST' && path === '/start';
    if (this.garbleNext > 0 && !isStart) {
      this.garbleNext -= 1;
      return { status: 200, json: null };
    }
    if (path === '/status') {
      const busy = [...this.busy].sort((a, b) => a - b);
      return { status: 200, json: { device: this.device, channels: 6, busy, lastAccepted: this.lastAccepted } };
    }
    if (path === '/challenge') {
      this.counter += 1;
      this.challenge = this.counter.toString(16).padStart(32, '0');
      return { status: 200, json: { challenge: this.challenge } };
    }
    if (isStart) {
      if (this.dropNextStart) {
        this.dropNextStart = false;
        throw new Error('timed out');
      }
      const form = new URLSearchParams(request.body);
      const channel = Number(form.get('channel'));
      const pulses = { count: Number(form.get('pulses')), onMs: Number(form.get('onMs')), offMs: Number(form.get('offMs')) };
      const challenge = form.get('challenge');
      const issued = this.challenge;
      this.challenge = null;
      if (challenge === null || challenge !== issued) {
        return { status: 409, json: { ok: false, error: 'stale-challenge' } };
      }
      if (form.get('signature') !== signStart(this.key, channel, pulses, challenge)) {
        return { status: 401, json: { ok: false, error: 'bad-signature' } };
      }
      if (channel < 1 || channel > 6) return { status: 400, json: { ok: false, error: 'bad-channel' } };
      if (this.busy.has(channel)) return { status: 409, json: { ok: false, error: 'busy' } };
      this.starts.push({ channel, pulses });
      this.busy.add(channel);
      this.lastAccepted = challenge;
      if (this.vanishAfterNextStart) {
        this.vanishAfterNextStart = false;
        this.down = true;
        throw new Error('timed out');
      }
      if (this.loseNextReply) {
        this.loseNextReply = false;
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

const posts = (esp: FakeEsp32) => esp.log.filter((line) => line === 'POST /start').length;

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

  it('names the board terminal for each of the 23 channels', () => {
    expect(MAX_CHANNEL).toBe(23);
    expect(channelTerminal(1)).toBe('IO14');
    expect(channelTerminal(16)).toBe('IO21');
    expect(channelTerminal(23)).toBe('IO1');
    expect(channelTerminal(0)).toBeNull();
    expect(channelTerminal(24)).toBeNull();
  });

  it('signs the channel and every pulse setting, exactly as the ESP32 computes it', () => {
    const challenge = '0123456789abcdef0123456789abcdef';
    const expected = createHmac('sha256', KEY).update(`S3:2:500:500:${challenge}`).digest('hex');
    expect(signStart(KEY, 3, TWO_COINS, challenge)).toBe(expected);
    expect(signStart(KEY, 3, { ...TWO_COINS, count: 3 }, challenge)).not.toBe(expected);
    expect(signStart(KEY, 3, { ...TWO_COINS, offMs: 400 }, challenge)).not.toBe(expected);
  });

  it('keeps pulse settings inside what the board accepts', () => {
    expect(pulsesProblem(TWO_COINS)).toBeNull();
    expect(pulsesProblem({ count: 50, onMs: 20, offMs: 5000 })).toBeNull();
    expect(pulsesProblem({ ...TWO_COINS, count: 0 })).toContain('from 1 to 50');
    expect(pulsesProblem({ ...TWO_COINS, count: 51 })).toContain('from 1 to 50');
    expect(pulsesProblem({ ...TWO_COINS, onMs: 19 })).toContain('Pulse length');
    expect(pulsesProblem({ ...TWO_COINS, offMs: 5001 })).toContain('Gap between');
    expect(pulsesProblem({ ...TWO_COINS, count: 1.5 })).not.toBeNull();
  });
});

describe('WifiMachineController', () => {
  it('asks for setup and sends nothing until an address and key are set', async () => {
    for (const config of [{ baseUrl: null, key: KEY }, { baseUrl: BASE, key: 'short' }]) {
      const { esp, controller } = setup(config);
      await expect(controller.connect()).resolves.toBe('not-configured');
      expect(controller.state()).toMatchObject({ status: 'disconnected', detail: expect.stringContaining('not set up yet') });
      await expect(controller.start(1, TWO_COINS)).resolves.toBe('not-connected');
      expect(esp.log).toEqual([]);
    }
  });

  it('sends each start with its pulses over a fresh signed challenge', async () => {
    const { esp, controller } = setup();
    await expect(controller.connect()).resolves.toBe('connected');
    await expect(controller.start(3, TWO_COINS)).resolves.toBe('acked');
    await expect(controller.start(5, { count: 1, onMs: 100, offMs: 50 })).resolves.toBe('acked');
    expect(esp.starts).toEqual([
      { channel: 3, pulses: TWO_COINS },
      { channel: 5, pulses: { count: 1, onMs: 100, offMs: 50 } },
    ]);
    expect(esp.log).toEqual(['GET /status', 'GET /challenge', 'POST /start', 'GET /challenge', 'POST /start']);
  });

  it('runs one start at a time so challenges never cross', async () => {
    const { esp, controller } = setup();
    await controller.connect();
    await expect(Promise.all([controller.start(1, TWO_COINS), controller.start(2, TWO_COINS)])).resolves.toEqual([
      'acked',
      'acked',
    ]);
    expect(esp.starts.map((s) => s.channel)).toEqual([1, 2]);
  });

  it('reports a machine still receiving pulses as busy', async () => {
    const { esp, controller } = setup();
    await controller.connect();
    await controller.start(2, TWO_COINS);
    await expect(controller.start(2, TWO_COINS)).resolves.toBe('busy');
    esp.busy.clear();
    await expect(controller.start(2, TWO_COINS)).resolves.toBe('acked');
  });

  it('reports a wrong key and starts nothing', async () => {
    const { esp, controller } = setup();
    esp.key = 'a different passphrase';
    await controller.connect();
    await expect(controller.start(1, TWO_COINS)).resolves.toBe('rejected');
    expect(esp.starts).toEqual([]);
    expect(controller.state()).toMatchObject({ status: 'error', detail: expect.stringContaining('settings do not match') });
  });

  it('refuses bad channels and pulse settings without asking, and channels the board lacks', async () => {
    const { esp, controller } = setup();
    await controller.connect();
    await expect(controller.start(0, TWO_COINS)).resolves.toBe('rejected');
    await expect(controller.start(1, { ...TWO_COINS, count: 0 })).resolves.toBe('rejected');
    expect(posts(esp)).toBe(0);
    await expect(controller.start(9, TWO_COINS)).resolves.toBe('rejected');
    expect(posts(esp)).toBe(1);
  });

  it('confirms with the board when a start went through but its reply was lost', async () => {
    const { esp, controller } = setup();
    await controller.connect();
    esp.loseNextReply = true;
    await expect(controller.start(2, TWO_COINS)).resolves.toBe('acked');
    expect(posts(esp)).toBe(1);
    expect(esp.starts).toHaveLength(1);
  });

  it('says failed when the board shows the start never arrived, and sends it only once', async () => {
    const { esp, controller } = setup();
    await controller.connect();
    await controller.start(4, TWO_COINS);
    esp.busy.clear();
    esp.dropNextStart = true;
    await expect(controller.start(2, TWO_COINS)).resolves.toBe('failed');
    expect(posts(esp)).toBe(2);
    expect(esp.starts.map((s) => s.channel)).toEqual([4]);
  });

  it('says timeout only when the board cannot be asked at all', async () => {
    const { esp, controller } = setup();
    await controller.connect();
    esp.vanishAfterNextStart = true;
    await expect(controller.start(2, TWO_COINS)).resolves.toBe('timeout');
    expect(posts(esp)).toBe(1);
    expect(controller.state().status).toBe('disconnected');
  });

  it('shrugs off one unreadable reply to a status or challenge request', async () => {
    const { esp, controller } = setup();
    esp.garbleNext = 1;
    await expect(controller.connect()).resolves.toBe('connected');
    esp.garbleNext = 1;
    await expect(controller.start(2, TWO_COINS)).resolves.toBe('acked');
    expect(esp.log).toEqual(['GET /status', 'GET /status', 'GET /challenge', 'GET /challenge', 'POST /start']);
  });

  it('calls repeated unreadable replies unreachable, not the wrong device', async () => {
    const { esp, controller } = setup();
    esp.garbleNext = 2;
    await expect(controller.connect()).resolves.toBe('unreachable');
    expect(controller.state()).toMatchObject({ status: 'disconnected', detail: expect.stringContaining('Cannot reach') });
  });

  it('tells an unreachable controller from the wrong device', async () => {
    const offline = setup();
    offline.esp.down = true;
    await expect(offline.controller.connect()).resolves.toBe('unreachable');
    await expect(offline.controller.start(1, TWO_COINS)).resolves.toBe('not-connected');

    const stranger = setup();
    stranger.esp.device = 'some-printer';
    await expect(stranger.controller.connect()).resolves.toBe('failed');
    expect(stranger.controller.state()).toMatchObject({ status: 'error', detail: expect.stringContaining('wrong device') });
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

  it('reconnects on its own when a start finds it offline', async () => {
    const { esp, controller } = setup();
    esp.down = true;
    await controller.connect();
    esp.down = false;
    await expect(controller.start(4, TWO_COINS)).resolves.toBe('acked');
    expect(controller.state().status).toBe('ready');
  });
});

describe('MockMachineController', () => {
  it('records starts when connected and can be told to fail', async () => {
    const mock = new MockMachineController(0);
    await expect(mock.start(1, TWO_COINS)).resolves.toBe('not-connected');
    await mock.connect();
    await expect(mock.start(2, TWO_COINS)).resolves.toBe('acked');
    mock.failNextStart('timeout');
    await expect(mock.start(2, TWO_COINS)).resolves.toBe('timeout');
    await expect(mock.start(2, { ...TWO_COINS, count: 99 })).resolves.toBe('rejected');
    expect(mock.starts).toEqual([{ channel: 2, pulses: TWO_COINS }]);
  });
});
