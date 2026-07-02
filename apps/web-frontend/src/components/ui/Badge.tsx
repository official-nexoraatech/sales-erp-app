import type { ReactNode } from 'react';

export type BadgeVariant = 'default' | 'success' | 'danger' | 'warning' | 'info' | 'outline';

interface Props {
  children?: ReactNode;
  variant?: BadgeVariant;
  /** Shows a small colored dot before the label */
  dot?: boolean;
  /** @deprecated use variant + children */
  label?: string;
  /** @deprecated use variant */
  color?: 'green' | 'red' | 'yellow' | 'blue' | 'gray' | 'indigo';
}

const VARIANT_CLASSES: Record<BadgeVariant, string> = {
  default: 'bg-surface-raised text-secondary',
  success: 'bg-success-bg text-success-fg',
  danger:  'bg-danger-bg text-danger-fg',
  warning: 'bg-warning-bg text-warning-fg',
  info:    'bg-info-bg text-info-fg',
  outline: 'border border-default text-secondary bg-transparent',
};

const DOT_CLASSES: Record<BadgeVariant, string> = {
  default: 'bg-secondary',
  success: 'bg-success',
  danger:  'bg-danger',
  warning: 'bg-warning',
  info:    'bg-info',
  outline: 'bg-secondary',
};

const COLOR_TO_VARIANT: Record<string, BadgeVariant> = {
  green: 'success',
  red: 'danger',
  yellow: 'warning',
  blue: 'info',
  gray: 'default',
  indigo: 'default',
};

export default function Badge({ children, label, variant, color, dot }: Props) {
  const resolvedVariant: BadgeVariant =
    variant ?? (color ? (COLOR_TO_VARIANT[color] ?? 'default') : 'default');
  const content = children ?? label;

  return (
    <span
      className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-medium ${VARIANT_CLASSES[resolvedVariant]}`}
    >
      {dot && (
        <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${DOT_CLASSES[resolvedVariant]}`} />
      )}
      {content}
    </span>
  );
}
