import type { ReactNode } from 'react';

export type POSBadgeVariant = 'default' | 'success' | 'danger' | 'warning' | 'info' | 'outline';

interface Props {
  children?: ReactNode;
  variant?: POSBadgeVariant;
  /** Shows a small colored dot before the label */
  dot?: boolean;
}

const VARIANT_CLASSES: Record<POSBadgeVariant, string> = {
  default: 'bg-surface-raised text-secondary',
  success: 'bg-success-bg text-success-fg',
  danger: 'bg-danger-bg text-danger-fg',
  warning: 'bg-warning-bg text-warning-fg',
  info: 'bg-info-bg text-info-fg',
  outline: 'border border-default text-secondary bg-transparent',
};

const DOT_CLASSES: Record<POSBadgeVariant, string> = {
  default: 'bg-secondary',
  success: 'bg-success',
  danger: 'bg-danger',
  warning: 'bg-warning',
  info: 'bg-info',
  outline: 'bg-secondary',
};

export default function POSBadge({ children, variant = 'default', dot }: Props) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-medium ${VARIANT_CLASSES[variant]}`}
    >
      {dot && <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${DOT_CLASSES[variant]}`} />}
      {children}
    </span>
  );
}
