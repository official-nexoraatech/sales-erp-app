import { forwardRef } from 'react';
import { Clock } from 'lucide-react';
import Input, { type InputProps } from './Input.js';

export type TimeInputProps = Omit<InputProps, 'leftIcon' | 'type'>;

/** A styled native <input type="time"> — same rationale as DateInput. */
const TimeInput = forwardRef<HTMLInputElement, TimeInputProps>(
  ({ className = '', ...rest }, ref) => (
    <Input {...rest} ref={ref} type="time" leftIcon={<Clock size={16} />} className={className} />
  )
);

TimeInput.displayName = 'TimeInput';
export default TimeInput;
