import { ButtonHTMLAttributes } from 'react';
import { Loader2 } from 'lucide-react';

interface Props extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'danger' | 'ghost' | 'outline' | 'danger-outline' | 'link';
  size?: 'xs' | 'sm' | 'md' | 'lg';
  loading?: boolean;
  /** @deprecated use loading */
  isLoading?: boolean;
}

const BASE =
  'inline-flex items-center justify-center gap-1.5 font-medium rounded-lg transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-1 disabled:opacity-50 disabled:cursor-not-allowed';

const VARIANTS: Record<NonNullable<Props['variant']>, string> = {
  primary:
    'bg-primary hover:bg-primary-hover text-primary-fg focus-visible:ring-brand',
  secondary:
    'bg-surface-card border border-default text-primary hover:bg-surface-raised focus-visible:ring-border-focus',
  danger:
    'bg-red-600 hover:bg-red-700 text-white focus-visible:ring-red-500',
  ghost:
    'text-secondary hover:bg-surface-raised focus-visible:ring-border-focus',
  outline:
    'border border-default text-primary hover:bg-surface-raised focus-visible:ring-border-focus',
  'danger-outline':
    'border border-danger text-danger hover:bg-danger-bg focus-visible:ring-red-500',
  link:
    'text-brand hover:underline p-0 focus-visible:ring-border-focus',
};

const SIZES: Record<NonNullable<Props['size']>, string> = {
  xs: 'px-2 py-1 text-xs',
  sm: 'px-2.5 py-1.5 text-xs',
  md: 'px-4 py-2 text-sm',
  lg: 'px-5 py-2.5 text-sm',
};

export default function Button({
  variant = 'primary',
  size = 'md',
  loading,
  isLoading,
  children,
  className = '',
  disabled,
  ...rest
}: Props) {
  const busy = loading ?? isLoading;
  return (
    <button
      {...rest}
      disabled={disabled || busy}
      className={`${BASE} ${VARIANTS[variant]} ${SIZES[size]} ${className}`}
    >
      {busy && <Loader2 size={13} className="animate-spin shrink-0" />}
      {children}
    </button>
  );
}
