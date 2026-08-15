import type { InAppNotification } from '../../api/endpoints.js';

const CATEGORY_LABELS: Record<string, string> = {
  APPROVAL: 'Approval',
  SALES: 'Sales',
  CRM: 'CRM',
  INVENTORY: 'Inventory',
  FINANCE: 'Finance',
  WORKFLOW: 'Workflow',
  SYSTEM: 'System',
};

/** Notification Center audit finding: priority/businessCategory were written on every row but
 * never rendered anywhere, so a CRITICAL notification looked identical to a routine one. Only
 * HIGH/CRITICAL render a pill — NORMAL/LOW stay unmarked so the panel doesn't turn into visual
 * noise (brief's own "avoid excessive use of bright colors"). Text label, not color alone. */
export function PriorityPill({ priority }: { priority: InAppNotification['priority'] }) {
  if (priority !== 'HIGH' && priority !== 'CRITICAL') return null;
  const isCritical = priority === 'CRITICAL';
  return (
    <span
      className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-semibold uppercase tracking-wide shrink-0 ${
        isCritical ? 'bg-danger-bg text-danger' : 'bg-warning-bg text-warning'
      }`}
    >
      {isCritical ? 'Critical' : 'High'}
    </span>
  );
}

export function categoryLabel(category: InAppNotification['businessCategory']): string | null {
  return category ? (CATEGORY_LABELS[category] ?? null) : null;
}
