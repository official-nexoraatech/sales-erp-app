import React from 'react';

interface CardProps extends React.HTMLAttributes<HTMLDivElement> {
  children: React.ReactNode;
  noPadding?: boolean;
  variant?: 'default' | 'outlined' | 'elevated';
}

export const Card = React.forwardRef<HTMLDivElement, CardProps>(
  ({ children, className = '', noPadding = false, variant = 'default', ...props }, ref) => {
    const variantClass = {
      default:  'bg-white dark:bg-slate-800 shadow-sm dark:shadow-slate-900/50 border border-slate-200/60 dark:border-slate-700/60',
      outlined: 'bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700',
      elevated: 'bg-white dark:bg-slate-800 shadow-md dark:shadow-slate-900/60',
    }[variant];

    return (
      <div
        ref={ref}
        className={[
          'rounded-xl',
          variantClass,
          !noPadding ? 'p-5' : '',
          className,
        ]
          .filter(Boolean)
          .join(' ')}
        {...props}
      >
        {children}
      </div>
    );
  },
);

Card.displayName = 'Card';
