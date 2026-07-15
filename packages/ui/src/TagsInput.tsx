import { useId, useState, type KeyboardEvent } from 'react';
import { X } from 'lucide-react';
import { cn } from './cn.js';

export interface TagsInputProps {
  value: string[];
  onChange: (tags: string[]) => void;
  label?: string;
  placeholder?: string;
  error?: string;
  hint?: string;
  disabled?: boolean;
  required?: boolean;
  maxTags?: number;
  /** Return an error message to reject a tag (e.g. duplicate/invalid format); return
   * nothing/undefined to accept it. */
  validate?: (tag: string) => string | undefined;
  wrapperClassName?: string;
}

/** Chip-based multi-value text entry — Enter or comma commits the current text as a tag,
 * Backspace on an empty field removes the last tag. */
export default function TagsInput({
  value,
  onChange,
  label,
  placeholder = 'Type and press Enter…',
  error,
  hint,
  disabled,
  required,
  maxTags,
  validate,
  wrapperClassName = '',
}: TagsInputProps) {
  const uid = useId();
  const errId = `${uid}-error`;
  const hintId = `${uid}-hint`;
  const [draft, setDraft] = useState('');
  const [localError, setLocalError] = useState<string | undefined>(undefined);

  const atLimit = typeof maxTags === 'number' && value.length >= maxTags;

  function commit(raw: string) {
    const tag = raw.trim();
    if (!tag) return;
    if (value.some((t) => t.toLowerCase() === tag.toLowerCase())) {
      setLocalError('Already added');
      return;
    }
    if (atLimit) {
      setLocalError(`Maximum ${maxTags} tags`);
      return;
    }
    const validationError = validate?.(tag);
    if (validationError) {
      setLocalError(validationError);
      return;
    }
    onChange([...value, tag]);
    setDraft('');
    setLocalError(undefined);
  }

  function handleKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault();
      commit(draft);
    } else if (e.key === 'Backspace' && draft === '' && value.length > 0) {
      onChange(value.slice(0, -1));
    }
  }

  function removeTag(index: number) {
    onChange(value.filter((_, i) => i !== index));
  }

  const message = error ?? localError ?? hint;
  const isErrorMessage = Boolean(error ?? localError);

  return (
    <div className={cn('flex flex-col gap-1.5', wrapperClassName)}>
      {label && (
        <label className="text-sm font-medium text-primary tracking-[-0.01em]">
          {label}
          {required && (
            <span className="text-danger ml-0.5" aria-hidden="true">
              *
            </span>
          )}
        </label>
      )}

      <div
        className={cn(
          'flex flex-wrap items-center gap-1.5 rounded-md border bg-surface-card p-1.5 min-h-[var(--input-height-md)]',
          'transition-[border-color,box-shadow] duration-150 ease-out',
          isErrorMessage
            ? 'border-error focus-within:shadow-[var(--shadow-focus-error)]'
            : 'border-default hover:border-strong focus-within:border-focus focus-within:shadow-[var(--shadow-focus)]',
          disabled && 'cursor-not-allowed opacity-50 bg-surface-subtle'
        )}
      >
        {value.map((tag, i) => (
          <span
            key={tag}
            className="inline-flex items-center gap-1 rounded-full bg-primary-subtle px-2.5 py-1 text-sm font-medium text-brand"
          >
            {tag}
            {!disabled && (
              <button
                type="button"
                onClick={() => removeTag(i)}
                aria-label={`Remove ${tag}`}
                className="rounded-full p-0.5 transition-colors hover:bg-surface-card/60"
              >
                <X size={12} />
              </button>
            )}
          </span>
        ))}
        <input
          type="text"
          value={draft}
          disabled={disabled || atLimit}
          placeholder={value.length === 0 ? placeholder : ''}
          aria-invalid={isErrorMessage}
          aria-describedby={message ? (isErrorMessage ? errId : hintId) : undefined}
          onChange={(e) => {
            setDraft(e.target.value);
            setLocalError(undefined);
          }}
          onKeyDown={handleKeyDown}
          onBlur={() => commit(draft)}
          className="flex-1 min-w-[8ch] bg-transparent px-1.5 py-1 text-sm text-primary placeholder:text-placeholder outline-none disabled:cursor-not-allowed"
        />
      </div>

      {message && (
        <p
          id={isErrorMessage ? errId : hintId}
          role={isErrorMessage ? 'alert' : undefined}
          className={cn('text-xs', isErrorMessage ? 'text-danger' : 'text-secondary')}
        >
          {message}
        </p>
      )}
    </div>
  );
}
