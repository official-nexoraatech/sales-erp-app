import React from 'react';
import { Package } from 'lucide-react';

interface EmptyStateProps {
  title: string;
  description?: string;
  action?: React.ReactNode;
  icon?: React.ReactNode;
  compact?: boolean;
}

export const EmptyState: React.FC<EmptyStateProps> = ({
  title,
  description,
  action,
  icon,
  compact = false,
}) => (
  <div
    className={[
      'flex flex-col items-center justify-center px-4 text-center',
      compact ? 'py-8' : 'py-14',
    ].join(' ')}
  >
    <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-xl bg-slate-100 text-slate-400 dark:bg-slate-800 dark:text-slate-500">
      {icon ?? <Package size={28} strokeWidth={1.5} />}
    </div>
    <h3 className="text-base font-semibold text-slate-800 dark:text-slate-200">{title}</h3>
    {description && (
      <p className="mt-1.5 max-w-sm text-sm text-slate-500 dark:text-slate-400">
        {description}
      </p>
    )}
    {action && <div className="mt-5">{action}</div>}
  </div>
);
