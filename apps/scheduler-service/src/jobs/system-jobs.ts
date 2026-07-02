import type { JobRegistry } from '../JobRegistry.js';
import { createLogger } from '@erp/logger';

const logger = createLogger({ serviceName: 'scheduler-service' });

// All 30+ system jobs per ERP_MASTER_SPEC roadmap
export function registerSystemJobs(registry: JobRegistry): void {
  // ── ACCOUNTING ─────────────────────────────────────────────────────────────
  registry.register(
    'accounting.trial-balance.snapshot',
    { cron: '0 1 * * *', description: 'Snapshot trial balance daily at 1 AM', tenantScoped: true },
    async (_job, tenantId) => { logger.info({ tenantId }, 'Running trial balance snapshot'); }
  );

  registry.register(
    'accounting.outstanding-report',
    { cron: '0 2 * * *', description: 'Generate outstanding receivables/payables report', tenantScoped: true },
    async (_job, tenantId) => { logger.info({ tenantId }, 'Running outstanding report'); }
  );

  registry.register(
    'accounting.bank-reconciliation-reminder',
    { cron: '0 9 * * 1', description: 'Weekly reminder to reconcile bank statements', tenantScoped: true },
    async (_job, tenantId) => { logger.info({ tenantId }, 'Sending bank reconciliation reminder'); }
  );

  // ── INVENTORY ─────────────────────────────────────────────────────────────
  registry.register(
    'inventory.low-stock-alert',
    { cron: '0 8 * * *', description: 'Alert when items fall below reorder level', tenantScoped: true },
    async (_job, tenantId) => { logger.info({ tenantId }, 'Running low stock alert check'); }
  );

  registry.register(
    'inventory.reservation-expiry',
    { cron: '*/15 * * * *', description: 'Expire stock reservations past their hold time', tenantScoped: false },
    async (_job) => {
      const inventoryUrl = process.env['INVENTORY_SERVICE_URL'] ?? 'http://localhost:3012';
      const apiKey = process.env['INTERNAL_API_KEY'] ?? '';
      try {
        const res = await fetch(`${inventoryUrl}/api/v2/inventory/reservations/expire`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-internal-key': apiKey },
        });
        const body = await res.json() as { data?: { expiredCount?: number } };
        logger.info({ expiredCount: body.data?.expiredCount }, 'Reservation expiry complete');
      } catch (err) {
        logger.warn({ err }, 'Reservation expiry job failed (non-fatal)');
      }
    }
  );

  registry.register(
    'inventory.nightly-reconciliation',
    { cron: '0 2 * * *', description: 'Nightly inventory ledger vs projection reconciliation', tenantScoped: false },
    async (_job) => {
      const inventoryUrl = process.env['INVENTORY_SERVICE_URL'] ?? 'http://localhost:3012';
      const apiKey = process.env['INTERNAL_API_KEY'] ?? '';
      try {
        const res = await fetch(`${inventoryUrl}/api/v2/inventory/reconcile`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-internal-key': apiKey },
        });
        const body = await res.json() as { data?: { checked?: number; mismatches?: number } };
        logger.info({ checked: body.data?.checked, mismatches: body.data?.mismatches }, 'Nightly reconciliation complete');
      } catch (err) {
        logger.warn({ err }, 'Nightly reconciliation job failed (non-fatal)');
      }
    }
  );

  registry.register(
    'inventory.stock-value-report',
    { cron: '0 6 * * *', description: 'Daily stock valuation snapshot', tenantScoped: true },
    async (_job, tenantId) => { logger.info({ tenantId }, 'Running stock value report'); }
  );

  registry.register(
    'inventory.physical-verification-reminder',
    { cron: '0 9 1 * *', description: 'Monthly physical verification reminder', tenantScoped: true },
    async (_job, tenantId) => { logger.info({ tenantId }, 'Sending physical verification reminder'); }
  );

  // ── GST ───────────────────────────────────────────────────────────────────
  registry.register(
    'gst.gstr1-auto-prepare',
    { cron: '0 0 5 * *', description: 'Auto-prepare GSTR-1 on 5th of each month', tenantScoped: true },
    async (_job, tenantId) => { logger.info({ tenantId }, 'Auto-preparing GSTR-1'); }
  );

  registry.register(
    'gst.gstr3b-reminder',
    { cron: '0 9 10 * *', description: 'GSTR-3B filing reminder on 10th', tenantScoped: true },
    async (_job, tenantId) => { logger.info({ tenantId }, 'Sending GSTR-3B reminder'); }
  );

  registry.register(
    'gst.e-invoice-retry',
    { cron: '*/15 * * * *', description: 'Retry PENDING_IRN e-Invoices every 15 minutes', tenantScoped: false },
    async (_job) => {
      const gstUrl = process.env['GST_SERVICE_URL'] ?? 'http://localhost:3018';
      const apiKey = process.env['INTERNAL_API_KEY'] ?? '';
      try {
        const res = await fetch(`${gstUrl}/api/v2/gst/einvoice/retry-pending`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-internal-key': apiKey },
        });
        const body = await res.json() as { data?: { retried?: number; succeeded?: number; failed?: number } };
        logger.info({ retried: body.data?.retried, succeeded: body.data?.succeeded }, 'e-Invoice PENDING_IRN retry complete');
      } catch (err) {
        logger.warn({ err }, 'e-Invoice retry job failed (non-fatal)');
      }
    }
  );

  registry.register(
    'gst.eway-bill-expiry-alert',
    { cron: '0 8 * * *', description: 'Daily alert for e-Way Bills expiring within 24 hours', tenantScoped: false },
    async (_job) => {
      const gstUrl = process.env['GST_SERVICE_URL'] ?? 'http://localhost:3018';
      const apiKey = process.env['INTERNAL_API_KEY'] ?? '';
      try {
        const res = await fetch(`${gstUrl}/api/v2/gst/eway-bill/expiring-soon`, {
          method: 'GET',
          headers: { 'x-internal-key': apiKey },
        });
        const body = await res.json() as { data?: { totalElements?: number } };
        const count = body.data?.totalElements ?? 0;
        if (count > 0) {
          logger.warn({ count }, `${count} e-Way Bill(s) expiring within 24 hours — notify logistics`);
        } else {
          logger.info({}, 'No e-Way Bills expiring soon');
        }
      } catch (err) {
        logger.warn({ err }, 'e-Way Bill expiry check failed (non-fatal)');
      }
    }
  );

  registry.register(
    'gst.gstr2a-reconcile',
    { cron: '0 3 * * 0', description: 'Weekly GSTR-2A reconciliation', tenantScoped: true },
    async (_job, tenantId) => { logger.info({ tenantId }, 'Running GSTR-2A reconciliation'); }
  );

  // ── HR / PAYROLL ──────────────────────────────────────────────────────────
  registry.register(
    'hr.attendance.biometric-auto-import',
    { cron: '59 23 * * *', description: 'Nightly biometric machine auto-import at 23:59', tenantScoped: false },
    async (_job) => {
      const hrUrl = process.env['HR_SERVICE_URL'] ?? 'http://localhost:3021';
      const apiKey = process.env['INTERNAL_API_KEY'] ?? '';
      try {
        const res = await fetch(`${hrUrl}/api/v2/attendance/biometric-auto-import`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-internal-key': apiKey },
        });
        const body = await res.json() as { data?: { imported?: number } };
        logger.info({ imported: body.data?.imported }, 'Biometric auto-import complete');
      } catch (err) {
        logger.warn({ err }, 'Biometric auto-import job failed (non-fatal)');
      }
    }
  );

  registry.register(
    'hr.leave.accrual',
    { cron: '0 0 1 * *', description: 'Monthly leave credit accrual', tenantScoped: false },
    async (_job) => {
      const hrUrl = process.env['HR_SERVICE_URL'] ?? 'http://localhost:3021';
      const apiKey = process.env['INTERNAL_API_KEY'] ?? '';
      try {
        const res = await fetch(`${hrUrl}/api/v2/leave-applications/accrue-monthly`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-internal-key': apiKey },
        });
        const body = await res.json() as { data?: { accrued?: number } };
        logger.info({ accrued: body.data?.accrued }, 'Monthly leave accrual complete');
      } catch (err) {
        logger.warn({ err }, 'Leave accrual job failed (non-fatal)');
      }
    }
  );

  registry.register(
    'hr.leave.year-end-carry-forward',
    { cron: '59 23 31 12 *', description: 'Year-end leave carry-forward and expiry on December 31', tenantScoped: false },
    async (_job) => {
      const hrUrl = process.env['HR_SERVICE_URL'] ?? 'http://localhost:3021';
      const apiKey = process.env['INTERNAL_API_KEY'] ?? '';
      try {
        const res = await fetch(`${hrUrl}/api/v2/leave-applications/year-end-carry-forward`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-internal-key': apiKey },
        });
        const body = await res.json() as { data?: { carriedForward?: number; expired?: number } };
        logger.info({ carriedForward: body.data?.carriedForward, expired: body.data?.expired }, 'Year-end leave carry-forward complete');
      } catch (err) {
        logger.warn({ err }, 'Leave carry-forward job failed (non-fatal)');
      }
    }
  );

  registry.register(
    'hr.payroll.prepare',
    { cron: '0 1 25 * *', description: 'Prepare payroll data on 25th of each month', tenantScoped: true },
    async (_job, tenantId) => { logger.info({ tenantId }, 'Preparing payroll'); }
  );

  registry.register(
    'hr.salary-slip.email',
    { cron: '0 9 28 * *', description: 'Email salary slips to employees on 28th', tenantScoped: true },
    async (_job, tenantId) => { logger.info({ tenantId }, 'Emailing salary slips'); }
  );

  registry.register(
    'hr.alteration.promised-today-alert',
    { cron: '0 8 * * *', description: 'Daily 08:00 — alert tailors for alterations promised today', tenantScoped: false },
    async (_job) => {
      const hrUrl = process.env['HR_SERVICE_URL'] ?? 'http://localhost:3021';
      const apiKey = process.env['INTERNAL_API_KEY'] ?? '';
      try {
        const res = await fetch(`${hrUrl}/api/v2/alterations/promised-today-alert`, {
          headers: { 'x-internal-key': apiKey },
        });
        const body = await res.json() as { data?: { totalElements?: number } };
        logger.info({ count: body.data?.totalElements }, 'Alteration promised-today alert complete');
      } catch (err) {
        logger.warn({ err }, 'Alteration promised-today alert job failed (non-fatal)');
      }
    }
  );

  registry.register(
    'hr.alteration.overdue-alert',
    { cron: '30 8 * * *', description: 'Daily 08:30 — alert manager of overdue alterations', tenantScoped: false },
    async (_job) => {
      const hrUrl = process.env['HR_SERVICE_URL'] ?? 'http://localhost:3021';
      const apiKey = process.env['INTERNAL_API_KEY'] ?? '';
      try {
        const res = await fetch(`${hrUrl}/api/v2/alterations/overdue-alert`, {
          headers: { 'x-internal-key': apiKey },
        });
        const body = await res.json() as { data?: { totalElements?: number } };
        logger.info({ count: body.data?.totalElements }, 'Alteration overdue alert complete');
      } catch (err) {
        logger.warn({ err }, 'Alteration overdue alert job failed (non-fatal)');
      }
    }
  );

  // ── SALES / CRM ───────────────────────────────────────────────────────────
  registry.register(
    'sales.quotation-expiry',
    { cron: '0 1 * * *', description: 'Expire quotations past their validUntil date', tenantScoped: false },
    async (_job) => {
      const salesUrl = process.env['SALES_SERVICE_URL'] ?? 'http://localhost:3013';
      const apiKey = process.env['INTERNAL_API_KEY'] ?? '';
      try {
        const res = await fetch(`${salesUrl}/api/v2/quotations/expire-stale`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-internal-key': apiKey },
        });
        const body = await res.json() as { data?: { expiredCount?: number } };
        logger.info({ expiredCount: body.data?.expiredCount }, 'Quotation expiry complete');
      } catch (err) {
        logger.warn({ err }, 'Quotation expiry job failed (non-fatal)');
      }
    }
  );

  registry.register(
    'sales.loyalty-points-expiry',
    { cron: '0 2 * * *', description: 'Expire unused loyalty points past their expiry date', tenantScoped: false },
    async (_job) => {
      const salesUrl = process.env['SALES_SERVICE_URL'] ?? 'http://localhost:3013';
      const apiKey = process.env['INTERNAL_API_KEY'] ?? '';
      try {
        const res = await fetch(`${salesUrl}/api/v2/loyalty/expire-points`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-internal-key': apiKey },
        });
        const body = await res.json() as { data?: { expiredCount?: number } };
        logger.info({ expiredCount: body.data?.expiredCount }, 'Loyalty points expiry complete');
      } catch (err) {
        logger.warn({ err }, 'Loyalty points expiry job failed (non-fatal)');
      }
    }
  );

  registry.register(
    'sales.overdue-invoice-update',
    { cron: '0 1 * * *', description: 'Mark invoices OVERDUE when past due date and unpaid', tenantScoped: false },
    async (_job) => {
      const salesUrl = process.env['SALES_SERVICE_URL'] ?? 'http://localhost:3013';
      const apiKey = process.env['INTERNAL_API_KEY'] ?? '';
      try {
        await fetch(`${salesUrl}/api/v2/invoices/mark-overdue`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-internal-key': apiKey },
        });
        logger.info({}, 'Overdue invoice update complete');
      } catch (err) {
        logger.warn({ err }, 'Overdue invoice update failed (non-fatal)');
      }
    }
  );

  registry.register(
    'sales.overdue-payment-reminder',
    { cron: '0 10 * * 1,3,5', description: 'Send payment reminders for overdue invoices MWF', tenantScoped: true },
    async (_job, tenantId) => { logger.info({ tenantId }, 'Sending overdue payment reminders'); }
  );

  registry.register(
    'sales.credit-limit-review',
    { cron: '0 2 * * 0', description: 'Weekly review of customer credit limits', tenantScoped: true },
    async (_job, tenantId) => { logger.info({ tenantId }, 'Running credit limit review'); }
  );

  registry.register(
    'crm.customer-health-score',
    { cron: '0 2 * * 0', description: 'Weekly customer health score calculation (Sunday 02:00) — M9.2', tenantScoped: false },
    async (_job) => {
      const salesUrl = process.env['SALES_SERVICE_URL'] ?? 'http://localhost:3013';
      const apiKey = process.env['INTERNAL_API_KEY'] ?? '';
      try {
        const res = await fetch(`${salesUrl}/api/v2/crm/health-score/compute`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-internal-key': apiKey },
        });
        const body = await res.json() as { data?: { tenantsProcessed?: number; customersScored?: number } };
        logger.info({ tenantsProcessed: body.data?.tenantsProcessed, customersScored: body.data?.customersScored }, 'Customer health score computation complete');
      } catch (err) {
        logger.warn({ err }, 'Customer health score job failed (non-fatal)');
      }
    }
  );

  registry.register(
    'crm.birthday-anniversary-trigger',
    { cron: '0 8 * * *', description: 'Daily 08:00 — send birthday/anniversary greetings — M9.6', tenantScoped: false },
    async (_job) => {
      const salesUrl = process.env['SALES_SERVICE_URL'] ?? 'http://localhost:3013';
      const apiKey = process.env['INTERNAL_API_KEY'] ?? '';
      try {
        const res = await fetch(`${salesUrl}/api/v2/crm/birthday-greetings/send`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-internal-key': apiKey },
        });
        const body = await res.json() as { data?: { candidates?: number; sent?: number } };
        logger.info({ candidates: body.data?.candidates, sent: body.data?.sent }, 'Birthday greeting dispatch complete');
      } catch (err) {
        logger.warn({ err }, 'Birthday greeting job failed (non-fatal)');
      }
    }
  );

  registry.register(
    'crm.campaign-dispatch',
    { cron: '*/5 * * * *', description: 'Every 5 minutes — dispatch SCHEDULED campaigns past their scheduledAt — M9.5', tenantScoped: false },
    async (_job) => {
      const salesUrl = process.env['SALES_SERVICE_URL'] ?? 'http://localhost:3013';
      const apiKey = process.env['INTERNAL_API_KEY'] ?? '';
      try {
        const res = await fetch(`${salesUrl}/api/v2/crm/campaigns/dispatch-scheduled`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-internal-key': apiKey },
        });
        const body = await res.json() as { data?: { due?: number; dispatched?: number; failed?: number } };
        if ((body.data?.due ?? 0) > 0) {
          logger.info({ due: body.data?.due, dispatched: body.data?.dispatched, failed: body.data?.failed }, 'Scheduled campaign dispatch complete');
        }
      } catch (err) {
        logger.warn({ err }, 'Campaign dispatch job failed (non-fatal)');
      }
    }
  );

  // ── PURCHASE ──────────────────────────────────────────────────────────────
  registry.register(
    'purchase.po-delivery-reminder',
    { cron: '0 9 * * *', description: 'Remind suppliers of pending PO deliveries', tenantScoped: true },
    async (_job, tenantId) => { logger.info({ tenantId }, 'Sending PO delivery reminders'); }
  );

  registry.register(
    'purchase.pending-grn-alert',
    { cron: '0 10 * * *', description: 'Alert for GRNs pending beyond configured days', tenantScoped: true },
    async (_job, tenantId) => { logger.info({ tenantId }, 'Running pending GRN alert'); }
  );

  registry.register(
    'purchase.pdc-alert',
    { cron: '0 8 * * *', description: 'Alert finance 3 days before PDC clearing date', tenantScoped: false },
    async (_job) => {
      const purchaseUrl = process.env['PURCHASE_SERVICE_URL'] ?? 'http://localhost:3020';
      const apiKey = process.env['INTERNAL_API_KEY'] ?? '';
      // Run for all tenants — simplified: alert endpoint processes all tenants from DB
      try {
        const res = await fetch(`${purchaseUrl}/api/v2/purchase/pdc-alerts`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-internal-key': apiKey },
        });
        const body = await res.json() as { data?: { processed?: number } };
        logger.info({ processed: body.data?.processed }, 'PDC alert job complete');
      } catch (err) {
        logger.warn({ err }, 'PDC alert job failed (non-fatal)');
      }
    }
  );

  // ── WORKFLOW / APPROVALS ──────────────────────────────────────────────────
  registry.register(
    'workflow.approval-expiry',
    { cron: '*/30 * * * *', description: 'Expire and escalate pending approvals past timeout', tenantScoped: true },
    async (_job, tenantId) => {
      logger.info({ tenantId }, 'Processing workflow approval expiry');
      // Actual escalation logic here using WorkflowEngine
    }
  );

  registry.register(
    'workflow.approval-reminder',
    { cron: '0 9,14 * * *', description: 'Send reminders for pending approvals at 9 AM and 2 PM', tenantScoped: true },
    async (_job, tenantId) => { logger.info({ tenantId }, 'Sending approval reminders'); }
  );

  // ── SEARCH ────────────────────────────────────────────────────────────────
  registry.register(
    'search.full-reindex',
    { cron: '0 2 * * 0', description: 'Weekly full Elasticsearch reindex on Sunday at 2 AM', tenantScoped: true },
    async (_job, tenantId) => { logger.info({ tenantId }, 'Running search full reindex'); }
  );

  registry.register(
    'search.incremental-sync',
    { cron: '*/10 * * * *', description: 'Incremental Elasticsearch sync every 10 minutes', tenantScoped: true },
    async (_job, tenantId) => { logger.info({ tenantId }, 'Running search incremental sync'); }
  );

  // ── PLATFORM MAINTENANCE ──────────────────────────────────────────────────
  registry.register(
    'platform.outbox-cleanup',
    { cron: '0 4 * * *', description: 'Clean published outbox events older than 7 days', tenantScoped: false },
    async () => { logger.info({}, 'Cleaning outbox events'); }
  );

  registry.register(
    'platform.audit-log-archive',
    { cron: '0 5 1 * *', description: 'Archive audit logs older than 1 year', tenantScoped: false },
    async () => { logger.info({}, 'Archiving audit logs'); }
  );

  registry.register(
    'platform.token-cleanup',
    { cron: '0 3 * * *', description: 'Clean expired refresh tokens and password reset tokens', tenantScoped: false },
    async () => { logger.info({}, 'Cleaning expired tokens'); }
  );

  registry.register(
    'platform.partition-maintenance',
    { cron: '0 2 1 12 *', description: 'Create next year partitions on Dec 1 (§5.5)', tenantScoped: false },
    async () => { logger.info({}, 'Creating next-year table partitions'); }
  );

  registry.register(
    'platform.import-cleanup',
    { cron: '0 6 * * *', description: 'Clean up failed/old import jobs and S3 files', tenantScoped: false },
    async () => { logger.info({}, 'Cleaning import jobs'); }
  );

  registry.register(
    'platform.notification-log-archive',
    { cron: '0 4 1 * *', description: 'Archive notification log entries older than 90 days', tenantScoped: false },
    async () => { logger.info({}, 'Archiving notification log'); }
  );

  registry.register(
    'platform.export-cleanup',
    { cron: '0 5 * * *', description: 'Clean expired export files and signed URLs', tenantScoped: false },
    async () => { logger.info({}, 'Cleaning expired exports'); }
  );

  // ── PRODUCTION / REORDER (Phase 10) ──────────────────────────────────────
  registry.register(
    'production.reorder-report',
    { cron: '0 9 * * *', description: 'Daily 09:00 — check reorder levels and email report to purchase manager', tenantScoped: false },
    async (_job) => {
      const productionUrl = process.env['PRODUCTION_SERVICE_URL'] ?? 'http://localhost:3022';
      const apiKey = process.env['INTERNAL_API_KEY'] ?? '';
      try {
        const res = await fetch(`${productionUrl}/api/v2/inventory/reorder-required`, {
          method: 'GET',
          headers: { 'Content-Type': 'application/json', 'x-internal-key': apiKey },
        });
        const body = await res.json() as { data?: unknown[] };
        const count = body.data?.length ?? 0;
        logger.info({ itemsBelowReorder: count }, 'Reorder report check complete');
      } catch (err) {
        logger.warn({ err }, 'Reorder report job failed (non-fatal)');
      }
    }
  );

  registry.register(
    'production.job-work-overdue-alert',
    { cron: '0 9 * * *', description: 'Daily 09:00 — alert for overdue job work orders', tenantScoped: false },
    async (_job) => {
      const productionUrl = process.env['PRODUCTION_SERVICE_URL'] ?? 'http://localhost:3022';
      const apiKey = process.env['INTERNAL_API_KEY'] ?? '';
      try {
        const res = await fetch(`${productionUrl}/api/v2/job-work-orders/in-progress`, {
          method: 'GET',
          headers: { 'x-internal-key': apiKey },
        });
        const body = await res.json() as { data?: unknown[] };
        logger.info({ inProgressCount: body.data?.length ?? 0 }, 'Job work overdue alert check complete');
      } catch (err) {
        logger.warn({ err }, 'Job work overdue alert failed (non-fatal)');
      }
    }
  );

  logger.info({ totalJobs: registry.listAll().length }, 'All system jobs registered');
}
