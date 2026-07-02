import { useId } from 'react';

interface Props {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label?: string;
  description?: string;
  disabled?: boolean;
  size?: 'sm' | 'md';
  id?: string;
}

export default function ERPSwitch({
  checked,
  onChange,
  label,
  description,
  disabled = false,
  size = 'md',
  id: externalId,
}: Props) {
  const generatedId = useId();
  const id = externalId ?? generatedId;
  const descId = description ? `${id}-desc` : undefined;

  const trackSize = size === 'sm' ? 'w-8 h-4' : 'w-10 h-5';
  const thumbSize = size === 'sm' ? 'w-3 h-3' : 'w-4 h-4';
  const thumbTranslate = size === 'sm' ? 'translate-x-4' : 'translate-x-5';

  return (
    <label
      htmlFor={id}
      className={`inline-flex items-start gap-3 ${disabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}`}
    >
      <div className="relative shrink-0 mt-0.5">
        <input
          type="checkbox"
          role="switch"
          id={id}
          checked={checked}
          disabled={disabled}
          aria-checked={checked}
          aria-describedby={descId}
          onChange={(e) => onChange(e.target.checked)}
          className="sr-only"
        />
        <div
          className={`${trackSize} rounded-full transition-colors ${
            checked ? 'bg-brand' : 'bg-surface-raised border border-default'
          }`}
        />
        <div
          className={`absolute top-0.5 left-0.5 ${thumbSize} rounded-full bg-white shadow transition-transform ${
            checked ? thumbTranslate : 'translate-x-0'
          }`}
        />
      </div>
      {(label || description) && (
        <div>
          {label && <p className="text-sm font-medium text-primary leading-tight">{label}</p>}
          {description && (
            <p id={descId} className="text-xs text-secondary mt-0.5">{description}</p>
          )}
        </div>
      )}
    </label>
  );
}
