import { useState, type RefObject } from 'react';
import { SearchInput } from '@erp/ui';
import toast from 'react-hot-toast';
import { useBarcodeScanDetector } from '../../hooks/useBarcodeScanDetector.js';
import { searchItemsOnce } from '../../hooks/useItemSearch.js';
import type { POSItem, POSSearchResult } from './types.js';

interface Props {
  barcodeRef: RefObject<HTMLInputElement | null>;
  videoRef: RefObject<HTMLVideoElement | null>;
  scanFlash: 'success' | 'error' | null;
  cameraOpen: boolean;
  onToggleCamera: () => void;
  /** Scanner-cadence exact match, and the typed-but-unmatched fallback — same barcode lookup path as before. */
  onSubmit: (value: string) => void;
  /** A result picked from the one-shot search, already has full item data, no lookup round trip needed. */
  onSelectItem: (item: POSItem) => void;
}

// Search-on-submit only — no live dropdown while typing. Enter either resolves a scanner-speed
// value straight to the barcode lookup, or (for a typed value) runs a single search against the
// catalog: a unique match is added directly, no matches falls back to the barcode/quick-item
// resolution path, and multiple matches point the cashier at Browse Catalog (F3) rather than
// guessing which one they meant.
export function POSOmnibox({
  barcodeRef,
  videoRef,
  scanFlash,
  cameraOpen,
  onToggleCamera,
  onSubmit,
  onSelectItem,
}: Props) {
  const [query, setQuery] = useState('');
  const [isSearching, setIsSearching] = useState(false);
  const scanDetector = useBarcodeScanDetector();

  const clearAndFocus = () => {
    setQuery('');
    scanDetector.reset();
    barcodeRef.current?.focus();
  };

  const handleSelect = (item: POSSearchResult) => {
    onSelectItem({
      id: item.itemId,
      name: item.name,
      salePrice: String(item.price),
      mrp: item.mrp,
      gstRate: item.gstRate,
      cessRate: item.cessRate,
      ...(item.barcode ? { barcode: item.barcode } : {}),
    });
    clearAndFocus();
  };

  const handleSubmit = async (value: string) => {
    if (scanDetector.isLikelyScan(value)) {
      onSubmit(value);
      setQuery('');
      scanDetector.reset();
      return;
    }

    setIsSearching(true);
    try {
      const results = await searchItemsOnce(value);
      if (results.length === 1) {
        handleSelect(results[0]!);
      } else if (results.length === 0) {
        onSubmit(value);
        setQuery('');
        scanDetector.reset();
      } else {
        toast(`Multiple items match "${value}" — use Browse Catalog (F3) to pick one`);
      }
    } catch {
      // search request itself failed — fall back to the same resolution path a barcode uses
      onSubmit(value);
      setQuery('');
      scanDetector.reset();
    } finally {
      setIsSearching(false);
    }
  };

  return (
    <div className="flex flex-col gap-3 w-full">
      <SearchInput
        ref={barcodeRef}
        size="xl"
        placeholder="Scan barcode, or type name / SKU / alias / code…"
        value={query}
        onBarcodeClick={onToggleCamera}
        barcodeActive={cameraOpen}
        loading={isSearching}
        className={
          scanFlash === 'success'
            ? 'border-success shadow-[0_0_0_4px_color-mix(in_srgb,var(--color-success)_20%,transparent)] bg-success-bg'
            : scanFlash === 'error'
              ? 'border-danger shadow-[0_0_0_4px_color-mix(in_srgb,var(--color-danger)_20%,transparent)] bg-danger-bg'
              : ''
        }
        onChange={(e) => {
          const value = e.target.value;
          setQuery(value);
          if (!value) scanDetector.reset();
        }}
        onClear={() => clearAndFocus()}
        onKeyDown={(e) => {
          if (e.key.length === 1) scanDetector.recordKeystroke();
          if (e.key === 'Enter') {
            const value = query.trim();
            if (!value || isSearching) return;
            void handleSubmit(value);
          }
        }}
      />

      {cameraOpen && (
        <div className="rounded-xl overflow-hidden border-2 border-focus bg-black">
          <video ref={videoRef} className="w-full max-h-56 object-cover" muted />
        </div>
      )}
    </div>
  );
}
