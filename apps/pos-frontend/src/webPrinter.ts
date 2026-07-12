// Pairs and writes raw ESC/POS bytes to a WebUSB or Web Serial thermal printer.
// Follows the same feature-detect / explicit-fallback shape as
// supportsBackgroundSync() in POSScreen.tsx — neither WebUSB nor Web Serial
// exist in Safari/iOS, so callers must always feature-detect before offering
// this path and keep window.print() as the permanent fallback.

const PRINTER_USB_INTERFACE = 0;
const PRINTER_USB_ENDPOINT_OUT = 1;
const SERIAL_BAUD_RATE = 9600;

const LS_KEY_TRANSPORT = 'pos_printer_transport';

export type PrinterTransport = 'usb' | 'serial';

export function supportsUsbPrinting(): boolean {
  return typeof navigator !== 'undefined' && 'usb' in navigator && !!navigator.usb;
}

export function supportsSerialPrinting(): boolean {
  return typeof navigator !== 'undefined' && 'serial' in navigator && !!navigator.serial;
}

export function supportsAnyPrinting(): boolean {
  return supportsUsbPrinting() || supportsSerialPrinting();
}

function getPreferredTransport(): PrinterTransport | null {
  return (localStorage.getItem(LS_KEY_TRANSPORT) as PrinterTransport | null) ?? null;
}

function setPreferredTransport(t: PrinterTransport): void {
  localStorage.setItem(LS_KEY_TRANSPORT, t);
}

// Module-level — a pairing grant is scoped to the browser tab/origin for this
// session's lifetime, matching pos_paper_size's existing localStorage-preference
// convention for the transport choice itself.
let pairedUsbDevice: USBDevice | null = null;
let pairedSerialPort: SerialPort | null = null;

export async function pairUsbPrinter(): Promise<USBDevice> {
  if (!navigator.usb) throw new Error('WebUSB not supported in this browser');
  // No vendor/product filter — thermal printers span many vendor IDs, and the
  // browser's own device picker is the real filtering UI here.
  const device = await navigator.usb.requestDevice({ filters: [] });
  pairedUsbDevice = device;
  setPreferredTransport('usb');
  return device;
}

export async function pairSerialPrinter(): Promise<SerialPort> {
  if (!navigator.serial) throw new Error('Web Serial not supported in this browser');
  const port = await navigator.serial.requestPort();
  pairedSerialPort = port;
  setPreferredTransport('serial');
  return port;
}

// Reconnects to a device the user already granted permission to in a prior
// session — getDevices()/getPorts() list only already-permitted devices and
// never prompt, so this is safe to call unconditionally at startup.
export async function reconnectPairedPrinter(): Promise<boolean> {
  const preferred = getPreferredTransport();
  if (preferred === 'usb' && navigator.usb) {
    const devices = await navigator.usb.getDevices();
    if (devices[0]) {
      pairedUsbDevice = devices[0];
      return true;
    }
  } else if (preferred === 'serial' && navigator.serial) {
    const ports = await navigator.serial.getPorts();
    if (ports[0]) {
      pairedSerialPort = ports[0];
      return true;
    }
  }
  return false;
}

export function hasPairedPrinter(): boolean {
  return pairedUsbDevice !== null || pairedSerialPort !== null;
}

async function writeUsb(device: USBDevice, data: Uint8Array): Promise<void> {
  if (!device.opened) await device.open();
  if (device.configuration === null) await device.selectConfiguration(1);
  await device.claimInterface(PRINTER_USB_INTERFACE);
  const result = await device.transferOut(PRINTER_USB_ENDPOINT_OUT, data);
  if (result.status !== 'ok') throw new Error(`USB printer write failed: ${result.status}`);
}

async function writeSerial(port: SerialPort, data: Uint8Array): Promise<void> {
  await port.open({ baudRate: SERIAL_BAUD_RATE });
  const writer = port.writable?.getWriter();
  if (!writer) throw new Error('Serial port has no writable stream');
  try {
    await writer.write(data);
  } finally {
    writer.releaseLock();
  }
}

// Pairs on demand if nothing is paired yet, then writes. Callers must treat
// this as fire-and-forget with their own toast/error handling — it must never
// block the checkout flow the way a failed/slow printer write must not delay
// the next sale from starting.
export async function writeToPairedPrinter(data: Uint8Array): Promise<void> {
  if (!hasPairedPrinter()) {
    if (supportsUsbPrinting()) await pairUsbPrinter();
    else if (supportsSerialPrinting()) await pairSerialPrinter();
    else throw new Error('No WebUSB/Web Serial support in this browser');
  }
  if (pairedUsbDevice) return writeUsb(pairedUsbDevice, data);
  if (pairedSerialPort) return writeSerial(pairedSerialPort, data);
}
