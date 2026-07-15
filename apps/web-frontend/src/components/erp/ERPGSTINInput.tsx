import { forwardRef, useState } from 'react';
import { CheckCircle2, XCircle } from 'lucide-react';
import { GSTIN_REGEX } from '@erp/types';
import { Input } from '@erp/ui';

function validateGSTIN(value: string): boolean {
  return GSTIN_REGEX.test(value.toUpperCase());
}

interface Props extends Omit<React.InputHTMLAttributes<HTMLInputElement>, 'onChange' | 'size'> {
  label?: string;
  error?: string | undefined;
  hint?: string;
  value?: string;
  onChange?: (value: string, valid: boolean) => void;
}

const ERPGSTINInput = forwardRef<HTMLInputElement, Props>(
  ({ label, error, hint, value = '', onChange, required, disabled, ...rest }, ref) => {
    const [touched, setTouched] = useState(false);

    const upper = value.toUpperCase();
    const isValid = upper.length > 0 && validateGSTIN(upper);
    const isInvalid = upper.length > 0 && !isValid;
    const showValidation = touched && upper.length > 0;
    const hasError = Boolean(error) || (showValidation && isInvalid);

    function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
      const raw = e.target.value
        .toUpperCase()
        .replace(/[^A-Z0-9]/g, '')
        .slice(0, 15);
      onChange?.(raw, validateGSTIN(raw));
    }

    return (
      <Input
        {...rest}
        ref={ref}
        type="text"
        inputMode="text"
        autoCapitalize="characters"
        autoCorrect="off"
        spellCheck={false}
        maxLength={15}
        label={label}
        value={upper}
        onChange={handleChange}
        onBlur={() => setTouched(true)}
        required={required}
        disabled={disabled}
        placeholder="22AAAAA0000A1Z5"
        className="font-mono"
        error={hasError ? (error ?? 'Invalid GSTIN format. Example: 22AAAAA0000A1Z5') : undefined}
        success={!hasError && showValidation && isValid ? 'Valid GSTIN' : undefined}
        hint={!hasError && !showValidation ? hint : undefined}
        rightIcon={
          showValidation ? (
            isValid ? (
              <CheckCircle2 size={16} className="text-success" />
            ) : (
              <XCircle size={16} className="text-danger" />
            )
          ) : undefined
        }
      />
    );
  }
);
ERPGSTINInput.displayName = 'ERPGSTINInput';
export default ERPGSTINInput;
