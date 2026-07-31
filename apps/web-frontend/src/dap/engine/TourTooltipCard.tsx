import {
  X,
  LayoutDashboard,
  Users,
  Receipt,
  Megaphone,
  Package,
  ShoppingBag,
  FileText,
  Calculator,
  BarChart3,
  Settings,
  Factory,
  ShieldCheck,
  Truck,
  Workflow,
  UserCircle2,
  Clock,
  type LucideIcon,
} from 'lucide-react';
import { Kbd } from '@erp/ui';
import Button from '../../components/ui/Button.js';
import { useFocusTrap } from '../../hooks/useFocusTrap.js';
import { useFloatingTourPosition } from './useFloatingTourPosition.js';
import type { TourDefinition, TourStep } from '../content/schema.js';

// Keyed by the same `module` string every *.tour.ts file already sets — no schema/content
// change needed to give each tour a recognizable module icon in the popup header.
const MODULE_ICONS: Record<string, LucideIcon> = {
  dashboard: LayoutDashboard,
  customers: UserCircle2,
  sales: Receipt,
  crm: Megaphone,
  inventory: Package,
  purchase: ShoppingBag,
  gst: FileText,
  accounting: Calculator,
  hr: Users,
  reports: BarChart3,
  settings: Settings,
  production: Factory,
  admin: ShieldCheck,
  suppliers: Truck,
  users: Users,
  'cross-module': Workflow,
};

interface Props {
  tour: TourDefinition;
  step: TourStep;
  stepNumber: number;
  totalSteps: number;
  targetRect: DOMRect | null;
  actionSatisfied: boolean;
  isFirst: boolean;
  isLast: boolean;
  onNext: () => void;
  onPrev: () => void;
  onSkip: () => void;
}

export function TourTooltipCard({
  tour,
  step,
  stepNumber,
  totalSteps,
  targetRect,
  actionSatisfied,
  isFirst,
  isLast,
  onNext,
  onPrev,
  onSkip,
}: Props) {
  const { cardRef, arrowRef, style, arrow } = useFloatingTourPosition(targetRect, step.placement);
  useFocusTrap(cardRef, true);

  const ModuleIcon = MODULE_ICONS[tour.module] ?? Workflow;
  const progressPct = (stepNumber / totalSteps) * 100;
  const remainingMinutes = Math.max(
    1,
    Math.round((tour.estimatedMinutes * (totalSteps - stepNumber + 1)) / totalSteps)
  );

  return (
    <div
      ref={cardRef}
      role="dialog"
      aria-modal="true"
      aria-labelledby="dap-tour-title"
      aria-describedby="dap-tour-body"
      className="w-[26rem] max-w-[calc(100vw-16px)] bg-surface-card rounded-2xl shadow-token-modal border border-default pointer-events-auto transition-transform overflow-hidden"
      style={{ ...style, zIndex: 'var(--z-tour)', transitionDuration: 'var(--duration-normal)' }}
    >
      {arrow && (
        <div
          ref={arrowRef}
          aria-hidden="true"
          className="absolute w-2 h-2 rotate-45 bg-surface-card border-default"
          style={{
            ...arrow.style,
            borderTop: arrow.side === 'bottom' ? '1px solid' : undefined,
            borderLeft: arrow.side === 'bottom' || arrow.side === 'right' ? '1px solid' : undefined,
            borderBottom: arrow.side === 'top' ? '1px solid' : undefined,
            borderRight: arrow.side === 'top' || arrow.side === 'left' ? '1px solid' : undefined,
            borderColor: 'var(--border-default)',
          }}
        />
      )}

      {/* Announces step changes to screen readers — moving focus on every Next/Back would be
          disorienting mid-tour, so this is the accessible signal instead. */}
      <p aria-live="polite" className="sr-only">
        Step {stepNumber} of {totalSteps}: {step.title}
      </p>

      {/* Progress bar — thin, full-width, sits above the header row like most enterprise DAP
          popups (Pendo/Appcues) rather than a thicker bar competing with the title for attention. */}
      <div className="h-1 bg-surface-page" aria-hidden="true">
        <div
          className="h-full bg-brand transition-[width]"
          style={{ width: `${progressPct}%`, transitionDuration: 'var(--duration-normal)' }}
        />
      </div>

      <div className="p-6">
        <div className="flex items-start justify-between gap-3 mb-3">
          <div className="flex items-center gap-2.5">
            <span className="flex items-center justify-center w-8 h-8 rounded-lg bg-primary-subtle text-brand shrink-0">
              <ModuleIcon size={16} />
            </span>
            <div>
              <p className="text-xs font-medium text-secondary uppercase tracking-wide">
                Step {stepNumber} of {totalSteps}
              </p>
              <p className="flex items-center gap-1 text-[11px] text-disabled">
                <Clock size={11} />~{remainingMinutes} min left
              </p>
            </div>
          </div>
          <button
            onClick={onSkip}
            aria-label="Skip tour"
            className="text-secondary hover:text-primary transition-colors -m-1 p-1 rounded-md hover:bg-surface-raised"
          >
            <X size={16} />
          </button>
        </div>

        <h2 id="dap-tour-title" className="text-base font-semibold text-primary mb-2">
          {step.title}
        </h2>
        <p id="dap-tour-body" className="text-sm text-secondary leading-relaxed mb-3">
          {step.body}
        </p>

        {step.businessImpact && step.businessImpact.length > 0 && (
          <div
            className={`rounded-lg p-3 mb-4 ${
              step.calloutVariant === 'warning'
                ? 'bg-warning-bg'
                : step.calloutVariant === 'success'
                  ? 'bg-success-bg'
                  : 'bg-info-bg'
            }`}
          >
            <p
              className={`text-xs font-medium mb-1.5 ${
                step.calloutVariant === 'warning'
                  ? 'text-warning'
                  : step.calloutVariant === 'success'
                    ? 'text-success'
                    : 'text-info'
              }`}
            >
              {step.calloutTitle ?? 'Business impact'}
            </p>
            <ul className="text-xs text-secondary space-y-1 list-disc list-inside">
              {step.businessImpact.map((impact) => (
                <li key={impact}>{impact}</li>
              ))}
            </ul>
          </div>
        )}

        {step.mode === 'interactive' && !actionSatisfied && (
          <p className="text-xs text-warning mb-3">Complete the action above to continue.</p>
        )}

        <div className="flex items-center justify-between gap-2 mb-2">
          <button
            onClick={onSkip}
            className="text-sm text-secondary hover:text-primary transition-colors"
          >
            Skip tour
          </button>
          <div className="flex items-center gap-2">
            {!isFirst && (
              <Button variant="secondary" size="sm" onClick={onPrev}>
                Back
              </Button>
            )}
            <Button
              size="sm"
              onClick={onNext}
              disabled={step.mode === 'interactive' && !actionSatisfied}
            >
              {isLast ? 'Finish' : 'Next'}
            </Button>
          </div>
        </div>

        <div className="flex items-center justify-end gap-3 text-[11px] text-disabled">
          <span className="flex items-center gap-1">
            <Kbd>←</Kbd> <Kbd>→</Kbd> navigate
          </span>
          <span className="flex items-center gap-1">
            <Kbd>Esc</Kbd> skip
          </span>
        </div>
      </div>
    </div>
  );
}
