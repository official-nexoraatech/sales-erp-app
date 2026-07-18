import { useCallback, useRef } from 'react';

// A keyboard-wedge barcode scanner "types" its payload character-by-character far faster
// than a human ever can — this tells the two apart by keystroke cadence so the omnibox can
// route a scan straight to the exact-match barcode lookup instead of the fuzzy-search path.
const SCAN_MAX_GAP_MS = 30;
const SCAN_MIN_LENGTH = 4;

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
