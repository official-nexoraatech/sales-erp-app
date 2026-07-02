import { forwardRef, type SelectHTMLAttributes } from 'react';
import { ChevronDown } from 'lucide-react';

interface SelectOption {
  value: string | number;
  label: string;
  disabled?: boolean;
}

interface Props extends Omit<SelectHTMLAttributes<HTMLSelectElement>, 'children'> {
  options: SelectOption[];
  placeholder?: string;
  error?: string;
}

const ERPSelect = forwardRef<HTMLSelectElement, Props>(
  ({ options, placeholder, error, id, className = '', ...rest }, ref) => {
    const errorId = id ? `${id}-error` : undefined;

    return (
      <div className="relative">
        <select
          ref={ref}
          id={id}
          aria-invalid={Boolean(error)}
          aria-describedby={error && errorId ? errorId : undefined}
          className={[
            'w-full appearance-none bg-surface-card text-primary',
            'border border-default rounded-lg px-3 py-2 pr-9 text-sm',
            'outline-none ring-0 transition-colors',
            'focus:border-brand focus:ring-2 focus:ring-brand/20',
            'disabled:bg-surface-subtle disabled:text-secondary disabled:cursor-not-allowed',
            error ? 'border-danger focus:border-danger focus:ring-danger/20' : '',
            className,
          ]
            .filter(Boolean)
            .join(' ')}
          {...rest}
        >
          {placeholder && (
            <option value="" disabled>{placeholder}</option>
          )}
          {options.map((opt) => (
            <option key={opt.value} value={opt.value} disabled={opt.disabled}>
              {opt.label}
            </option>
          ))}
        </select>
        <ChevronDown
          size={14}
          className="absolute right-3 top-1/2 -translate-y-1/2 text-secondary pointer-events-none"
        />
      </div>
    );
  }
);

ERPSelect.displayName = 'ERPSelect';
export default ERPSelect;
