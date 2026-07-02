import { type ReactNode, useId } from 'react';

interface Props {
  label: string;
  htmlFor?: string;
  error?: string;
  hint?: string;
  required?: boolean;
  className?: string;
  children: ReactNode | ((id: string) => ReactNode);
}

export default function ERPFormField({
  label,
  htmlFor,
  error,
  hint,
  required,
  className = '',
  children,
}: Props) {
  const generatedId = useId();
  const id = htmlFor ?? generatedId;
  const hintId = `${id}-hint`;
  const errorId = `${id}-error`;

  return (
    <div className={`flex flex-col gap-1.5 ${className}`}>
      <label htmlFor={id} className="text-sm font-medium text-primary">
        {label}
        {required && <span className="text-danger ml-0.5" aria-hidden="true">*</span>}
      </label>

      {typeof children === 'function' ? children(id) : children}

      {hint && !error && (
        <p id={hintId} className="text-xs text-secondary">{hint}</p>
      )}
      {error && (
        <p id={errorId} role="alert" className="text-xs text-danger">{error}</p>
      )}
    </div>
  );
}
