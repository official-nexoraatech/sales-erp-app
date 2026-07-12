import { forwardRef } from 'react';
import { ScanBarcode } from 'lucide-react';
import Input, { type InputProps } from './Input.js';

export type BarcodeInputProps = Omit<InputProps, 'leftIcon' | 'type'>;

/** Scanner-friendly: monospace, select-all-on-focus (so a re-scan overwrites, not appends). */
const BarcodeInput = forwardRef<HTMLInputElement, BarcodeInputProps>(
  ({ className = '', size = 'lg', onFocus, ...rest }, ref) => (
    <Input
      {...rest}
      ref={ref}
      type="text"
      size={size}
      leftIcon={<ScanBarcode size={18} />}
      onFocus={(e) => {
        e.currentTarget.select();
        onFocus?.(e);
      }}
      className={`font-mono tracking-wide ${className}`}
    />
  )
);

BarcodeInput.displayName = 'BarcodeInput';
export default BarcodeInput;
