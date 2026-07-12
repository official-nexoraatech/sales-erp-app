import type { ButtonHTMLAttributes } from 'react';
import { Loader2 } from 'lucide-react';
import { buttonVariants, cn } from '@erp/ui';

interface Props extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'success' | 'danger' | 'ghost' | 'outline';
  size?: 'sm' | 'md' | 'lg';
  loading?: boolean;
}

// Every size meets or exceeds --pos-touch-target (44px) except `sm`, reserved for
// dense inline controls (e.g. cart qty +/- buttons) that are still individually
// at least 36px and always paired with generous surrounding tap spacing. Kept as its
// own scale (distinct from @erp/ui Button's size prop) because cashier-screen touch
// targets are a POS-only constraint — colors, radius, and focus-glow still come from
// the shared buttonVariants recipe, so it's the same visual language, not a fork.
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
      className={cn(buttonVariants({ variant }), 'font-semibold gap-2', SIZES[size], className)}
    >
      {loading && <Loader2 size={16} className="animate-spin shrink-0" />}
      {children}
    </button>
  );
}
