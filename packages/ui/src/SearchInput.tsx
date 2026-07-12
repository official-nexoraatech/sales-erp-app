import { forwardRef, useId, useState, type InputHTMLAttributes } from 'react';
import { Search, X, ScanBarcode, Loader2 } from 'lucide-react';
import { cn } from './cn.js';
import { inputVariants, ICON_SIZE_BY_INPUT_SIZE, type InputVariants } from './inputVariants.js';

export interface SearchInputProps
  extends
    Omit<InputHTMLAttributes<HTMLInputElement>, 'size'>,
    Pick<InputVariants, 'size' | 'variant'> {
  wrapperClassName?: string;
  loading?: boolean;
  clearable?: boolean;
  onClear?: () => void;
  /** Shown as a `kbd` chip inside the field while it's empty and unfocused (e.g. "⌘K"). */
  shortcut?: string;
  /** Renders an adjacent barcode-scan button — the POS "scan or type" pattern. */
  onBarcodeClick?: () => void;
  barcodeActive?: boolean;
}

/**
 * The hero input: Spotlight-style search. Same `xl` size doubles as POS's large,
 * scanner-friendly search box — no separate component needed for that case.
 */
const SearchInput = forwardRef<HTMLInputElement, SearchInputProps>(
  (
    {
      wrapperClassName = '',
      className = '',
      loading,
      clearable = true,
      onClear,
      shortcut,
      onBarcodeClick,
      barcodeActive,
      size = 'lg',
      variant = 'default',
      value,
      id: externalId,
      onFocus,
      onBlur,
      ...rest
    },
    ref
  ) => {
    const uid = useId();
    const inputId = externalId ?? uid;
    const [focused, setFocused] = useState(false);
    const iconSize = ICON_SIZE_BY_INPUT_SIZE[size ?? 'lg'];
    const hasValue = Boolean(value) && String(value).length > 0;
    const showClear = clearable && !loading && hasValue;
    const showShortcut = shortcut && !focused && !hasValue;

    return (
      <div className={cn('flex items-center gap-2', wrapperClassName)}>
        <div className="relative min-w-0 flex-1">
          <Search
            size={iconSize}
            className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-secondary"
            aria-hidden="true"
          />
          <input
            {...rest}
            ref={ref}
            id={inputId}
            value={value}
            onFocus={(e) => {
              setFocused(true);
              onFocus?.(e);
            }}
            onBlur={(e) => {
              setFocused(false);
              onBlur?.(e);
            }}
            className={cn(
              inputVariants({ size, variant, state: 'default' }),
              size === 'xl' ? 'pl-12' : size === 'sm' ? 'pl-9' : 'pl-11',
              (showClear || showShortcut || loading) && (size === 'xl' ? 'pr-14' : 'pr-11'),
              'font-normal',
              className
            )}
          />
          <div className="absolute right-3.5 top-1/2 flex -translate-y-1/2 items-center gap-1.5">
            {loading && (
              <Loader2 size={iconSize} className="animate-spin text-secondary" aria-hidden="true" />
            )}
            {!loading && showClear && (
              <button
                type="button"
                onClick={onClear}
                aria-label="Clear search"
                className="rounded-md p-0.5 text-secondary transition-colors hover:bg-surface-subtle hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/30"
              >
                <X size={iconSize} />
              </button>
            )}
            {!loading && !showClear && showShortcut && (
              <kbd className="rounded-md border border-default bg-surface-subtle px-1.5 py-0.5 text-xs font-medium text-secondary">
                {shortcut}
              </kbd>
            )}
          </div>
        </div>

        {onBarcodeClick && (
          <button
            type="button"
            onClick={onBarcodeClick}
            title="Scan with camera"
            aria-label="Scan with camera"
            aria-pressed={barcodeActive}
            className={cn(
              'flex shrink-0 items-center justify-center rounded-xl border transition-colors',
              size === 'xl'
                ? 'h-[var(--input-height-xl)] w-[var(--input-height-xl)]'
                : 'h-[var(--input-height-lg)] w-[var(--input-height-lg)]',
              barcodeActive
                ? 'border-focus bg-primary-subtle text-brand'
                : 'border-default text-secondary hover:border-strong hover:text-primary'
            )}
          >
            <ScanBarcode size={iconSize + 4} />
          </button>
        )}
      </div>
    );
  }
);

SearchInput.displayName = 'SearchInput';
export default SearchInput;
