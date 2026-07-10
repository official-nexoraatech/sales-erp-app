import type { ButtonHTMLAttributes } from 'react';
import { Loader2 } from 'lucide-react';

interface Props extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'success' | 'danger' | 'ghost' | 'outline';
  size?: 'sm' | 'md' | 'lg';
  loading?: boolean;
}

const BASE =
  'inline-flex items-center justify-center gap-2 font-semibold rounded-xl transition-colors ' +
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-1 focus-visible:ring-focus ' +
  'disabled:opacity-50 disabled:cursor-not-allowed';

const VARIANTS: Record<NonNullable<Props['variant']>, string> = {
  primary: 'bg-primary hover:bg-primary-hover text-primary-fg',
  secondary: 'bg-surface-raised hover:bg-surface-sunken text-primary',
  success: 'bg-success hover:bg-[var(--color-success-hover)] text-white',
  danger: 'bg-danger hover:bg-[var(--color-danger-hover)] text-white',
  ghost: 'text-secondary hover:bg-surface-raised',
  outline: 'border border-default text-primary hover:bg-surface-raised bg-transparent',
};

// Every size meets or exceeds --pos-touch-target (44px) except `sm`, reserved for
// dense inline controls (e.g. cart qty +/- buttons) that are still individually
// at least 36px and always paired with generous surrounding tap spacing.
const SIZES: Record<NonNullable<Props['size']>, string> = {
  sm: 'px-3 min-h-[36px] text-sm',
  md: 'px-4 min-h-[44px] text-sm',
  lg: 'px-6 min-h-[52px] text-base',
};

export default function POSButton({
  variant = 'primary',
  size = 'md',
  loading,
  children,
  className = '',
  disabled,
  ...rest
}: Props) {
  return (
    <button
      {...rest}
      disabled={disabled || loading}
      className={`${BASE} ${VARIANTS[variant]} ${SIZES[size]} ${className}`}
    >
      {loading && <Loader2 size={16} className="animate-spin shrink-0" />}
      {children}
    </button>
  );
}
