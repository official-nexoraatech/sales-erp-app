import type { TourDefinition } from '../../schema.js';
import { PERMISSIONS } from '../../../../constants/permissions.js';

// Grounded against BarcodeService.ts / BarcodeLabelsPage.tsx. Confirms label generation is real
// (real item-linked values, real check digits for EAN-13) and printing is a genuine browser
// print flow, not a mockup — worth stating plainly since several other "generate a document"
// features audited this session turned out to be simulated.
const tour: TourDefinition = {
  id: 'production-barcode-labels-overview',
  version: 1,
  type: 'quick',
  title: 'Barcode Labels — quick overview',
  description: 'Generate and print real barcode labels tied to actual item and variant data.',
  module: 'production',
  estimatedMinutes: 1,
  requiredPermissions: [PERMISSIONS.BARCODE_GENERATE],
  steps: [
    {
      id: 'intro',
      route: 'production/barcode-labels',
      title: 'Barcode Labels',
      body: 'Every generated barcode genuinely encodes the real item (and variant, if applicable) — CODE128, EAN-13 with a real check digit, or QR.',
      placement: 'center',
      mode: 'informational',
      requiredPermission: PERMISSIONS.BARCODE_GENERATE,
    },
    {
      id: 'select-and-generate',
      route: 'production/barcode-labels',
      target: '[data-tour-id="production-barcode-labels-generate-button"]',
      title: 'Search for an item and Generate',
      body: 'Pick a format and label size (physical mm dimensions, or an A4 sheet of multiple labels), then Generate & Preview.',
      placement: 'top',
      mode: 'informational',
      requiredPermission: PERMISSIONS.BARCODE_GENERATE,
    },
    {
      id: 'print',
      route: 'production/barcode-labels',
      target: '[data-tour-id="production-barcode-labels-print-button"]',
      title: 'Print Labels',
      body: "Opens your browser's real print dialog with the labels laid out — a genuine physical-label path, not just an on-screen preview. If pop-ups are blocked, allow them for this site.",
      placement: 'top',
      mode: 'informational',
      requiredPermission: PERMISSIONS.BARCODE_PRINT,
    },
  ],
};

export default tour;
