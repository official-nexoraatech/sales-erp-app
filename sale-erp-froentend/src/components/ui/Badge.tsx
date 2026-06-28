import React from 'react';

type BadgeVariant = 'success' | 'danger' | 'warning' | 'info' | 'neutral' | 'pending' | 'draft' | 'processing';
type BadgeSize = 'xs' | 'sm' | 'md';

interface BadgeProps {
  children: React.ReactNode;
  variant?: BadgeVariant;
  size?: BadgeSize;
  dot?: boolean;
  className?: string;
}

const variantClass: Record<BadgeVariant, string> = {
  success:
    'bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-400 dark:ring-1 dark:ring-green-800/50',
  danger:
    'bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-400 dark:ring-1 dark:ring-red-800/50',
  warning:
    'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-400 dark:ring-1 dark:ring-amber-800/50',
  info:
    'bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-400 dark:ring-1 dark:ring-blue-800/50',
  neutral:
    'bg-slate-100 text-slate-700 dark:bg-slate-700/60 dark:text-slate-300 dark:ring-1 dark:ring-slate-600/50',
  pending:
    'bg-orange-100 text-orange-800 dark:bg-orange-900/40 dark:text-orange-400 dark:ring-1 dark:ring-orange-800/50',
  draft:
    'bg-indigo-100 text-indigo-800 dark:bg-indigo-900/40 dark:text-indigo-400 dark:ring-1 dark:ring-indigo-800/50',
  processing:
    'bg-cyan-100 text-cyan-800 dark:bg-cyan-900/40 dark:text-cyan-400 dark:ring-1 dark:ring-cyan-800/50',
};

const dotClass: Record<BadgeVariant, string> = {
  success: 'bg-green-500 dark:bg-green-400',
  danger: 'bg-red-500 dark:bg-red-400',
  warning: 'bg-amber-500 dark:bg-amber-400',
  info: 'bg-blue-500 dark:bg-blue-400',
  neutral: 'bg-slate-400 dark:bg-slate-400',
  pending: 'bg-orange-500 dark:bg-orange-400',
  draft: 'bg-indigo-500 dark:bg-indigo-400',
  processing: 'bg-cyan-500 dark:bg-cyan-400',
};

const sizeClass: Record<BadgeSize, string> = {
  xs: 'px-1.5 py-0.5 text-[10px] font-semibold',
  sm: 'px-2.5 py-0.5 text-xs font-semibold',
  md: 'px-3 py-1 text-sm font-medium',
};

export const Badge: React.FC<BadgeProps> = ({
  children,
  variant = 'neutral',
  size = 'sm',
  dot = false,
  className = '',
}) => (
  <span
    className={[
      'inline-flex items-center gap-1.5 rounded-full',
      variantClass[variant],
      sizeClass[size],
      className,
    ].join(' ')}
  >
    {dot && <span className={`inline-block h-1.5 w-1.5 rounded-full ${dotClass[variant]}`} aria-hidden="true" />}
    {children}
  </span>
);
