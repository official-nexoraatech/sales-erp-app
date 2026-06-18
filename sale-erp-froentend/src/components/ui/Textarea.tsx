import React from 'react';

interface TextareaProps extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {
  label?: string;
  error?: string;
}

export const Textarea = React.forwardRef<HTMLTextAreaElement, TextareaProps>(
  ({ label, error, className, ...props }, ref) => {
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
        <textarea
          ref={ref}
          className={`w-full resize-none rounded border bg-white px-3 py-2 text-sm text-gray-900 outline-none transition-colors placeholder:text-gray-400 focus:ring-2 disabled:cursor-not-allowed disabled:bg-gray-50 ${stateClass} ${className || ''}`}
          {...props}
        />
        {error && <p className="text-red-500 text-sm mt-1">{error}</p>}
      </div>
    );
  }
);

Textarea.displayName = 'Textarea';
