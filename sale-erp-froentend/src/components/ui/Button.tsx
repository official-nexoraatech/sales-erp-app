import React from 'react';

type ButtonVariant = 'primary' | 'secondary' | 'danger' | 'outline' | 'ghost' | 'success' | 'warning' | 'link';
type ButtonSize = 'xs' | 'sm' | 'md' | 'lg';

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  isLoading?: boolean;
  fullWidth?: boolean;
  leftIcon?: React.ReactNode;
  rightIcon?: React.ReactNode;
}

const baseStyles =
  'inline-flex items-center justify-center gap-2 font-semibold rounded-lg transition-all duration-200 ' +
  'disabled:opacity-50 disabled:cursor-not-allowed disabled:pointer-events-none ' +
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 ' +
  'dark:focus-visible:ring-offset-slate-900 select-none';

const variantStyles: Record<ButtonVariant, string> = {
  primary:
    'bg-blue-600 text-white hover:bg-blue-700 active:bg-blue-800 focus-visible:ring-blue-500 ' +
    'dark:bg-blue-500 dark:hover:bg-blue-400 dark:active:bg-blue-300 dark:focus-visible:ring-blue-400 ' +
    'shadow-sm hover:shadow',
  secondary:
    'bg-slate-100 text-slate-700 hover:bg-slate-200 active:bg-slate-300 focus-visible:ring-slate-400 ' +
    'dark:bg-slate-700 dark:text-slate-200 dark:hover:bg-slate-600 dark:active:bg-slate-500 ' +
    'dark:focus-visible:ring-slate-500 border border-slate-200 dark:border-slate-600',
  danger:
    'bg-red-600 text-white hover:bg-red-700 active:bg-red-800 focus-visible:ring-red-500 ' +
    'dark:bg-red-700 dark:hover:bg-red-600 dark:active:bg-red-500 dark:focus-visible:ring-red-400 ' +
    'shadow-sm hover:shadow',
  outline:
    'border-2 border-blue-600 text-blue-600 hover:bg-blue-50 active:bg-blue-100 focus-visible:ring-blue-500 ' +
    'dark:border-blue-400 dark:text-blue-400 dark:hover:bg-blue-950 dark:active:bg-blue-900 ' +
    'dark:focus-visible:ring-blue-400',
  ghost:
    'text-slate-600 hover:bg-slate-100 active:bg-slate-200 focus-visible:ring-slate-400 ' +
    'dark:text-slate-300 dark:hover:bg-slate-800 dark:active:bg-slate-700 dark:focus-visible:ring-slate-500',
  success:
    'bg-green-600 text-white hover:bg-green-700 active:bg-green-800 focus-visible:ring-green-500 ' +
    'dark:bg-green-700 dark:hover:bg-green-600 dark:active:bg-green-500 dark:focus-visible:ring-green-400 ' +
    'shadow-sm hover:shadow',
  warning:
    'bg-amber-500 text-white hover:bg-amber-600 active:bg-amber-700 focus-visible:ring-amber-400 ' +
    'dark:bg-amber-600 dark:hover:bg-amber-500 dark:active:bg-amber-400 dark:focus-visible:ring-amber-300 ' +
    'shadow-sm hover:shadow',
  link:
    'text-blue-600 underline-offset-4 hover:underline focus-visible:ring-blue-500 ' +
    'dark:text-blue-400 dark:focus-visible:ring-blue-400 p-0 h-auto',
};

const sizeStyles: Record<ButtonSize, string> = {
  xs: 'h-7 px-2.5 text-xs',
  sm: 'h-8 px-3 text-sm',
  md: 'h-10 px-4 text-sm',
  lg: 'h-11 px-6 text-base',
};

const Spinner: React.FC<{ size: ButtonSize }> = ({ size }) => {
  const spinnerSize = { xs: 'h-3 w-3', sm: 'h-3.5 w-3.5', md: 'h-4 w-4', lg: 'h-5 w-5' }[size];
  return (
    <svg
      className={`${spinnerSize} animate-spin`}
      xmlns="http://www.w3.org/2000/svg"
      fill="none"
      viewBox="0 0 24 24"
      aria-hidden="true"
    >
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
    </svg>
  );
};

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  (
    {
      variant = 'primary',
      size = 'md',
      isLoading = false,
      fullWidth = false,
      leftIcon,
      rightIcon,
      disabled,
      className = '',
      children,
      ...props
    },
    ref,
  ) => (
    <button
      ref={ref}
      disabled={disabled || isLoading}
      className={[
        baseStyles,
        variantStyles[variant],
        variant !== 'link' ? sizeStyles[size] : '',
        fullWidth ? 'w-full' : '',
        className,
      ]
        .filter(Boolean)
        .join(' ')}
      {...props}
    >
      {isLoading ? <Spinner size={size} /> : leftIcon}
      {children}
      {!isLoading && rightIcon}
    </button>
  ),
);

Button.displayName = 'Button';
