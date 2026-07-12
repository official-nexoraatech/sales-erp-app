import { useEffect, useState } from 'react';

/**
 * Shared sync logic for CurrencyInput/DiscountInput: keeps a local text buffer so an
 * in-progress "12." or "-" isn't erased before the user finishes typing it, while still
 * reporting a parsed number up to the caller once the text is a complete numeric value.
 */
export function useControlledNumericText(
  value: number | '',
  onChange: (value: number | '') => void,
  pattern: RegExp
) {
  const [text, setText] = useState(value === '' ? '' : String(value));

  useEffect(() => {
    setText((prev) =>
      Number(prev) === value || (prev === '' && value === '')
        ? prev
        : value === ''
          ? ''
          : String(value)
    );
  }, [value]);

  function handleChange(raw: string) {
    if (raw !== '' && raw !== '-' && !pattern.test(raw)) return;
    setText(raw);
    if (raw === '' || raw === '-' || raw.endsWith('.')) return;
    const n = Number(raw);
    if (!Number.isNaN(n)) onChange(n);
  }

  return { text, handleChange };
}

export function buildNumericPattern(allowNegative: boolean, decimals: number): RegExp {
  const sign = allowNegative ? '-?' : '';
  const frac = decimals > 0 ? `(\\.\\d{0,${decimals}})?` : '';
  return new RegExp(`^${sign}\\d*${frac}$`);
}
