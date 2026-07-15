import {
  forwardRef,
  useEffect,
  useId,
  useRef,
  useState,
  type ChangeEvent,
  type InputHTMLAttributes,
} from 'react';
import { cn } from './cn.js';
import Input from './Input.js';

export interface ColorPickerProps extends Omit<
  InputHTMLAttributes<HTMLInputElement>,
  'type' | 'size'
> {
  label?: string;
  hint?: string;
  error?: string;
}

/** Swatch (native color-well) + a synced hex text field — the native color-well alone
 * gives no way to read/type an exact hex value, which theme/branding forms need. */
const ColorPicker = forwardRef<HTMLInputElement, ColorPickerProps>(
  (
    {
      label,
      hint,
      error,
      disabled,
      required,
      id: externalId,
      onChange,
      onBlur,
      defaultValue,
      value,
      className = '',
      ...rest
    },
    ref
  ) => {
    const uid = useId();
    const inputId = externalId ?? uid;
    const innerRef = useRef<HTMLInputElement | null>(null);
    const initial =
      typeof value === 'string'
        ? value
        : typeof defaultValue === 'string'
          ? defaultValue
          : '#000000';
    const [hex, setHex] = useState(initial);

    // Only relevant when the caller passes a controlled `value` (register() doesn't — it's
    // uncontrolled, so this is a no-op for the common form-field usage).
    useEffect(() => {
      if (typeof value === 'string') setHex(value);
    }, [value]);

    function handleSwatchChange(e: ChangeEvent<HTMLInputElement>) {
      setHex(e.target.value);
      // Real event, real target (the actual registered <input>) — safe to hand straight to
      // react-hook-form's onChange from register().
      onChange?.(e);
    }

    function handleHexChange(e: ChangeEvent<HTMLInputElement>) {
      let v = e.target.value.trim();
      if (v && !v.startsWith('#')) v = `#${v}`;
      setHex(v);
      if (!/^#[0-9a-fA-F]{6}$/.test(v) || !innerRef.current) return;
      // This hex field is a second, unregistered <input> — typing here must still notify
      // react-hook-form. The previous version faked a ChangeEvent by spreading `e.target`,
      // but DOM element properties (name, value, type...) live on the prototype as
      // accessors, not as own enumerable properties, so `{ ...e.target }` silently produced
      // an object with no `name` at all. RHF's onChange reads `event.target.name` to know
      // which field changed, got `undefined`, and never marked the form dirty — so Save
      // stayed disabled no matter what color was picked. Instead, drive the *real*
      // registered color input directly (native setter, bypassing React's value-tracking
      // override) and dispatch a genuine 'input' event, so its own onChange fires with an
      // authentic event RHF can attribute correctly.
      const nativeSetter = Object.getOwnPropertyDescriptor(
        window.HTMLInputElement.prototype,
        'value'
      )?.set;
      nativeSetter?.call(innerRef.current, v);
      innerRef.current.dispatchEvent(new Event('input', { bubbles: true }));
    }

    return (
      <div className="flex flex-col gap-1.5">
        {label && (
          <label htmlFor={inputId} className="text-sm font-medium text-primary tracking-[-0.01em]">
            {label}
            {required && (
              <span className="text-danger ml-0.5" aria-hidden="true">
                *
              </span>
            )}
          </label>
        )}

        <div className="flex items-center gap-2">
          <input
            {...rest}
            ref={(node) => {
              innerRef.current = node;
              if (typeof ref === 'function') ref(node);
              else if (ref) ref.current = node;
            }}
            id={inputId}
            type="color"
            value={hex}
            disabled={disabled}
            onChange={handleSwatchChange}
            onBlur={onBlur}
            className={cn(
              'h-[var(--input-height-md)] w-12 shrink-0 cursor-pointer rounded-md border border-default bg-surface-card p-1',
              'transition-colors duration-150 ease-out hover:border-strong',
              'disabled:cursor-not-allowed disabled:opacity-50 disabled:bg-surface-subtle',
              className
            )}
          />
          <Input
            value={hex}
            onChange={handleHexChange}
            onBlur={onBlur}
            disabled={disabled}
            maxLength={7}
            wrapperClassName="flex-1"
            className="font-mono uppercase"
            placeholder="#000000"
            error={error}
          />
        </div>

        {!error && hint && <p className="text-xs text-secondary">{hint}</p>}
      </div>
    );
  }
);
ColorPicker.displayName = 'ColorPicker';
export default ColorPicker;
