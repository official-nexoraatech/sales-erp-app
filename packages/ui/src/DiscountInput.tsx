import { forwardRef } from 'react';
import Input, { type InputProps } from './Input.js';
import { buildNumericPattern, useControlledNumericText } from './useControlledNumericText.js';

export interface DiscountInputProps extends Omit<
  InputProps,
  'onChange' | 'value' | 'type' | 'rightIcon' | 'inputMode'
> {
  value: number | '';
  onChange: (value: number | '') => void;
  max?: number;
}

/** %-suffixed discount entry, 0–100 by default (clamped on the way out, not while typing). */
const DiscountInput = forwardRef<HTMLInputElement, DiscountInputProps>(
  ({ value, onChange, max = 100, className = '', ...rest }, ref) => {
    const { text, handleChange } = useControlledNumericText(
      value,
      (v) => {
        onChange(v === '' ? '' : Math.min(v, max));
      },
      buildNumericPattern(false, 2)
    );

    return (
      <Input
        {...rest}
        ref={ref}
        type="text"
        inputMode="decimal"
        rightIcon={<span className="font-medium">%</span>}
        value={text}
        onChange={(e) => handleChange(e.target.value)}
        className={`text-right tabular-nums ${className}`}
      />
    );
  }
);

DiscountInput.displayName = 'DiscountInput';
export default DiscountInput;
