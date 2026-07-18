import { useEffect, useRef, useState, type RefObject } from 'react';
import { SearchInput } from '@erp/ui';
import { useDebouncedValue } from '../../hooks/useDebouncedValue.js';
import { useBarcodeScanDetector } from '../../hooks/useBarcodeScanDetector.js';
import { useItemSearch } from '../../hooks/useItemSearch.js';
import POSAutocompleteList from './POSAutocompleteList.js';
import type { POSItem, POSSearchResult } from './types.js';

const DEBOUNCE_MS = 180;
const MIN_QUERY_LENGTH = 2;

interface Props {
  barcodeRef: RefObject<HTMLInputElement | null>;
  videoRef: RefObject<HTMLVideoElement | null>;
  scanFlash: 'success' | 'error' | null;
  cameraOpen: boolean;
  onToggleCamera: () => void;
  /** Scanner-cadence exact match, and the typed-but-unmatched fallback — same barcode lookup path as before. */
  onSubmit: (value: string) => void;
  /** A result picked from the fuzzy dropdown — already has full item data, no lookup round trip needed. */
  onSelectItem: (item: POSItem) => void;
}

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
  const [isOpen, setIsOpen] = useState(false);
  const [highlightedIndex, setHighlightedIndex] = useState(0);
  const debouncedQuery = useDebouncedValue(query, DEBOUNCE_MS);
  const scanDetector = useBarcodeScanDetector();
  const listboxRef = useRef<HTMLDivElement>(null);

  const searchEnabled = debouncedQuery.trim().length >= MIN_QUERY_LENGTH;

  const { data, fetchNextPage, hasNextPage, isFetchingNextPage, isFetching } = useItemSearch(
    debouncedQuery,
    {},
    searchEnabled
  );
  const results = data?.pages.flatMap((p) => p.data) ?? [];
  const showDropdown = isOpen && searchEnabled;

  // A fresh set of results (new debounced query) always starts highlighting the top match.
  useEffect(() => {
    setHighlightedIndex(0);
  }, [debouncedQuery]);

  const clearAndClose = () => {
    setQuery('');
    setIsOpen(false);
    scanDetector.reset();
  };

  const handleSelect = (item: POSSearchResult) => {
    onSelectItem({
      id: item.itemId,
      name: item.name,
      salePrice: String(item.price),
      gstRate: item.gstRate,
      ...(item.barcode ? { barcode: item.barcode } : {}),
    });
    clearAndClose();
    barcodeRef.current?.focus();
  };

  return (
    <div className="flex flex-col gap-3">
      <div className="relative">
        <SearchInput
          ref={barcodeRef}
          size="xl"
          role="combobox"
          aria-expanded={showDropdown && results.length > 0}
          aria-controls="pos-omnibox-listbox"
          aria-activedescendant={
            showDropdown && results[highlightedIndex]
              ? `pos-result-${results[highlightedIndex]!.itemId}`
              : undefined
          }
          placeholder="Scan barcode, or type name / SKU / alias / code…"
          value={query}
          onBarcodeClick={onToggleCamera}
          barcodeActive={cameraOpen}
          loading={isFetching && !isFetchingNextPage}
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
            setIsOpen(value.trim().length > 0);
            if (!value) scanDetector.reset();
          }}
          onClear={() => clearAndClose()}
          onKeyDown={(e) => {
            if (e.key.length === 1) scanDetector.recordKeystroke();

            if (e.key === 'ArrowDown') {
              if (!showDropdown || results.length === 0) return;
              e.preventDefault();
              e.nativeEvent.stopPropagation();
              setHighlightedIndex((i) => (i + 1) % results.length);
            } else if (e.key === 'ArrowUp') {
              if (!showDropdown || results.length === 0) return;
              e.preventDefault();
              e.nativeEvent.stopPropagation();
              setHighlightedIndex((i) => (i - 1 + results.length) % results.length);
            } else if (e.key === 'Escape') {
              if (showDropdown) {
                e.nativeEvent.stopPropagation();
                setIsOpen(false);
              }
            } else if (e.key === 'Enter') {
              const value = query.trim();
              if (!value) return;
              if (scanDetector.isLikelyScan(value)) {
                onSubmit(value);
              } else if (showDropdown && results[highlightedIndex]) {
                handleSelect(results[highlightedIndex]!);
                return;
              } else {
                onSubmit(value);
              }
              clearAndClose();
            }
          }}
        />

        {showDropdown && (
          <div
            ref={listboxRef}
            className="absolute top-full left-0 right-0 mt-1 bg-surface-overlay border border-default rounded-xl shadow-token-lg overflow-hidden"
            style={{ zIndex: 'var(--z-dropdown)' }}
          >
            {results.length === 0 ? (
              <div className="px-4 py-3 text-sm text-secondary">
                {isFetching ? 'Searching…' : `No items match "${debouncedQuery}"`}
              </div>
            ) : (
              <POSAutocompleteList
                results={results}
                highlightedIndex={highlightedIndex}
                onSelect={handleSelect}
                onHover={setHighlightedIndex}
                hasNextPage={Boolean(hasNextPage)}
                isFetchingNextPage={isFetchingNextPage}
                onLoadMore={() => void fetchNextPage()}
              />
            )}
          </div>
        )}
      </div>

      {cameraOpen && (
        <div className="rounded-xl overflow-hidden border-2 border-focus bg-black">
          <video ref={videoRef} className="w-full max-h-56 object-cover" muted />
        </div>
      )}
    </div>
  );
}
