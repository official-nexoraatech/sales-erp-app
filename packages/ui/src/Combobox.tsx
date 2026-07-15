import {
  useState,
  useEffect,
  useRef,
  useId,
  useCallback,
  useMemo,
  type KeyboardEvent,
  type ReactNode,
} from 'react';
import { Search, Loader2, ChevronDown, X, Check } from 'lucide-react';
import { cn } from './cn.js';
import { ICON_SIZE_BY_INPUT_SIZE, type InputVariants } from './inputVariants.js';

export interface ComboboxOption {
  value: string | number;
  label: string;
  sublabel?: string;
}

interface ComboboxProps<T extends ComboboxOption = ComboboxOption> {
  id?: string;
  label?: string | undefined;
  placeholder?: string;
  size?: InputVariants['size'];
  /** Sync mode: filters this list client-side as the user types. */
  options?: T[];
  /** Async mode: fetches results for the current query (debounced). Takes priority over `options`. */
  loadOptions?: (query: string) => Promise<T[]>;
  debounceMs?: number;
  minChars?: number;
  clearable?: boolean;
  error?: string | undefined;
  hint?: string | undefined;
  required?: boolean;
  disabled?: boolean;
  noOptionsMessage?: string;
  renderOption?: (option: T) => ReactNode;
  /** Single-select (default) */
  value?: T | null;
  onChange?: (option: T | null) => void;
  /** Multi-select: pass `multiple` + array value/onChange instead of the single-select pair above. */
  multiple?: boolean;
  values?: T[];
  onChangeMultiple?: (options: T[]) => void;
}

