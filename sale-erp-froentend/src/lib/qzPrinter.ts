import * as qz from 'qz-tray';

// Name of the Windows print queue for the DC2M 2" thermal printer (installed via the Seagull driver).
const RECEIPT_PRINTER_NAME = '4BARCODE 2B-2023B';

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
  const config = qz.configs.create(printerName);
  const data = [{ type: 'pixel' as const, format: 'pdf' as const, flavor: 'base64' as const, data: base64Pdf }];
  await qz.print(config, data);
};
