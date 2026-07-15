import { type LucideIcon, Package, SearchX, AlertCircle, ShieldOff } from 'lucide-react';
import Button from '../ui/Button.js';

type EmptyType = 'no-data' | 'no-results' | 'error' | 'no-access';

interface ERPEmptyStateAction {
  label: string;
  onClick: () => void;
  icon?: LucideIcon;
}

interface Props {
  type?: EmptyType;
  title?: string;
  description?: string;
  action?: ERPEmptyStateAction;
  icon?: LucideIcon;
}

const DEFAULTS: Record<EmptyType, { title: string; description: string; icon: LucideIcon }> = {
  'no-data': {
    title: 'No records yet',
    description: 'Get started by creating your first record.',
    icon: Package,
  },
  'no-results': {
    title: 'No results found',
    description: 'Try adjusting your search or filter criteria.',
    icon: SearchX,
  },
  error: {
    title: 'Something went wrong',
    description: 'An error occurred while loading this page. Please refresh and try again.',
    icon: AlertCircle,
  },
  'no-access': {
    title: 'Access denied',
    description: "You don't have permission to view this content.",
    icon: ShieldOff,
  },
};

export default function ERPEmptyState({
  type = 'no-data',
  title,
  description,
  action,
  icon,
}: Props) {
  const defaults = DEFAULTS[type];
  const Icon = icon ?? defaults.icon;
  const ActionIcon = action?.icon;

  return (
    <div className="flex flex-col items-center justify-center py-16 px-6 text-center">
      <div className="w-14 h-14 rounded-2xl bg-surface-raised flex items-center justify-center mb-4">
        <Icon size={28} className="text-disabled" />
      </div>
      <h2 className="text-base font-semibold text-primary mb-1">{title ?? defaults.title}</h2>
      <p className="text-sm text-secondary max-w-sm mb-6">{description ?? defaults.description}</p>
      {action && (
        <Button onClick={action.onClick} size="sm">
          {ActionIcon && <ActionIcon size={14} />}
          {action.label}
        </Button>
      )}
    </div>
  );
}
