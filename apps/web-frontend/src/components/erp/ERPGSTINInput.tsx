import { forwardRef, useId, useState } from 'react';
import { CheckCircle2, XCircle } from 'lucide-react';
import { GSTIN_REGEX } from '@erp/types';

function validateGSTIN(value: string): boolean {
  return GSTIN_REGEX.test(value.toUpperCase());
}

interface Props extends Omit<React.InputHTMLAttributes<HTMLInputElement>, 'onChange'> {
  label?: string;
  error?: string | undefined;
  hint?: string;
  value?: string;
  onChange?: (value: string, valid: boolean) => void;
}

const ERPGSTINInput = forwardRef<HTMLInputElement, Props>(
  ({ label, error, hint, value = '', onChange, required, disabled, id: externalId, ...rest }, ref) => {
    const uid = useId();
    const inputId = externalId ?? uid;
    const errId = `${uid}-err`;
    const [touched, setTouched] = useState(false);

    const upper = value.toUpperCase();
    const isValid = upper.length > 0 && validateGSTIN(upper);
    const isInvalid = upper.length > 0 && !isValid;
    const showValidation = touched && upper.length > 0;

    function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
      const raw = e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 15);
      onChange?.(raw, validateGSTIN(raw));
    }

    const hasError = !!error || (showValidation && isInvalid);

    return (
      <div className="flex flex-col gap-1">
        {label && (
          <label htmlFor={inputId} className="text-sm font-medium text-primary">
            {label}
            {required && <span className="text-danger ml-0.5" aria-hidden="true">*</span>}
          </label>
        )}
        <div className="relative">
          <input
            ref={ref}
            id={inputId}
            type="text"
            inputMode="text"
            autoCapitalize="characters"
            autoCorrect="off"
            spellCheck={false}
            maxLength={15}
            value={upper}
            onChange={handleChange}
            onBlur={() => setTouched(true)}
            aria-invalid={hasError}
            aria-required={required}
            aria-describedby={hasError ? errId : undefined}
            disabled={disabled}
            placeholder="22AAAAA0000A1Z5"
            className={`w-full rounded-lg border px-3 py-2.5 pr-9 text-sm font-mono bg-surface-card text-primary placeholder:text-placeholder outline-none transition-colors ${
              hasError
                ? 'border-error focus:ring-2 focus:ring-danger/20'
                : 'border-default focus:border-focus focus:ring-2 focus:ring-brand/20'
            } ${disabled ? 'opacity-50 cursor-not-allowed' : ''}`}
            {...rest}
          />
          {/* Validation icon */}
          {showValidation && (
            <div className="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none">
              {isValid
                ? <CheckCircle2 size={16} className="text-success" />
                : <XCircle size={16} className="text-danger" />
              }
            </div>
          )}
        </div>

        {hasError && (
          <p id={errId} className="text-xs text-danger" role="alert">
            {error ?? 'Invalid GSTIN format. Example: 22AAAAA0000A1Z5'}
          </p>
        )}
        {!hasError && hint && <p className="text-xs text-secondary">{hint}</p>}
        {!hasError && !hint && upper.length > 0 && isValid && (
          <p className="text-xs text-success">Valid GSTIN</p>
        )}
      </div>
    );
  }
);
ERPGSTINInput.displayName = 'ERPGSTINInput';
export default ERPGSTINInput;
