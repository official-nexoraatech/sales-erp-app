import { forwardRef } from 'react';
import { Calendar } from 'lucide-react';
import Input, { type InputProps } from './Input.js';

export type DateInputProps = Omit<InputProps, 'leftIcon' | 'type'>;

/**
 * A styled native <input type="date">. Deliberately not a custom calendar-grid widget —
 * no date-picker library is installed in this repo yet, and the native control already
 * gives correct keyboard entry, locale formatting, and a11y for free.
 */
const DateInput = forwardRef<HTMLInputElement, DateInputProps>(
  ({ className = '', ...rest }, ref) => (
    <Input
      {...rest}
      ref={ref}
      type="date"
      leftIcon={<Calendar size={16} />}
      className={className}
    />
  )
);

DateInput.displayName = 'DateInput';
export default DateInput;
