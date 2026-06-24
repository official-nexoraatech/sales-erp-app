import React from 'react';

interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  error?: string;
  helperText?: string;
}

export const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ label, error, helperText, className, type, inputMode, pattern, ...props }, ref) => {
    const stateClass = error
      ? 'border-red-500 focus:border-red-500 focus:ring-red-100'
      : 'border-gray-300 focus:border-blue-300 focus:ring-blue-100';
    const numericInput = type === 'number';

    return (
      <div className="w-full">
        {label && (
          <label className="mb-1 block text-sm text-gray-600">
            {label}
          </label>
        )}
        <input
          ref={ref}
          type={numericInput ? 'text' : type}
          inputMode={inputMode || (numericInput ? props.step === '1' ? 'numeric' : 'decimal' : undefined)}
          pattern={pattern || (numericInput ? props.step === '1' ? '[0-9]*' : '-?[0-9]*\\.?[0-9]*' : undefined)}
          className={`h-10 w-full rounded border bg-white px-3 text-sm text-gray-900 outline-none transition-colors placeholder:text-gray-400 focus:ring-2 disabled:cursor-not-allowed disabled:bg-gray-50 ${stateClass} ${className || ''}`}
          {...props}
        />
        {error && <p className="text-red-500 text-sm mt-1">{error}</p>}
        {helperText && !error && (
          <p className="text-gray-500 text-sm mt-1">{helperText}</p>
        )}
      </div>
    );
  }
);

Input.displayName = 'Input';
