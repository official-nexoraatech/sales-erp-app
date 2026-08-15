import type { InAppNotification } from '../api/endpoints.js';

/** Notification Center deep-link resolver — mirrors searchEntityConfig.ts's pattern exactly
 * (entityType -> route builder, list-page fallback for entities with no detail page yet,
 * `undefined` for entities with no page at all so the row renders informational/non-navigable
 * instead of linking somewhere broken). Keyed by the exact entityType strings the backend
 * producers emit: WorkflowEngine's SYSTEM_WORKFLOW_DEFINITIONS entityTypes (PascalCase, e.g.
 * 'PurchaseOrder', 'Leave') and the two direct producers (InvoiceNotificationService: 'Invoice',
 * lead.routes.ts's assign handler: 'Lead'). */
const NOTIFICATION_ENTITY_ROUTES: Record<string, (n: InAppNotification) => string | undefined> = {
  Invoice: (n) => (n.entityId ? `/sales/invoices/${n.entityId}` : undefined),
  PurchaseOrder: () => '/purchase/orders',
  GRN: () => '/purchase/grns',
  SaleReturn: () => '/sales/returns',
  SupplierPayment: () => '/purchase/payments',
  PurchaseReturn: () => '/purchase/returns',
  Leave: () => '/hr/leaves',
  Payroll: () => '/hr/payroll',
  FinancialYear: () => '/accounting/financial-years',
  Customer: (n) => (n.entityId ? `/customers/${n.entityId}` : undefined),
  Employee: (n) => (n.entityId ? `/hr/employees/${n.entityId}` : undefined),
  StockAdjustment: () => '/inventory/adjustments',
  StockTransfer: (n) => (n.entityId ? `/inventory/transfers/${n.entityId}` : undefined),
  Item: (n) => (n.entityId ? `/inventory/items/${n.entityId}/edit` : undefined),
  PriceList: () => '/inventory/price-lists',
  Lead: (n) => (n.entityId ? `/crm/leads/${n.entityId}` : undefined),
  // Expense, CreditNote, ImportJob: no dedicated page exists anywhere in the app yet — omitted
  // rather than guessed, so these render as informational/non-navigable (same convention as
  // searchEntityConfig.ts's entities with no `route`).
};

/** Returns the route a notification should navigate to when clicked, or undefined if it can't
 * be resolved (no entityType/entityId, or an entityType with no known destination) — the
 * caller should treat undefined as "informational row, do not navigate." */
export function resolveNotificationRoute(n: InAppNotification): string | undefined {
  if (!n.entityType) return undefined;
  const resolve = NOTIFICATION_ENTITY_ROUTES[n.entityType];
  if (!resolve) return undefined;
  return resolve(n) || undefined;
}

/** The actual click-navigation rule shared by NotificationsPanel and NotificationsPage:
 * APPROVAL notifications always go to My Approvals — resolveNotificationRoute only knows an
 * entity's detail/list page, not which item there is actually pending your decision. When the
 * notification's metadata carries the workflow instanceId (WorkflowEngine.notifyUser always
 * sets this for a "requires your approval" notification), it's passed as a query param so
 * MyApprovalsPage can auto-select and scroll to the exact item instead of the general list. */
export function getNotificationClickRoute(n: InAppNotification): string | undefined {
  if (n.businessCategory === 'APPROVAL') {
    const meta = n.metadata as { instanceId?: number } | null;
    return meta?.instanceId ? `/my-approvals?instanceId=${meta.instanceId}` : '/my-approvals';
  }
  return resolveNotificationRoute(n);
}
