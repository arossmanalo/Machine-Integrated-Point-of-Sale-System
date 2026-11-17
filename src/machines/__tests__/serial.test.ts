import { MockMachineController } from '../MockMachineController';
import { encodePulse, LineBuffer, parseLine } from '../protocol';
import {
  SerialMachineController,
  type OpenResult,
  type SerialTransport,
} from '../SerialMachineController';

describe('protocol', () => {
  it('encodes pulses and rejects bad channels', () => {
    expect(encodePulse(3)).toBe('P3\n');
    expect(() => encodePulse(0)).toThrow();
    expect(() => encodePulse(1.5)).toThrow();
  });

  it('parses Arduino replies', () => {
    expect(parseLine('READY\r')).toEqual({ kind: 'ready' });
    expect(parseLine('OK P3')).toEqual({ kind: 'ok', channel: 3 });
    expect(parseLine('ERR P9')).toEqual({ kind: 'error', command: 'P9' });
    expect(parseLine('garbage')).toEqual({ kind: 'other', text: 'garbage' });
  });

  it('reassembles lines split across chunks', () => {
    const buffer = new LineBuffer();
    expect(buffer.push('OK ')).toEqual([]);
    expect(buffer.push('P3\r\nREA')).toEqual(['OK P3']);
    expect(buffer.push('DY\n\n')).toEqual(['READY']);
  });
});

class FakeTransport implements SerialTransport {
  written: string[] = [];
  openResult: OpenResult = 'opened';
  failWrites = false;
  private dataListener: (chunk: string) => void = () => {};
  private deviceListener: (event: 'attached' | 'detached') => void = () => {};

  async open(): Promise<OpenResult> {
    return this.openResult;
  }
  async close(): Promise<void> {}
  async write(text: string): Promise<void> {
    if (this.failWrites) throw new Error('USB write failed');
    this.written.push(text);
  }
  onData(listener: (chunk: string) => void) {
    this.dataListener = listener;
    return () => {};
  }
  onDevice(listener: (event: 'attached' | 'detached') => void) {
    this.deviceListener = listener;
    return () => {};
  }
  receive(text: string) {
    this.dataListener(text);
  }
  device(event: 'attached' | 'detached') {
    this.deviceListener(event);
  }
}

const timings = { bootWaitMs: 2000, replyTimeoutMs: 1500 };

async function flush() {
  for (let i = 0; i < 5; i += 1) await Promise.resolve();
}

async function connected(transport: FakeTransport) {
  const controller = new SerialMachineController(transport, timings);
  const connecting = controller.connect();
  await flush();
  transport.receive('READY\r\n');
  await expect(connecting).resolves.toBe('connected');
  return controller;
}

describe('SerialMachineController', () => {
  it('is ready as soon as READY arrives', async () => {
    const transport = new FakeTransport();
    const controller = await connected(transport);
    expect(controller.state().status).toBe('ready');
  });

  it('falls back to the boot wait when READY never arrives', async () => {
    jest.useFakeTimers();
    try {
      const controller = new SerialMachineController(new FakeTransport(), timings);
      const connecting = controller.connect();
      await flush();
      jest.advanceTimersByTime(2000);
      await expect(connecting).resolves.toBe('connected');
    } finally {
      jest.useRealTimers();
    }
  });

  it('reports a missing device without becoming ready', async () => {
    const transport = new FakeTransport();
    transport.openResult = 'no-device';
    const controller = new SerialMachineController(transport, timings);
    await expect(controller.connect()).resolves.toBe('no-device');
    expect(controller.state().status).toBe('disconnected');
    await expect(controller.unlock(1)).resolves.toBe('not-connected');
  });

  it('acks only on the matching OK line', async () => {
    const transport = new FakeTransport();
    const controller = await connected(transport);
    const unlocking = controller.unlock(3);
    await flush();
    expect(transport.written).toEqual(['P3\n']);
    transport.receive('OK P2\n');
    transport.receive('OK P3\n');
    await expect(unlocking).resolves.toBe('acked');
  });

  it('maps ERR to rejected and silence to timeout', async () => {
    jest.useFakeTimers();
    try {
      const transport = new FakeTransport();
      const controller = new SerialMachineController(transport, timings);
      const connecting = controller.connect();
      await flush();
      transport.receive('READY\n');
      await connecting;

      const rejected = controller.unlock(4);
      await flush();
      transport.receive('ERR P4\n');
      await expect(rejected).resolves.toBe('rejected');

      const silent = controller.unlock(5);
      await flush();
      jest.advanceTimersByTime(1500);
      await expect(silent).resolves.toBe('timeout');
    } finally {
      jest.useRealTimers();
    }
  });

  it('sends one command at a time', async () => {
    const transport = new FakeTransport();
    const controller = await connected(transport);
    const first = controller.unlock(1);
    const second = controller.unlock(2);
    await flush();
    expect(transport.written).toEqual(['P1\n']);
    transport.receive('OK P1\n');
    await first;
    await flush();
    expect(transport.written).toEqual(['P1\n', 'P2\n']);
    transport.receive('OK P2\n');
    await expect(second).resolves.toBe('acked');
  });

  it('goes offline when unplugged and fails the waiting command', async () => {
    const transport = new FakeTransport();
    const controller = await connected(transport);
    const unlocking = controller.unlock(1);
    await flush();
    transport.device('detached');
    await expect(unlocking).resolves.toBe('not-connected');
    expect(controller.state().status).toBe('disconnected');
  });

  it('reconnects by itself when plugged back in', async () => {
    const transport = new FakeTransport();
    const controller = await connected(transport);
    transport.device('detached');
    transport.device('attached');
    await flush();
    expect(controller.state().status).toBe('connecting');
    transport.receive('READY\n');
    await flush();
    expect(controller.state().status).toBe('ready');
  });

  it('treats a failed write as a disconnect', async () => {
    const transport = new FakeTransport();
    const controller = await connected(transport);
    transport.failWrites = true;
    await expect(controller.unlock(1)).resolves.toBe('not-connected');
    expect(controller.state().status).toBe('disconnected');
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
