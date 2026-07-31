import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import {
  supportsUsbPrinting,
  supportsSerialPrinting,
  supportsAnyPrinting,
  pairSerialPrinter,
  writeToPairedPrinter,
} from '../webPrinter.js';

function deleteNavProp(name: 'usb' | 'serial') {
  delete (navigator as unknown as Record<string, unknown>)[name];
}

afterEach(() => {
  deleteNavProp('usb');
  deleteNavProp('serial');
});

describe('printer feature-detection (mirrors supportsBackgroundSync in POSScreen.tsx)', () => {
  it('reports unsupported when navigator.usb and navigator.serial are both absent, as on Safari/iOS', () => {
    expect(supportsUsbPrinting()).toBe(false);
    expect(supportsSerialPrinting()).toBe(false);
    expect(supportsAnyPrinting()).toBe(false);
  });

  it('reports USB support when navigator.usb is present', () => {
    (navigator as unknown as Record<string, unknown>)['usb'] = {};
    expect(supportsUsbPrinting()).toBe(true);
    expect(supportsAnyPrinting()).toBe(true);
  });

  it('reports serial support when navigator.serial is present', () => {
    (navigator as unknown as Record<string, unknown>)['serial'] = {};
    expect(supportsSerialPrinting()).toBe(true);
    expect(supportsAnyPrinting()).toBe(true);
  });
});

// Regression test for the InvalidStateError bug: writeSerial used to call port.open()
// unconditionally on every write, with no guard for an already-open port (unlike writeUsb's
// existing `device.opened` check). Per the Web Serial spec, `port.writable` is null until
// open() succeeds and null again after close() — the same shape as USBDevice.opened.
function makeFakeSerialPort() {
  let writable: {
    getWriter: () => { write: () => Promise<void>; releaseLock: () => void };
  } | null = null;
  const write = vi.fn(async () => {});
  const open = vi.fn(async () => {
    writable = { getWriter: () => ({ write, releaseLock: vi.fn() }) };
  });
  return {
    open,
    write,
    get writable() {
      return writable;
    },
    close: vi.fn(async () => {
      writable = null;
    }),
  };
}

describe('Web Serial printer write (regression: InvalidStateError on repeated writes)', () => {
  it('opens the port on the first write, and does not reopen an already-open port on a second write', async () => {
    const fakePort = makeFakeSerialPort();
    (navigator as unknown as Record<string, unknown>)['serial'] = {
      requestPort: vi.fn(async () => fakePort),
      getPorts: vi.fn(async () => []),
      addEventListener: vi.fn(),
    };

    await pairSerialPrinter();
    await writeToPairedPrinter(new Uint8Array([1, 2, 3]));
    expect(fakePort.open).toHaveBeenCalledTimes(1);
    expect(fakePort.write).toHaveBeenCalledTimes(1);

    // The bug: calling open() on an already-open SerialPort throws InvalidStateError. This
    // second write must reuse the already-open port instead of calling open() again.
    await writeToPairedPrinter(new Uint8Array([4, 5, 6]));
    expect(fakePort.open).toHaveBeenCalledTimes(1);
    expect(fakePort.write).toHaveBeenCalledTimes(2);
  });
});

// Regression test: an unplugged printer previously left hasPairedPrinter() reporting
// "paired" forever (no listener ever cleared the stale reference) until the next write
// attempt failed. navigator.usb/serial dispatch a real '(USB|Serial)ConnectionEvent' on
// disconnect per spec — subclassing Event (rather than Object.assign-ing extra properties
// onto a plain Event instance) is the reliable way to carry that payload through jsdom's
// dispatch.
class FakeUsbConnectionEvent extends Event {
  constructor(public device: unknown) {
    super('disconnect');
  }
}
class FakeSerialConnectionEvent extends Event {
  constructor(public port: unknown) {
    super('disconnect');
  }
}

// pairedUsbDevice/pairedSerialPort are shared module state with no reset hook (by design —
// production has no need to ever reset a real pairing mid-session), and hasPairedPrinter()
// checks both transports at once, so these tests re-import a fresh module instance per test
// rather than risk cross-contamination from whichever transport an earlier test in this file
// left paired.
describe('USB/Serial disconnect clears the stale paired-device reference', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it('clears the paired USB device when its own disconnect event fires', async () => {
    class FakeUsb extends EventTarget {
      requestDevice = vi.fn(async () => fakeDevice);
    }
    const fakeDevice = { opened: false } as unknown as USBDevice;
    const fakeUsb = new FakeUsb();
    (navigator as unknown as Record<string, unknown>)['usb'] = fakeUsb;

    const wp = await import('../webPrinter.js');
    await wp.pairUsbPrinter();
    expect(wp.hasPairedPrinter()).toBe(true);

    fakeUsb.dispatchEvent(new FakeUsbConnectionEvent(fakeDevice));

    expect(wp.hasPairedPrinter()).toBe(false);
  });

  it('ignores a disconnect event for a different device than the one currently paired', async () => {
    class FakeUsb extends EventTarget {
      requestDevice = vi.fn(async () => fakeDevice);
    }
    const fakeDevice = { opened: false } as unknown as USBDevice;
    const otherDevice = { opened: false } as unknown as USBDevice;
    const fakeUsb = new FakeUsb();
    (navigator as unknown as Record<string, unknown>)['usb'] = fakeUsb;

    const wp = await import('../webPrinter.js');
    await wp.pairUsbPrinter();
    fakeUsb.dispatchEvent(new FakeUsbConnectionEvent(otherDevice));

    expect(wp.hasPairedPrinter()).toBe(true);
  });

  it('clears the paired Serial port when its own disconnect event fires', async () => {
    const fakePort = makeFakeSerialPort();
    class FakeSerial extends EventTarget {
      requestPort = vi.fn(async () => fakePort);
      getPorts = vi.fn(async () => []);
    }
    const fakeSerial = new FakeSerial();
    (navigator as unknown as Record<string, unknown>)['serial'] = fakeSerial;

    const wp = await import('../webPrinter.js');
    await wp.pairSerialPrinter();
    expect(wp.hasPairedPrinter()).toBe(true);

    fakeSerial.dispatchEvent(new FakeSerialConnectionEvent(fakePort));

    expect(wp.hasPairedPrinter()).toBe(false);
  });
});
