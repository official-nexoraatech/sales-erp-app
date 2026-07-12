import { forwardRef, useState } from 'react';
import { Eye, EyeOff } from 'lucide-react';
import Input, { type InputProps } from './Input.js';

export type PasswordInputProps = Omit<InputProps, 'type' | 'rightIcon'>;

const PasswordInput = forwardRef<HTMLInputElement, PasswordInputProps>((props, ref) => {
  const [visible, setVisible] = useState(false);
  return (
    <Input
      {...props}
      ref={ref}
      type={visible ? 'text' : 'password'}
      rightIcon={
        <button
          type="button"
          onClick={() => setVisible((v) => !v)}
          aria-label={visible ? 'Hide password' : 'Show password'}
          aria-pressed={visible}
          className="rounded-md p-0.5 text-secondary transition-colors hover:bg-surface-subtle hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/30"
        >
          {visible ? <EyeOff size={16} /> : <Eye size={16} />}
        </button>
      }
    />
  );
});

PasswordInput.displayName = 'PasswordInput';
export default PasswordInput;
