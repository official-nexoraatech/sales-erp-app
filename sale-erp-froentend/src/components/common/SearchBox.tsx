import React from 'react';
import { Search, X } from 'lucide-react';

interface SearchBoxProps {
  placeholder?: string;
  value: string;
  onChange: (value: string) => void;
}

export const SearchBox: React.FC<SearchBoxProps> = ({
  placeholder = 'Search...',
  value,
  onChange,
}) => (
  <div className="relative">
    <Search
      className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 dark:text-slate-500"
      size={15}
    />
    <input
      type="text"
      placeholder={placeholder}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className={[
        'h-9 w-full rounded-lg border pl-9 pr-8 text-sm outline-none transition-colors',
        'border-slate-200 bg-white text-slate-900 placeholder:text-slate-400',
        'focus:border-blue-400 focus:ring-2 focus:ring-blue-100',
        'dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100 dark:placeholder:text-slate-500',
        'dark:focus:border-blue-400 dark:focus:ring-blue-900/30',
      ].join(' ')}
      aria-label={placeholder}
    />
    {value && (
      <button
        type="button"
        onClick={() => onChange('')}
        aria-label="Clear search"
        className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-0.5 text-slate-400 hover:text-slate-600 dark:text-slate-500 dark:hover:text-slate-300 transition-colors"
      >
        <X size={13} />
      </button>
    )}
  </div>
);
