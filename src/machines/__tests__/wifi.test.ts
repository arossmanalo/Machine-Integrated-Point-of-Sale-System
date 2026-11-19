import { createHmac } from 'crypto';

import { MockMachineController } from '../MockMachineController';
import { channelTerminal, DEVICE_NAME, MAX_CHANNEL, normalizeAddress, signPulse } from '../protocol';
import { WifiMachineController, type HttpReply, type HttpRequest } from '../WifiMachineController';

const KEY = 'correct horse battery';
const BASE = 'http://192.168.1.50';
const timings = { requestTimeoutMs: 100, healthIntervalMs: 1000 };

/** Behaves like lock_controller.ino: single-use challenges and HMAC-checked pulses. */
class FakeEsp32 {
  key = KEY;
  down = false;
  device = DEVICE_NAME;
  /** The pulse happens but the reply never arrives. */
  loseNextPulseReply = false;
  pulses: number[] = [];
  log: string[] = [];
  private challenge: string | null = null;
  private counter = 0;

  readonly http = async (request: HttpRequest): Promise<HttpReply> => {
    const path = request.url.replace(BASE, '');
    this.log.push(`${request.method} ${path}`);
    if (this.down) throw new Error('Network request failed');
    if (path === '/status') return { status: 200, json: { device: this.device, channels: 6 } };
    if (path === '/challenge') {
      this.counter += 1;
      this.challenge = this.counter.toString(16).padStart(32, '0');
      return { status: 200, json: { challenge: this.challenge } };
    }
    if (path === '/pulse' && request.method === 'POST') {
      const form = new URLSearchParams(request.body);
      const channel = Number(form.get('channel'));
      const challenge = form.get('challenge');
      const issued = this.challenge;
      this.challenge = null;
      if (challenge === null || challenge !== issued) {
        return { status: 409, json: { ok: false, error: 'stale-challenge' } };
      }
      if (form.get('signature') !== signPulse(this.key, channel, challenge)) {
        return { status: 401, json: { ok: false, error: 'bad-signature' } };
      }
      if (channel < 1 || channel > 6) return { status: 400, json: { ok: false, error: 'bad-channel' } };
      this.pulses.push(channel);
      if (this.loseNextPulseReply) {
        this.loseNextPulseReply = false;
        throw new Error('timed out');
      }
      return { status: 200, json: { ok: true, channel } };
    }
    return { status: 404, json: null };
  };
}

function setup(config: { baseUrl: string | null; key: string } = { baseUrl: BASE, key: KEY }) {
  const esp = new FakeEsp32();
  const controller = new WifiMachineController(config, esp.http, timings);
  return { esp, controller };
}

afterEach(() => {
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
    const expected = createHmac('sha256', KEY).update(`P3:${challenge}`).digest('hex');
    expect(signPulse(KEY, 3, challenge)).toBe(expected);
    expect(signPulse(KEY, 4, challenge)).not.toBe(expected);
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

  it('connects, then pulses with a fresh signed challenge each time', async () => {
    const { esp, controller } = setup();
    await expect(controller.connect()).resolves.toBe('connected');
    expect(controller.state().status).toBe('ready');
    await expect(controller.unlock(3)).resolves.toBe('acked');
    await expect(controller.unlock(5)).resolves.toBe('acked');
    expect(esp.pulses).toEqual([3, 5]);
    expect(esp.log).toEqual(['GET /status', 'GET /challenge', 'POST /pulse', 'GET /challenge', 'POST /pulse']);
    await controller.disconnect();
  });

  it('runs one unlock at a time so challenges never cross', async () => {
    const { esp, controller } = setup();
    await controller.connect();
    await expect(Promise.all([controller.unlock(1), controller.unlock(2)])).resolves.toEqual(['acked', 'acked']);
    expect(esp.pulses).toEqual([1, 2]);
    await controller.disconnect();
  });

  it('reports a wrong key and opens nothing', async () => {
    const { esp, controller } = setup();
    esp.key = 'a different passphrase';
    await controller.connect();
    await expect(controller.unlock(1)).resolves.toBe('rejected');
    expect(esp.pulses).toEqual([]);
    expect(controller.state()).toMatchObject({ status: 'error', detail: expect.stringContaining('does not match') });
    await controller.disconnect();
  });

  it('rejects channels the board does not have, and bad channels without asking', async () => {
    const { esp, controller } = setup();
    await controller.connect();
    await expect(controller.unlock(9)).resolves.toBe('rejected');
    await expect(controller.unlock(0)).resolves.toBe('rejected');
    expect(esp.log.filter((line) => line === 'POST /pulse')).toHaveLength(1);
    await controller.disconnect();
  });

  it('says timeout and does not retry when the pulse reply is lost', async () => {
    const { esp, controller } = setup();
    await controller.connect();
    esp.loseNextPulseReply = true;
    await expect(controller.unlock(2)).resolves.toBe('timeout');
    expect(esp.log.filter((line) => line === 'POST /pulse')).toHaveLength(1);
    expect(esp.pulses).toEqual([2]);
    await controller.disconnect();
  });

  it('tells an unreachable controller from the wrong device', async () => {
    const offline = setup();
    offline.esp.down = true;
    await expect(offline.controller.connect()).resolves.toBe('unreachable');
    expect(offline.controller.state()).toMatchObject({ status: 'disconnected', detail: expect.stringContaining('Cannot reach') });
    await expect(offline.controller.unlock(1)).resolves.toBe('not-connected');
    await offline.controller.disconnect();

    const stranger = setup();
    stranger.esp.device = 'some-printer';
    await expect(stranger.controller.connect()).resolves.toBe('failed');
    expect(stranger.controller.state()).toMatchObject({ status: 'error', detail: expect.stringContaining('not the lock controller') });
    await stranger.controller.disconnect();
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
    await controller.disconnect();
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
});
