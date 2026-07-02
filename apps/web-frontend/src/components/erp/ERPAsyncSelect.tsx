import {
  useState, useEffect, useRef, useId, useCallback,
  type KeyboardEvent, type ReactNode,
} from 'react';
import { Search, Loader2, ChevronDown, X } from 'lucide-react';

export interface AsyncSelectOption {
  value: string | number;
  label: string;
  sublabel?: string;
}

interface Props<T extends AsyncSelectOption = AsyncSelectOption> {
  id?: string;
  label?: string;
  placeholder?: string;
  value?: T | null;
  onChange: (option: T | null) => void;
  loadOptions: (query: string) => Promise<T[]>;
  debounceMs?: number;
  minChars?: number;
  clearable?: boolean;
  error?: string;
  hint?: string;
  required?: boolean;
  disabled?: boolean;
  noOptionsMessage?: string;
  renderOption?: (option: T) => ReactNode;
}

export default function ERPAsyncSelect<T extends AsyncSelectOption = AsyncSelectOption>({
  id: externalId,
  label,
  placeholder = 'Type to search…',
  value,
  onChange,
  loadOptions,
  debounceMs = 300,
  minChars = 1,
  clearable = true,
  error,
  hint,
  required,
  disabled,
  noOptionsMessage = 'No results found',
  renderOption,
}: Props<T>) {
  const uid = useId();
  const inputId = externalId ?? uid;
  const listId = `${uid}-list`;
  const errId = `${uid}-err`;

  const [query, setQuery] = useState('');
  const [options, setOptions] = useState<T[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isOpen, setIsOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);

  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const doSearch = useCallback(
    async (q: string) => {
      if (q.length < minChars) { setOptions([]); return; }
      setIsLoading(true);
      try {
        const results = await loadOptions(q);
        setOptions(results);
        setIsOpen(true);
        setActiveIndex(-1);
      } catch {
        setOptions([]);
      } finally {
        setIsLoading(false);
      }
    },
    [loadOptions, minChars]
  );

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => doSearch(query), debounceMs);
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, [query, debounceMs, doSearch]);

  // Close on outside click
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
    onChange(opt);
    setQuery('');
    setIsOpen(false);
    inputRef.current?.blur();
  }

  function handleClear(e: React.MouseEvent) {
    e.stopPropagation();
    onChange(null);
    setQuery('');
    setOptions([]);
    inputRef.current?.focus();
  }

  function handleKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (!isOpen) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActiveIndex((i) => Math.min(i + 1, options.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActiveIndex((i) => Math.max(i - 1, 0));
    } else if (e.key === 'Enter' && activeIndex >= 0) {
      e.preventDefault();
      const opt = options[activeIndex];
      if (opt) handleSelect(opt);
    } else if (e.key === 'Escape') {
      setIsOpen(false);
    }
  }

  const displayValue = value ? value.label : '';
  const hasValue = !!value;

  return (
    <div className="flex flex-col gap-1">
      {label && (
        <label htmlFor={inputId} className="text-sm font-medium text-primary">
          {label}
          {required && <span className="text-danger ml-0.5" aria-hidden="true">*</span>}
        </label>
      )}
      <div ref={containerRef} className="relative">
        {/* Value display / search input */}
        <div
          className={`flex items-center rounded-lg border bg-surface-card transition-colors ${
            error
              ? 'border-error focus-within:ring-2 focus-within:ring-danger/20'
              : 'border-default focus-within:border-focus focus-within:ring-2 focus-within:ring-brand/20'
          } ${disabled ? 'opacity-50 cursor-not-allowed' : ''}`}
        >
          <Search size={14} className="ml-3 shrink-0 text-secondary" />
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
            aria-invalid={!!error}
            aria-describedby={error ? errId : undefined}
            disabled={disabled}
            placeholder={hasValue ? displayValue : placeholder}
            value={hasValue ? '' : query}
            onChange={(e) => {
              if (hasValue) onChange(null);
              setQuery(e.target.value);
            }}
            onKeyDown={handleKeyDown}
            onFocus={() => { if (query.length >= minChars && options.length > 0) setIsOpen(true); }}
            className="flex-1 min-w-0 bg-transparent px-2 py-2.5 text-sm text-primary placeholder:text-placeholder outline-none disabled:cursor-not-allowed"
          />
          {isLoading && <Loader2 size={14} className="mr-2 animate-spin text-secondary shrink-0" />}
          {!isLoading && hasValue && clearable && (
            <button
              type="button"
              aria-label="Clear selection"
              onClick={handleClear}
              className="mr-1 p-1 rounded hover:bg-surface-raised text-secondary hover:text-primary"
            >
              <X size={12} />
            </button>
          )}
          {!isLoading && !hasValue && (
            <ChevronDown size={14} className="mr-3 shrink-0 text-secondary" />
          )}
        </div>

        {/* Dropdown */}
        {isOpen && (
          <ul
            ref={listRef}
            id={listId}
            role="listbox"
            className="absolute z-[--z-dropdown] w-full mt-1 bg-surface-overlay border border-default rounded-lg shadow-token-md max-h-60 overflow-y-auto"
          >
            {options.length === 0 ? (
              <li className="px-3 py-2.5 text-sm text-secondary">{noOptionsMessage}</li>
            ) : (
              options.map((opt, i) => (
                <li
                  key={opt.value}
                  id={`${uid}-opt-${i}`}
                  role="option"
                  aria-selected={i === activeIndex}
                  onMouseDown={() => handleSelect(opt)}
                  onMouseEnter={() => setActiveIndex(i)}
                  className={`px-3 py-2.5 cursor-pointer text-sm transition-colors ${
                    i === activeIndex
                      ? 'bg-primary-subtle text-brand'
                      : 'text-primary hover:bg-surface-raised'
                  }`}
                >
                  {renderOption ? renderOption(opt) : (
                    <div>
                      <div className="font-medium">{opt.label}</div>
                      {opt.sublabel && <div className="text-xs text-secondary">{opt.sublabel}</div>}
                    </div>
                  )}
                </li>
              ))
            )}
          </ul>
        )}
      </div>

      {error && <p id={errId} className="text-xs text-danger" role="alert">{error}</p>}
      {!error && hint && <p className="text-xs text-secondary">{hint}</p>}
    </div>
  );
}
