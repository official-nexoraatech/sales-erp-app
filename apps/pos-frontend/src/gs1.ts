import { gs1CheckDigitValid } from './hooks/useBarcodeScanDetector.js';

// Multi-vertical platform audit 2026-08-16, Phase 3: grocery relies on weighing-scale-printed
// barcodes for loose/bulk items (produce, deli, bakery) that encode the weight directly in the
// barcode rather than a fixed per-unit price — barcode scanning was format-agnostic (a real
// strength, kept as-is) but never decoded this embedded-weight convention, so a scale label
// would only ever resolve as an unknown/not-found barcode.
//
// Format (the common Indian retail in-store convention, 13 digits total):
//   digit 1:      '2'            — flag reserved for internal/variable-measure use
//   digits 2-6:   item code      — 5-digit PLU looked up the same way a typed code is
//   digits 7-12:  weight (grams) — 6 digits, e.g. "001250" = 1.250 kg
//   digit 13:     GS1 check digit over digits 1-12
export interface ParsedVariableWeightBarcode {
  itemCode: string;
  weightKg: number;
}

export function parseGs1VariableWeightBarcode(barcode: string): ParsedVariableWeightBarcode | null {
  if (!/^2\d{12}$/.test(barcode)) return null;
  if (!gs1CheckDigitValid(barcode)) return null;

  const itemCode = barcode.slice(1, 6);
  const weightGrams = Number(barcode.slice(6, 12));
  if (weightGrams <= 0) return null;

  return { itemCode, weightKg: weightGrams / 1000 };
}
