import { describe, it, expect, afterEach } from 'vitest';
import { supportsUsbPrinting, supportsSerialPrinting, supportsAnyPrinting } from '../webPrinter.js';

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
