import * as qz from 'qz-tray';

// Name of the Windows print queue for the DC2M 2" thermal printer (installed via the Seagull driver).
const RECEIPT_PRINTER_NAME = '4BARCODE 2B-2023B';

// DC2M's actual usable print width is 48mm, not the 58mm often assumed for "2 inch" thermal
// printers. Must stay in sync with RECEIPT_WIDTH in PosInvoicePdfService.java on the backend,
// which renders the receipt PDF at the same width.
const RECEIPT_WIDTH_MM = 48;

let connectPromise: Promise<void> | null = null;

const ensureConnected = () => {
  if (qz.websocket.isActive()) return Promise.resolve();
  if (!connectPromise) {
    connectPromise = qz.websocket.connect().catch((error) => {
      connectPromise = null;
      throw error;
    });
  }
  return connectPromise;
};

const blobToBase64 = (blob: Blob) => new Promise<string>((resolve, reject) => {
  const reader = new FileReader();
  reader.onloadend = () => resolve(String(reader.result).split(',')[1] || '');
  reader.onerror = () => reject(reader.error);
  reader.readAsDataURL(blob);
});

export const printReceiptPdf = async (pdfBlob: Blob, printerName = RECEIPT_PRINTER_NAME) => {
  await ensureConnected();
  const base64Pdf = await blobToBase64(pdfBlob);
  const config = qz.configs.create(printerName, {
    units: 'mm',
    // Fixed width, auto height, marked custom so the driver doesn't snap this to one of its
    // saved (gap-sensed) label stocks - that snapping is what was truncating/gapping prints.
    // The Windows print queue's Stock must also be set to Continuous at this width; see
    // printer setup notes.
    // `custom` is supported at runtime (qz-tray.js) but missing from the @types/qz-tray Size type.
    size: { width: RECEIPT_WIDTH_MM, height: null, custom: true } as qz.Size,
    margins: 0,
    scaleContent: false,
  });
  const data = [{ type: 'pixel' as const, format: 'pdf' as const, flavor: 'base64' as const, data: base64Pdf }];
  await qz.print(config, data);
};
