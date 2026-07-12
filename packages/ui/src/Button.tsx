import { forwardRef, type ButtonHTMLAttributes } from 'react';
import { Loader2 } from 'lucide-react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from './cn.js';

export const buttonVariants = cva(
  [
    'inline-flex items-center justify-center gap-1.5 font-medium rounded-xl',
    'transition-[color,background-color,border-color,box-shadow,transform] duration-150 ease-out',
    'active:scale-[0.98]',
    'focus-visible:outline-none focus-visible:shadow-[var(--shadow-focus)]',
    'disabled:opacity-50 disabled:cursor-not-allowed disabled:active:scale-100',
  ],
  {
    variants: {
      variant: {
        primary: 'bg-primary hover:bg-primary-hover text-primary-fg shadow-token-xs',
        secondary:
          'bg-surface-card border border-default text-primary hover:bg-surface-raised hover:border-strong',
        danger:
          'bg-[var(--color-danger)] hover:bg-[var(--color-danger-hover)] text-white shadow-token-xs',
        success:
          'bg-[var(--color-success)] hover:bg-[var(--color-success-hover)] text-white shadow-token-xs',
        ghost: 'text-secondary hover:bg-surface-subtle hover:text-primary',
        outline: 'border border-default text-primary hover:bg-surface-subtle hover:border-strong',
        'danger-outline': 'border border-danger text-danger hover:bg-danger-bg',
        link: 'text-brand hover:underline p-0 h-auto rounded-none',
      },
      size: {
        xs: 'h-7 px-2.5 text-xs',
        sm: 'h-8 px-3 text-xs',
        md: 'h-[var(--input-height-md)] px-4 text-sm',
        lg: 'h-[var(--input-height-lg)] px-5 text-sm',
      },
    },
    compoundVariants: [
      { variant: 'link', size: ['xs', 'sm', 'md', 'lg'], class: 'h-auto px-0 py-0' },
    ],
    defaultVariants: { variant: 'primary', size: 'md' },
  }
);

export interface ButtonProps
  extends ButtonHTMLAttributes<HTMLButtonElement>, VariantProps<typeof buttonVariants> {
  loading?: boolean;
  /** @deprecated use loading */
  isLoading?: boolean;
}

const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ variant, size, loading, isLoading, children, className = '', disabled, ...rest }, ref) => {
    const busy = loading ?? isLoading;
    return (
      <button
        {...rest}
        ref={ref}
        disabled={disabled || busy}
        className={cn(buttonVariants({ variant, size }), className)}
      >
        {busy && <Loader2 size={13} className="animate-spin shrink-0" aria-hidden="true" />}
        {children}
      </button>
    );
  }
);

Button.displayName = 'Button';
export default Button;
