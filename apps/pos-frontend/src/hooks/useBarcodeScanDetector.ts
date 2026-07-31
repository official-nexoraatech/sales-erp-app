import { useCallback, useRef } from 'react';

// A keyboard-wedge barcode scanner "types" its payload character-by-character far faster
// than a human ever can — this tells the two apart by keystroke cadence so the omnibox can
// route a scan straight to the exact-match barcode lookup instead of the fuzzy-search path.
const SCAN_MAX_GAP_MS = 30;
const SCAN_MIN_LENGTH = 4;

// GS1 modulo-10 check digit, shared by EAN-8/UPC-A/EAN-13/GTIN-14: reverse the digits
// excluding the check digit, weight 3/1 alternating starting from the one closest to the
// check digit, sum, check = (10 - sum % 10) % 10.
function gs1CheckDigitValid(digits: string): boolean {
  const nums = digits.split('').map(Number);
  const check = nums[nums.length - 1]!;
  const body = nums.slice(0, -1).reverse();
  const sum = body.reduce((acc, d, i) => acc + d * (i % 2 === 0 ? 3 : 1), 0);
  const expected = (10 - (sum % 10)) % 10;
  return expected === check;
}

// A scan that decodes to garbage (partial read, mid-scan interruption) can still pass the
// cadence-based isLikelyScan() check below — this catches the subset of formats that carry a
// verifiable checksum digit (EAN-8/12/13/14) before spending a lookup round-trip on a value
// that's provably not a real barcode. Anything else (Code128 alphanumeric SKUs, QR payloads,
// internal item/custom codes) has no checksum to verify — treated as "not applicable" (valid),
// not rejected, since this app's scan path is deliberately format-agnostic.
export function isValidBarcodeChecksum(value: string): boolean {
  if (!/^\d+$/.test(value)) return true;
  if (![8, 12, 13, 14].includes(value.length)) return true;
  return gs1CheckDigitValid(value);
}

export function useBarcodeScanDetector() {
  const timestamps = useRef<number[]>([]);

  const recordKeystroke = useCallback(() => {
    timestamps.current.push(performance.now());
  }, []);

  const reset = useCallback(() => {
    timestamps.current = [];
  }, []);

  const isLikelyScan = useCallback((value: string): boolean => {
    const times = timestamps.current;
    if (value.length < SCAN_MIN_LENGTH || times.length < SCAN_MIN_LENGTH) return false;
    for (let i = 1; i < times.length; i++) {
      if (times[i]! - times[i - 1]! >= SCAN_MAX_GAP_MS) return false;
    }
    return true;
  }, []);

  return { recordKeystroke, reset, isLikelyScan };
}
