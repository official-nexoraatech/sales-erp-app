import React from 'react';

interface SelectProps extends React.SelectHTMLAttributes<HTMLSelectElement> {
  label?: string;
  error?: string;
  options: Array<{ value: string | number; label: string }>;
  placeholder?: string;
}

export const Select = React.forwardRef<HTMLSelectElement, SelectProps>(
  ({ label, error, options, placeholder, className, ...props }, ref) => {
    const stateClass = error
      ? 'border-red-500 focus:border-red-500 focus:ring-red-100'
      : 'border-gray-300 focus:border-blue-300 focus:ring-blue-100';

    return (
      <div className="w-full">
        {label && (
          <label className="mb-1 block text-sm text-gray-600">
            {label}
          </label>
        )}
        <select
          ref={ref}
          className={`h-10 w-full rounded border bg-white px-3 text-sm text-gray-900 outline-none transition-colors focus:ring-2 disabled:cursor-not-allowed disabled:bg-gray-50 ${stateClass} ${className || ''}`}
          {...props}
        >
          {placeholder && (
            <option value="">
              {placeholder}
            </option>
          )}
          {options.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
        {error && <p className="text-red-500 text-sm mt-1">{error}</p>}
      </div>
    );
  }
);

Select.displayName = 'Select';
