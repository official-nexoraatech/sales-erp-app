import { useId } from 'react';
import { cn } from './cn.js';

export interface SwitchProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label?: string;
  description?: string;
  disabled?: boolean;
  size?: 'sm' | 'md';
  id?: string;
}

export default function Switch({
  checked,
  onChange,
  label,
  description,
  disabled = false,
  size = 'md',
  id: externalId,
}: SwitchProps) {
  const generatedId = useId();
  const id = externalId ?? generatedId;
  const descId = description ? `${id}-desc` : undefined;

  const trackSize = size === 'sm' ? 'w-8 h-4' : 'w-10 h-5';
  const thumbSize = size === 'sm' ? 'w-3 h-3' : 'w-4 h-4';
  const thumbTranslate = size === 'sm' ? 'translate-x-4' : 'translate-x-5';

  return (
    <label
      htmlFor={id}
      className={cn(
        'inline-flex items-start gap-3',
        disabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'
      )}
    >
      <div className="relative mt-0.5 shrink-0">
        <input
          type="checkbox"
          role="switch"
          id={id}
          checked={checked}
          disabled={disabled}
          aria-checked={checked}
          aria-describedby={descId}
          onChange={(e) => onChange(e.target.checked)}
          className="peer sr-only"
        />
        <div
          className={cn(
            trackSize,
            'rounded-full transition-colors duration-150 ease-out peer-focus-visible:shadow-[var(--shadow-focus)]',
            checked ? 'bg-brand' : 'bg-surface-raised border border-default'
          )}
        />
        <div
          className={cn(
            'absolute left-0.5 top-0.5 rounded-full bg-white shadow-token-xs transition-transform duration-150 ease-out',
            thumbSize,
            checked ? thumbTranslate : 'translate-x-0'
          )}
        />
      </div>
      {(label || description) && (
        <div>
          {label && <p className="text-sm font-medium leading-tight text-primary">{label}</p>}
          {description && (
            <p id={descId} className="mt-0.5 text-xs text-secondary">
              {description}
            </p>
          )}
        </div>
      )}
    </label>
  );
}
