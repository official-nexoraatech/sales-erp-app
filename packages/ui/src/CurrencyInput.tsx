import { forwardRef } from 'react';
import Input, { type InputProps } from './Input.js';
import { buildNumericPattern, useControlledNumericText } from './useControlledNumericText.js';

export interface CurrencyInputProps extends Omit<
  InputProps,
  'onChange' | 'value' | 'type' | 'prefix' | 'inputMode'
> {
  value: number | '';
  onChange: (value: number | '') => void;
  currencySymbol?: string;
  allowNegative?: boolean;
  decimals?: number;
}

/** ₹-prefixed, right-aligned numeric entry with negative/decimal support. */
const CurrencyInput = forwardRef<HTMLInputElement, CurrencyInputProps>(
  (
    {
      value,
      onChange,
      currencySymbol = '₹',
      allowNegative = false,
      decimals = 2,
      className = '',
      ...rest
    },
    ref
  ) => {
    const { text, handleChange } = useControlledNumericText(
      value,
      onChange,
      buildNumericPattern(allowNegative, decimals)
    );

    return (
      <Input
        {...rest}
        ref={ref}
        type="text"
        inputMode="decimal"
        prefix={<span className="font-medium">{currencySymbol}</span>}
        value={text}
        onChange={(e) => handleChange(e.target.value)}
        className={`text-right tabular-nums ${className}`}
      />
    );
  }
);

CurrencyInput.displayName = 'CurrencyInput';
export default CurrencyInput;
