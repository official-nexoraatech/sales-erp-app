import { useState, forwardRef, type ComponentPropsWithoutRef } from 'react';
import { Eye, EyeOff } from 'lucide-react';
import Input from './Input.js';

type Props = Omit<ComponentPropsWithoutRef<typeof Input>, 'type' | 'rightElement'>;

const PasswordInput = forwardRef<HTMLInputElement, Props>((props, ref) => {
  const [visible, setVisible] = useState(false);
  return (
    <Input
      {...props}
      ref={ref}
      type={visible ? 'text' : 'password'}
      rightElement={
        <button
          type="button"
          onClick={() => setVisible((v) => !v)}
          aria-label={visible ? 'Hide password' : 'Show password'}
          aria-pressed={visible}
          className="text-secondary hover:text-primary p-1 rounded focus:outline-none focus-visible:ring-2 focus-visible:ring-border-focus"
        >
          {visible ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
        </button>
      }
    />
  );
});

PasswordInput.displayName = 'PasswordInput';
export default PasswordInput;