export default function Combobox<T extends ComboboxOption = ComboboxOption>({
  id: externalId,
  label,
  placeholder = 'Type to search…',
  size = 'md',
  options,
  loadOptions,
  debounceMs = 300,
  minChars = 0,
  clearable = true,
  error,
  hint,
  required,
  disabled,
  noOptionsMessage = 'No results found',
  renderOption,
  value,
  onChange,
  multiple = false,
  values = [],
  onChangeMultiple,
}: ComboboxProps<T>) {
  const uid = useId();
  const inputId = externalId ?? uid;
  const listId = `${uid}-list`;
  const errId = `${uid}-err`;
  const iconSize = ICON_SIZE_BY_INPUT_SIZE[size ?? 'md'];

  const [query, setQuery] = useState('');
  const [asyncOptions, setAsyncOptions] = useState<T[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isOpen, setIsOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);

  const inputRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const isSelected = useCallback(
    (opt: T) => (multiple ? values.some((v) => v.value === opt.value) : value?.value === opt.value),
    [multiple, values, value]
  );

  const doSearch = useCallback(
    async (q: string) => {
      if (!loadOptions) return;
      if (q.length < minChars) {
        setAsyncOptions([]);
        return;
      }
      setIsLoading(true);
      try {
        setAsyncOptions(await loadOptions(q));
        setActiveIndex(-1);
      } catch {
        setAsyncOptions([]);
      } finally {
        setIsLoading(false);
      }
    },
    [loadOptions, minChars]
  );

  useEffect(() => {
    if (!loadOptions) return;
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => doSearch(query), debounceMs);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [query, debounceMs, doSearch, loadOptions]);

  const visibleOptions = useMemo(() => {
    if (loadOptions) return asyncOptions;
    const source = options ?? [];
    if (query.length < minChars) return source;
    const q = query.trim().toLowerCase();
    if (!q) return source;
    return source.filter((o) => o.label.toLowerCase().includes(q));
  }, [loadOptions, asyncOptions, options, query, minChars]);

  useEffect(() => {
    function onDown(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    }
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, []);

  function handleSelect(opt: T) {
    if (multiple) {
      const next = isSelected(opt) ? values.filter((v) => v.value !== opt.value) : [...values, opt];
      onChangeMultiple?.(next);
      return;
    }
    onChange?.(opt);
    setQuery('');
    setIsOpen(false);
    inputRef.current?.blur();
  }

  function handleClear(e: React.MouseEvent) {
    e.stopPropagation();
    if (multiple) onChangeMultiple?.([]);
    else onChange?.(null);
    setQuery('');
    inputRef.current?.focus();
  }

  function handleKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (!isOpen && (e.key === 'ArrowDown' || e.key === 'Enter')) {
      setIsOpen(true);
      return;
    }
    if (!isOpen) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActiveIndex((i) => Math.min(i + 1, visibleOptions.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActiveIndex((i) => Math.max(i - 1, 0));
    } else if (e.key === 'Enter' && activeIndex >= 0) {
      e.preventDefault();
      const opt = visibleOptions[activeIndex];
      if (opt) handleSelect(opt);
    } else if (e.key === 'Escape') {
      setIsOpen(false);
    }
  }

  const hasValue = multiple ? values.length > 0 : Boolean(value);
  const displayValue = multiple
    ? values.length === 1
      ? values[0]?.label
      : values.length > 1
        ? `${values.length} selected`
        : ''
    : (value?.label ?? '');

  return (
    <div className="flex flex-col gap-1.5">
      {label && (
        <label htmlFor={inputId} className="text-sm font-medium text-primary tracking-[-0.01em]">
          {label}
          {required && (
            <span className="text-danger ml-0.5" aria-hidden="true">
              *
            </span>
          )}
        </label>
      )}

      <div ref={containerRef} className="relative">
        <div
          className={cn(
            'flex items-center rounded-md border bg-surface-card transition-[border-color,box-shadow] duration-150 ease-out',
            error
              ? 'border-error focus-within:shadow-[var(--shadow-focus-error)]'
              : 'border-default hover:border-strong focus-within:border-focus focus-within:shadow-[var(--shadow-focus)]',
            disabled && 'cursor-not-allowed opacity-50'
          )}
        >
          <Search size={iconSize} className="ml-3.5 shrink-0 text-secondary" aria-hidden="true" />
          <input
            ref={inputRef}
            id={inputId}
            type="text"
            role="combobox"
            aria-autocomplete="list"
            aria-controls={listId}
            aria-expanded={isOpen}
            aria-activedescendant={activeIndex >= 0 ? `${uid}-opt-${activeIndex}` : undefined}
            aria-required={required}
            aria-invalid={Boolean(error)}
            aria-describedby={error ? errId : undefined}
            disabled={disabled}
            placeholder={hasValue && !multiple ? displayValue : placeholder}
            value={multiple ? query : hasValue ? '' : query}
            onChange={(e) => {
              if (!multiple && hasValue) onChange?.(null);
              setQuery(e.target.value);
              setIsOpen(true);
            }}
            onKeyDown={handleKeyDown}
            onFocus={() => setIsOpen(true)}
            className={cn(
              'flex-1 min-w-0 bg-transparent px-2.5 text-primary placeholder:text-placeholder outline-none disabled:cursor-not-allowed',
              size === 'sm'
                ? 'h-[var(--input-height-sm)] text-sm'
                : size === 'lg'
                  ? 'h-[var(--input-height-lg)] text-base'
                  : size === 'xl'
                    ? 'h-[var(--input-height-xl)] text-lg'
                    : 'h-[var(--input-height-md)] text-base'
            )}
          />
          {isLoading && (
            <Loader2
              size={iconSize}
              className="mr-3 shrink-0 animate-spin text-secondary"
              aria-hidden="true"
            />
          )}
          {!isLoading && hasValue && clearable && (
            <button
              type="button"
              aria-label="Clear selection"
              onClick={handleClear}
              className="mr-1.5 rounded-md p-1 text-secondary transition-colors hover:bg-surface-subtle hover:text-primary"
            >
              <X size={14} />
            </button>
          )}
          {!isLoading && !hasValue && (
            <ChevronDown
              size={iconSize}
              className="mr-3.5 shrink-0 text-secondary"
              aria-hidden="true"
            />
          )}
        </div>

        {isOpen && (
          <ul
            id={listId}
            role="listbox"
            aria-multiselectable={multiple}
            className="absolute z-[var(--z-dropdown)] mt-1.5 max-h-72 w-full overflow-y-auto rounded-xl border border-default bg-surface-overlay p-1.5 shadow-token-lg"
          >
            {visibleOptions.length === 0 ? (
              <li className="px-3 py-2.5 text-sm text-secondary">
                {isLoading ? 'Searching…' : noOptionsMessage}
              </li>
            ) : (
              visibleOptions.map((opt, i) => {
                const selected = isSelected(opt);
                return (
                  <li
                    key={opt.value}
                    id={`${uid}-opt-${i}`}
                    role="option"
                    aria-selected={selected}
                    onMouseDown={(e) => {
                      e.preventDefault();
                      handleSelect(opt);
                    }}
                    onMouseEnter={() => setActiveIndex(i)}
                    className={cn(
                      'flex cursor-pointer items-center justify-between gap-2 rounded-lg px-3 py-2.5 text-sm transition-colors',
                      i === activeIndex
                        ? 'bg-primary-subtle text-brand'
                        : 'text-primary hover:bg-surface-subtle'
                    )}
                  >
                    <span>
                      {renderOption ? (
                        renderOption(opt)
                      ) : (
                        <>
                          <div className="font-medium">{opt.label}</div>
                          {opt.sublabel && (
                            <div className="text-xs text-secondary">{opt.sublabel}</div>
                          )}
                        </>
                      )}
                    </span>
                    {selected && (
                      <Check size={14} className="shrink-0 text-brand" aria-hidden="true" />
                    )}
                  </li>
                );
              })
            )}
          </ul>
        )}
      </div>

      {error && (
        <p id={errId} role="alert" className="text-xs text-danger">
          {error}
        </p>
      )}
      {!error && hint && <p className="text-xs text-secondary">{hint}</p>}
    </div>
  );
}
