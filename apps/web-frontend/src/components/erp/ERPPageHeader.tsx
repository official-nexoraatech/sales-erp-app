import { type ReactNode, type LegacyRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, MoreHorizontal, type LucideIcon } from 'lucide-react';
import Badge, { type BadgeVariant } from '../ui/Badge.js';
import ERPDropdownMenu, { type ERPMenuItem } from './ERPDropdownMenu.js';

// ── List Page Header ─────────────────────────────────────────────────────────
interface ListHeaderProps {
  variant: 'list';
  title: string;
  subtitle?: string;
  icon?: LucideIcon;
  actions?: ReactNode;
  children?: ReactNode;
}

// ── Detail / Form Page Header ────────────────────────────────────────────────
interface DetailHeaderProps {
  variant: 'detail';
  title: string;
  subtitle?: string;
  entityType?: string;
  entityNumber?: string;
  status?: string;
  statusVariant?: BadgeVariant;
  backTo: string;
  actions?: ReactNode;
  moreActions?: ERPMenuItem[];
  children?: ReactNode;
}

type Props = ListHeaderProps | DetailHeaderProps;

export default function ERPPageHeader(props: Props) {
  const navigate = useNavigate();

  if (props.variant === 'list') {
    const Icon = props.icon;
    const actionContent = props.actions ?? props.children;
    return (
      <div className="flex items-start justify-between mb-6">
        <div className="flex items-center gap-3">
          {Icon && (
            <div className="w-10 h-10 rounded-xl bg-primary-subtle flex items-center justify-center shrink-0">
              <Icon size={20} className="text-brand" />
            </div>
          )}
          <div>
            <h1 className="text-xl font-semibold text-primary">{props.title}</h1>
            {props.subtitle && <p className="text-sm text-secondary mt-0.5">{props.subtitle}</p>}
          </div>
        </div>
        {actionContent && (
          <div className="flex items-center gap-2 shrink-0">{actionContent}</div>
        )}
      </div>
    );
  }

  // Detail variant
  const actionContent = props.actions ?? props.children;
  return (
    <div className="flex items-start justify-between mb-6">
      <div className="flex items-start gap-3">
        <button
          onClick={() => navigate(props.backTo)}
          aria-label="Go back"
          className="mt-0.5 p-1.5 rounded-lg text-secondary hover:bg-surface-raised hover:text-primary transition-colors"
        >
          <ArrowLeft size={18} />
        </button>
        <div>
          {props.entityType && (
            <p className="text-xs font-semibold uppercase tracking-widest text-secondary mb-0.5">
              {props.entityType}
            </p>
          )}
          <div className="flex items-center gap-2 flex-wrap">
            <h1 className="text-xl font-semibold text-primary">{props.title}</h1>
            {props.entityNumber && (
              <span className="font-mono text-sm text-secondary">{props.entityNumber}</span>
            )}
            {props.status && (
              <Badge variant={props.statusVariant ?? 'default'}>{props.status}</Badge>
            )}
          </div>
          {props.subtitle && <p className="text-sm text-secondary mt-0.5">{props.subtitle}</p>}
        </div>
      </div>

      <div className="flex items-center gap-2 shrink-0">
        {actionContent}
        {props.moreActions && props.moreActions.length > 0 && (
          <ERPDropdownMenu
            items={props.moreActions}
            trigger={<MoreHorizontal size={16} />}
          />
        )}
      </div>
    </div>
  );
}
