// Minimal ambient types for the WebUSB and Web Serial APIs — no @types package
// exists for either. This narrows to only the members webPrinter.ts actually
// calls, not the full W3C spec surface.

interface USBDevice {
  readonly vendorId: number;
  readonly productId: number;
  readonly opened: boolean;
  readonly configuration: { configurationValue: number } | null;
  open(): Promise<void>;
  close(): Promise<void>;
  selectConfiguration(configurationValue: number): Promise<void>;
  claimInterface(interfaceNumber: number): Promise<void>;
  transferOut(
    endpointNumber: number,
    data: Uint8Array
  ): Promise<{ status: 'ok' | 'stall' | 'babble'; bytesWritten: number }>;
}

interface USBDeviceRequestOptions {
  filters: { vendorId?: number; productId?: number; classCode?: number }[];
}

interface USB extends EventTarget {
  requestDevice(options: USBDeviceRequestOptions): Promise<USBDevice>;
  getDevices(): Promise<USBDevice[]>;
}

interface SerialPort {
  readonly writable: WritableStream<Uint8Array> | null;
  open(options: { baudRate: number }): Promise<void>;
  close(): Promise<void>;
}

interface SerialPortRequestOptions {
  filters?: { usbVendorId?: number; usbProductId?: number }[];
}

interface Serial extends EventTarget {
  requestPort(options?: SerialPortRequestOptions): Promise<SerialPort>;
  getPorts(): Promise<SerialPort[]>;
}

interface Navigator {
  readonly usb?: USB;
  readonly serial?: Serial;
}
