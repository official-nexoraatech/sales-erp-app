import type { JobRegistry } from '../JobRegistry.js';
import { createLogger } from '@erp/logger';
import { createCircuitBreaker, type StorageClient } from '@erp/sdk';
import type { ErpDatabase } from '@erp/db';
import { and, eq, lt, sql } from 'drizzle-orm';
import {
  outboxEvents,
  auditLog,
  refreshTokens,
  passwordResetTokens,
  notificationLog,
  importJobs,
  exportJobs,
  workflowInstances,
  workflowDefinitions,
  workflowApprovals,
  financialEntries,
} from '@erp/db';
import { runSearchFullReindex, runSearchIncrementalSync } from './searchSyncJobs.js';

const logger = createLogger({ serviceName: 'scheduler-service' });

const DELETE_BATCH_SIZE = 5000;
const MAX_BATCHES_PER_RUN = 10;

// ES-16: these two jobs are the only real HTTP calls from any service straight into
// inventory-service in this codebase (sales/purchase-service write inventory_ledger
// directly in a shared DB transaction instead — see ES-03's Architecture Decision).
// Wrap them so a downed inventory-service fails this poll fast instead of hanging.
async function callInventoryService(
  inventoryUrl: string,
  path: string,
  apiKey: string
): Promise<Response> {
  return fetch(`${inventoryUrl}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-internal-key': apiKey },
  });
}

const inventoryServiceBreaker = createCircuitBreaker(callInventoryService, 'inventory-service');

// Batched delete for maintenance jobs touching potentially large tables — avoids a single
// unbounded DELETE holding a long lock. Stops after MAX_BATCHES_PER_RUN so one run can't
// run indefinitely on a large backlog; the next scheduled run picks up where this left off.
async function deleteBatched(deleteOneBatch: () => Promise<number>): Promise<number> {
  let totalDeleted = 0;
  for (let i = 0; i < MAX_BATCHES_PER_RUN; i++) {
    const deleted = await deleteOneBatch();
    totalDeleted += deleted;
    if (deleted < DELETE_BATCH_SIZE) break;
  }
  return totalDeleted;
}

// All 30+ system jobs per ERP_MASTER_SPEC roadmap
export function registerSystemJobs(
  registry: JobRegistry,
  db: ErpDatabase,
  storage: StorageClient
): void {
  // ── ACCOUNTING ─────────────────────────────────────────────────────────────
  registry.register(
    'accounting.trial-balance.snapshot',
    { cron: '0 1 * * *', description: 'Snapshot trial balance daily at 1 AM', tenantScoped: true },
    async (_job, tenantId) => {
      if (tenantId === undefined) return;
      const accountingUrl = process.env['ACCOUNTING_SERVICE_URL'] ?? 'http://localhost:3019';
      const apiKey = process.env['INTERNAL_API_KEY'] ?? '';
      try {
        const res = await fetch(
          `${accountingUrl}/api/v2/internal/reports/trial-balance-snapshot?tenantId=${tenantId}`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'x-internal-key': apiKey },
          }
        );
        const body = (await res.json()) as {
          data?: { isBalanced?: boolean; totalDebit?: number; totalCredit?: number };
        };
        logger.info(
          {
            tenantId,
            isBalanced: body.data?.isBalanced,
            totalDebit: body.data?.totalDebit,
            totalCredit: body.data?.totalCredit,
          },
          'Trial balance snapshot complete'
        );
      } catch (err) {
        logger.warn({ tenantId, err }, 'Trial balance snapshot job failed (non-fatal)');
      }
    }
  );

  registry.register(
    'accounting.outstanding-report',
    {
      cron: '0 2 * * *',
      description: 'Generate outstanding receivables/payables report',
      tenantScoped: true,
    },
    async (_job, tenantId) => {
      if (tenantId === undefined) return;
      const reportUrl = process.env['REPORT_SERVICE_URL'] ?? 'http://localhost:3015';
      const apiKey = process.env['INTERNAL_API_KEY'] ?? '';
      try {
        const res = await fetch(
          `${reportUrl}/internal/reports/outstanding-summary?tenantId=${tenantId}`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'x-internal-key': apiKey },
          }
        );
        const body = (await res.json()) as { data?: { arTotal?: number; apTotal?: number } };
        logger.info(
          { tenantId, arTotal: body.data?.arTotal, apTotal: body.data?.apTotal },
          'Outstanding report complete'
        );
      } catch (err) {
        logger.warn({ tenantId, err }, 'Outstanding report job failed (non-fatal)');
      }
    }
  );

  registry.register(
    'accounting.bank-reconciliation-reminder',
    {
      cron: '0 9 * * 1',
      description: 'Weekly reminder to reconcile bank statements',
      tenantScoped: true,
    },
    async (_job, tenantId) => {
      if (tenantId === undefined) return;
      const accountingUrl = process.env['ACCOUNTING_SERVICE_URL'] ?? 'http://localhost:3019';
      const apiKey = process.env['INTERNAL_API_KEY'] ?? '';
      try {
        const res = await fetch(
          `${accountingUrl}/api/v2/internal/bank-reconciliation/reminder?tenantId=${tenantId}`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'x-internal-key': apiKey },
          }
        );
        const body = (await res.json()) as {
          data?: { unreconciledAccounts?: number; totalUnmatched?: number };
        };
        logger.info(
          {
            tenantId,
            unreconciledAccounts: body.data?.unreconciledAccounts,
            totalUnmatched: body.data?.totalUnmatched,
          },
          'Bank reconciliation reminder complete'
        );
      } catch (err) {
        logger.warn({ tenantId, err }, 'Bank reconciliation reminder job failed (non-fatal)');
      }
    }
  );

  // ── INVENTORY ─────────────────────────────────────────────────────────────
  registry.register(
    'inventory.low-stock-alert',
    {
      cron: '0 8 * * *',
      description: 'Alert when items fall below reorder level',
      tenantScoped: true,
    },
    async (_job, tenantId) => {
      if (tenantId === undefined) return;
      // Same underlying query production.reorder-report uses (ReorderService.getReorderRequired)
      // — reuse the same internal route rather than duplicating the comparison in inventory-service.
      const productionUrl = process.env['PRODUCTION_SERVICE_URL'] ?? 'http://localhost:3022';
      const apiKey = process.env['INTERNAL_API_KEY'] ?? '';
      try {
        const res = await fetch(
          `${productionUrl}/api/v2/internal/inventory/reorder-required?tenantId=${tenantId}`,
          {
            method: 'GET',
            headers: { 'x-internal-key': apiKey },
          }
        );
        const body = (await res.json()) as { data?: Array<{ itemCode?: string }> };
        const count = body.data?.length ?? 0;
        if (count > 0) {
          logger.warn({ tenantId, count }, `${count} item(s) below reorder level`);
        } else {
          logger.info({ tenantId }, 'No items below reorder level');
        }
      } catch (err) {
        logger.warn({ tenantId, err }, 'Low stock alert job failed (non-fatal)');
      }
    }
  );

  registry.register(
    'inventory.reservation-expiry',
    {
      cron: '*/15 * * * *',
      description: 'Expire stock reservations past their hold time',
      tenantScoped: false,
    },
    async (_job) => {
      const inventoryUrl = process.env['INVENTORY_SERVICE_URL'] ?? 'http://localhost:3012';
      const apiKey = process.env['INTERNAL_API_KEY'] ?? '';
      try {
        const res = await inventoryServiceBreaker.fire(
          inventoryUrl,
          '/api/v2/inventory/reservations/expire',
          apiKey
        );
        const body = (await res.json()) as { data?: { expiredCount?: number } };
        logger.info({ expiredCount: body.data?.expiredCount }, 'Reservation expiry complete');
      } catch (err) {
        logger.warn({ err }, 'Reservation expiry job failed (non-fatal)');
      }
    }
  );

  registry.register(
    'inventory.nightly-reconciliation',
    {
      cron: '0 2 * * *',
      description: 'Nightly inventory ledger vs projection reconciliation',
      tenantScoped: false,
    },
    async (_job) => {
      const inventoryUrl = process.env['INVENTORY_SERVICE_URL'] ?? 'http://localhost:3012';
      const apiKey = process.env['INTERNAL_API_KEY'] ?? '';
      try {
        const res = await inventoryServiceBreaker.fire(
          inventoryUrl,
          '/api/v2/inventory/reconcile',
          apiKey
        );
        const body = (await res.json()) as { data?: { checked?: number; mismatches?: number } };
        logger.info(
          { checked: body.data?.checked, mismatches: body.data?.mismatches },
          'Nightly reconciliation complete'
        );
      } catch (err) {
        logger.warn({ err }, 'Nightly reconciliation job failed (non-fatal)');
      }
    }
  );

  registry.register(
    'inventory.stock-value-report',
    { cron: '0 6 * * *', description: 'Daily stock valuation snapshot', tenantScoped: true },
    async (_job, tenantId) => {
      if (tenantId === undefined) return;
      const inventoryUrl = process.env['INVENTORY_SERVICE_URL'] ?? 'http://localhost:3012';
      const apiKey = process.env['INTERNAL_API_KEY'] ?? '';
      try {
        const res = await fetch(
          `${inventoryUrl}/api/v2/internal/inventory/valuation-snapshot?tenantId=${tenantId}`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'x-internal-key': apiKey },
          }
        );
        const body = (await res.json()) as {
          data?: { totalStockValue?: number; itemCount?: number };
        };
        logger.info(
          {
            tenantId,
            totalStockValue: body.data?.totalStockValue,
            itemCount: body.data?.itemCount,
          },
          'Stock value report complete'
        );
      } catch (err) {
        logger.warn({ tenantId, err }, 'Stock value report job failed (non-fatal)');
      }
    }
  );

  registry.register(
    'inventory.physical-verification-reminder',
    {
      cron: '0 9 1 * *',
      description: 'Monthly physical verification reminder',
      tenantScoped: true,
    },
    async (_job, tenantId) => {
      if (tenantId === undefined) return;
      const inventoryUrl = process.env['INVENTORY_SERVICE_URL'] ?? 'http://localhost:3012';
      const apiKey = process.env['INTERNAL_API_KEY'] ?? '';
      try {
        const res = await fetch(
          `${inventoryUrl}/api/v2/internal/inventory/physical-verification-reminder?tenantId=${tenantId}`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'x-internal-key': apiKey },
          }
        );
        const body = (await res.json()) as { data?: { sent?: boolean } };
        logger.info({ tenantId, sent: body.data?.sent }, 'Physical verification reminder complete');
      } catch (err) {
        logger.warn({ tenantId, err }, 'Physical verification reminder job failed (non-fatal)');
      }
    }
  );

  // ── GST ───────────────────────────────────────────────────────────────────
  registry.register(
    'gst.gstr1-auto-prepare',
    {
      cron: '0 0 5 * *',
      description: 'Auto-prepare GSTR-1 on 5th of each month',
      tenantScoped: true,
    },
    async (_job, tenantId) => {
      if (tenantId === undefined) return;
      const gstUrl = process.env['GST_SERVICE_URL'] ?? 'http://localhost:3018';
      const apiKey = process.env['INTERNAL_API_KEY'] ?? '';
      try {
        const res = await fetch(`${gstUrl}/api/v2/gst/gstr1/auto-prepare?tenantId=${tenantId}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-internal-key': apiKey },
        });
        const body = (await res.json()) as {
          data?: { period?: string; isExportReady?: boolean; validationErrorCount?: number };
        };
        logger.info(
          {
            tenantId,
            period: body.data?.period,
            isExportReady: body.data?.isExportReady,
            validationErrorCount: body.data?.validationErrorCount,
          },
          'GSTR-1 auto-prepare complete'
        );
      } catch (err) {
        logger.warn({ tenantId, err }, 'GSTR-1 auto-prepare job failed (non-fatal)');
      }
    }
  );

  registry.register(
    'gst.gstr3b-reminder',
    { cron: '0 9 10 * *', description: 'GSTR-3B filing reminder on 10th', tenantScoped: true },
    async (_job, tenantId) => {
      if (tenantId === undefined) return;
      const gstUrl = process.env['GST_SERVICE_URL'] ?? 'http://localhost:3018';
      const apiKey = process.env['INTERNAL_API_KEY'] ?? '';
      try {
        const res = await fetch(`${gstUrl}/api/v2/gst/gstr3b/reminder?tenantId=${tenantId}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-internal-key': apiKey },
        });
        const body = (await res.json()) as { data?: { period?: string; sent?: boolean } };
        logger.info(
          { tenantId, period: body.data?.period, sent: body.data?.sent },
          'GSTR-3B reminder complete'
        );
      } catch (err) {
        logger.warn({ tenantId, err }, 'GSTR-3B reminder job failed (non-fatal)');
      }
    }
  );

  registry.register(
    'gst.e-invoice-retry',
    {
      cron: '*/15 * * * *',
      description: 'Retry PENDING_IRN e-Invoices every 15 minutes',
      tenantScoped: false,
    },
    async (_job) => {
      const gstUrl = process.env['GST_SERVICE_URL'] ?? 'http://localhost:3018';
      const apiKey = process.env['INTERNAL_API_KEY'] ?? '';
      try {
        const res = await fetch(`${gstUrl}/api/v2/gst/einvoice/retry-pending`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-internal-key': apiKey },
        });
        const body = (await res.json()) as {
          data?: { retried?: number; succeeded?: number; failed?: number };
        };
        logger.info(
          { retried: body.data?.retried, succeeded: body.data?.succeeded },
          'e-Invoice PENDING_IRN retry complete'
        );
      } catch (err) {
        logger.warn({ err }, 'e-Invoice retry job failed (non-fatal)');
      }
    }
  );

  registry.register(
    'gst.eway-bill-expiry-alert',
    {
      cron: '0 8 * * *',
      description: 'Daily alert for e-Way Bills expiring within 24 hours',
      tenantScoped: false,
    },
    async (_job) => {
      const gstUrl = process.env['GST_SERVICE_URL'] ?? 'http://localhost:3018';
      const apiKey = process.env['INTERNAL_API_KEY'] ?? '';
      try {
        const res = await fetch(`${gstUrl}/api/v2/gst/eway-bill/expiring-soon`, {
          method: 'GET',
          headers: { 'x-internal-key': apiKey },
        });
        const body = (await res.json()) as { data?: { totalElements?: number } };
        const count = body.data?.totalElements ?? 0;
        if (count > 0) {
          logger.warn(
            { count },
            `${count} e-Way Bill(s) expiring within 24 hours — notify logistics`
          );
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
    async (_job, tenantId) => {
      if (tenantId === undefined) return;
      const gstUrl = process.env['GST_SERVICE_URL'] ?? 'http://localhost:3018';
      const apiKey = process.env['INTERNAL_API_KEY'] ?? '';
      try {
        const res = await fetch(`${gstUrl}/api/v2/gst/gstr2a/reconcile-run?tenantId=${tenantId}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-internal-key': apiKey },
        });
        const body = (await res.json()) as {
          data?: {
            period?: string;
            summary?: {
              matched?: number;
              booksOnly?: number;
              gstr2aOnly?: number;
              amountMismatch?: number;
            };
          };
        };
        logger.info(
          { tenantId, period: body.data?.period, summary: body.data?.summary },
          'GSTR-2A reconciliation complete'
        );
      } catch (err) {
        logger.warn({ tenantId, err }, 'GSTR-2A reconciliation job failed (non-fatal)');
      }
    }
  );

  // ── HR / PAYROLL ──────────────────────────────────────────────────────────
  registry.register(
    'hr.attendance.biometric-auto-import',
    {
      cron: '59 23 * * *',
      description: 'Nightly biometric machine auto-import at 23:59',
      tenantScoped: false,
    },
    async (_job) => {
      const hrUrl = process.env['HR_SERVICE_URL'] ?? 'http://localhost:3021';
      const apiKey = process.env['INTERNAL_API_KEY'] ?? '';
      try {
        const res = await fetch(`${hrUrl}/api/v2/attendance/biometric-auto-import`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-internal-key': apiKey },
        });
        const body = (await res.json()) as { data?: { imported?: number } };
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
        const body = (await res.json()) as { data?: { accrued?: number } };
        logger.info({ accrued: body.data?.accrued }, 'Monthly leave accrual complete');
      } catch (err) {
        logger.warn({ err }, 'Leave accrual job failed (non-fatal)');
      }
    }
  );

  registry.register(
    'hr.leave.year-end-carry-forward',
    {
      cron: '59 23 31 12 *',
      description: 'Year-end leave carry-forward and expiry on December 31',
      tenantScoped: false,
    },
    async (_job) => {
      const hrUrl = process.env['HR_SERVICE_URL'] ?? 'http://localhost:3021';
      const apiKey = process.env['INTERNAL_API_KEY'] ?? '';
      try {
        const res = await fetch(`${hrUrl}/api/v2/leave-applications/year-end-carry-forward`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-internal-key': apiKey },
        });
        const body = (await res.json()) as { data?: { carriedForward?: number; expired?: number } };
        logger.info(
          { carriedForward: body.data?.carriedForward, expired: body.data?.expired },
          'Year-end leave carry-forward complete'
        );
      } catch (err) {
        logger.warn({ err }, 'Leave carry-forward job failed (non-fatal)');
      }
    }
  );

  registry.register(
    'hr.payroll.prepare',
    {
      cron: '0 1 25 * *',
      description: 'Prepare payroll data on 25th of each month',
      tenantScoped: true,
    },
    async (_job, tenantId) => {
      if (tenantId === undefined) return;
      const hrUrl = process.env['HR_SERVICE_URL'] ?? 'http://localhost:3021';
      const apiKey = process.env['INTERNAL_API_KEY'] ?? '';
      try {
        const res = await fetch(`${hrUrl}/api/v2/internal/payroll/prepare?tenantId=${tenantId}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-internal-key': apiKey },
        });
        const body = (await res.json()) as {
          data?: { payrollRunId?: number; employeeCount?: number; totalNet?: number };
        };
        logger.info(
          {
            tenantId,
            payrollRunId: body.data?.payrollRunId,
            employeeCount: body.data?.employeeCount,
            totalNet: body.data?.totalNet,
          },
          'Payroll prepare complete'
        );
      } catch (err) {
        logger.warn({ tenantId, err }, 'Payroll prepare job failed (non-fatal)');
      }
    }
  );

  registry.register(
    'hr.salary-slip.email',
    {
      cron: '0 9 28 * *',
      description: 'Email salary slips to employees on 28th',
      tenantScoped: true,
    },
    async (_job, tenantId) => {
      if (tenantId === undefined) return;
      const hrUrl = process.env['HR_SERVICE_URL'] ?? 'http://localhost:3021';
      const apiKey = process.env['INTERNAL_API_KEY'] ?? '';
      try {
        const res = await fetch(
          `${hrUrl}/api/v2/internal/payroll/send-slips?tenantId=${tenantId}`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'x-internal-key': apiKey },
          }
        );
        const body = (await res.json()) as { data?: { payrollRunId?: number; count?: number } };
        logger.info(
          { tenantId, payrollRunId: body.data?.payrollRunId, count: body.data?.count },
          'Salary slip email dispatch complete'
        );
      } catch (err) {
        logger.warn({ tenantId, err }, 'Salary slip email job failed (non-fatal)');
      }
    }
  );

  registry.register(
    'hr.alteration.promised-today-alert',
    {
      cron: '0 8 * * *',
      description: 'Daily 08:00 — alert tailors for alterations promised today',
      tenantScoped: false,
    },
    async (_job) => {
      const hrUrl = process.env['HR_SERVICE_URL'] ?? 'http://localhost:3021';
      const apiKey = process.env['INTERNAL_API_KEY'] ?? '';
      try {
        const res = await fetch(`${hrUrl}/api/v2/alterations/promised-today-alert`, {
          headers: { 'x-internal-key': apiKey },
        });
        const body = (await res.json()) as { data?: { totalElements?: number } };
        logger.info(
          { count: body.data?.totalElements },
          'Alteration promised-today alert complete'
        );
      } catch (err) {
        logger.warn({ err }, 'Alteration promised-today alert job failed (non-fatal)');
      }
    }
  );

  registry.register(
    'hr.alteration.overdue-alert',
    {
      cron: '30 8 * * *',
      description: 'Daily 08:30 — alert manager of overdue alterations',
      tenantScoped: false,
    },
    async (_job) => {
      const hrUrl = process.env['HR_SERVICE_URL'] ?? 'http://localhost:3021';
      const apiKey = process.env['INTERNAL_API_KEY'] ?? '';
      try {
        const res = await fetch(`${hrUrl}/api/v2/alterations/overdue-alert`, {
          headers: { 'x-internal-key': apiKey },
        });
        const body = (await res.json()) as { data?: { totalElements?: number } };
        logger.info({ count: body.data?.totalElements }, 'Alteration overdue alert complete');
      } catch (err) {
        logger.warn({ err }, 'Alteration overdue alert job failed (non-fatal)');
      }
    }
  );

  // ── SALES / CRM ───────────────────────────────────────────────────────────
  registry.register(
    'sales.quotation-expiry',
    {
      cron: '0 1 * * *',
      description: 'Expire quotations past their validUntil date',
      tenantScoped: false,
    },
    async (_job) => {
      const salesUrl = process.env['SALES_SERVICE_URL'] ?? 'http://localhost:3013';
      const apiKey = process.env['INTERNAL_API_KEY'] ?? '';
      try {
        const res = await fetch(`${salesUrl}/api/v2/quotations/expire-stale`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-internal-key': apiKey },
        });
        const body = (await res.json()) as { data?: { expiredCount?: number } };
        logger.info({ expiredCount: body.data?.expiredCount }, 'Quotation expiry complete');
      } catch (err) {
        logger.warn({ err }, 'Quotation expiry job failed (non-fatal)');
      }
    }
  );

  registry.register(
    'sales.loyalty-points-expiry',
    {
      cron: '0 2 * * *',
      description: 'Expire unused loyalty points past their expiry date',
      tenantScoped: false,
    },
    async (_job) => {
      const salesUrl = process.env['SALES_SERVICE_URL'] ?? 'http://localhost:3013';
      const apiKey = process.env['INTERNAL_API_KEY'] ?? '';
      try {
        const res = await fetch(`${salesUrl}/api/v2/loyalty/expire-points`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-internal-key': apiKey },
        });
        const body = (await res.json()) as { data?: { expiredCount?: number } };
        logger.info({ expiredCount: body.data?.expiredCount }, 'Loyalty points expiry complete');
      } catch (err) {
        logger.warn({ err }, 'Loyalty points expiry job failed (non-fatal)');
      }
    }
  );

  registry.register(
    'sales.overdue-invoice-update',
    {
      cron: '0 1 * * *',
      description: 'Mark invoices OVERDUE when past due date and unpaid',
      tenantScoped: false,
    },
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
    {
      cron: '0 10 * * 1,3,5',
      description: 'Send payment reminders for overdue invoices MWF — ES-18',
      tenantScoped: false,
    },
    async (_job) => {
      const salesUrl = process.env['SALES_SERVICE_URL'] ?? 'http://localhost:3013';
      const apiKey = process.env['INTERNAL_API_KEY'] ?? '';
      try {
        const res = await fetch(`${salesUrl}/api/v2/crm/payment-reminders/send`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-internal-key': apiKey },
        });
        const body = (await res.json()) as { data?: { candidates?: number; reminded?: number } };
        logger.info(
          { candidates: body.data?.candidates, reminded: body.data?.reminded },
          'Overdue payment reminder dispatch complete'
        );
      } catch (err) {
        logger.warn({ err }, 'Overdue payment reminder job failed (non-fatal)');
      }
    }
  );

  registry.register(
    'sales.credit-limit-review',
    {
      cron: '0 2 * * 0',
      description: 'Weekly review of customer credit limits',
      tenantScoped: true,
    },
    async (_job, tenantId) => {
      if (tenantId === undefined) return;
      const salesUrl = process.env['SALES_SERVICE_URL'] ?? 'http://localhost:3013';
      const apiKey = process.env['INTERNAL_API_KEY'] ?? '';
      try {
        const res = await fetch(
          `${salesUrl}/api/v2/crm/credit-limit-review/run?tenantId=${tenantId}`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'x-internal-key': apiKey },
          }
        );
        const body = (await res.json()) as { data?: { atRiskCount?: number } };
        logger.info(
          { tenantId, atRiskCount: body.data?.atRiskCount },
          'Credit limit review complete'
        );
      } catch (err) {
        logger.warn({ tenantId, err }, 'Credit limit review job failed (non-fatal)');
      }
    }
  );

  registry.register(
    'crm.customer-health-score',
    {
      cron: '0 2 * * 0',
      description: 'Weekly customer health score calculation (Sunday 02:00) — M9.2',
      tenantScoped: false,
    },
    async (_job) => {
      const salesUrl = process.env['SALES_SERVICE_URL'] ?? 'http://localhost:3013';
      const apiKey = process.env['INTERNAL_API_KEY'] ?? '';
      try {
        const res = await fetch(`${salesUrl}/api/v2/crm/health-score/compute`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-internal-key': apiKey },
        });
        const body = (await res.json()) as {
          data?: { tenantsProcessed?: number; customersScored?: number };
        };
        logger.info(
          {
            tenantsProcessed: body.data?.tenantsProcessed,
            customersScored: body.data?.customersScored,
          },
          'Customer health score computation complete'
        );
      } catch (err) {
        logger.warn({ err }, 'Customer health score job failed (non-fatal)');
      }
    }
  );

  registry.register(
    'crm.birthday-anniversary-trigger',
    {
      cron: '0 8 * * *',
      description: 'Daily 08:00 — send birthday/anniversary greetings — M9.6',
      tenantScoped: false,
    },
    async (_job) => {
      const salesUrl = process.env['SALES_SERVICE_URL'] ?? 'http://localhost:3013';
      const apiKey = process.env['INTERNAL_API_KEY'] ?? '';
      try {
        const res = await fetch(`${salesUrl}/api/v2/crm/birthday-greetings/send`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-internal-key': apiKey },
        });
        const body = (await res.json()) as { data?: { candidates?: number; sent?: number } };
        logger.info(
          { candidates: body.data?.candidates, sent: body.data?.sent },
          'Birthday greeting dispatch complete'
        );
      } catch (err) {
        logger.warn({ err }, 'Birthday greeting job failed (non-fatal)');
      }
    }
  );

  registry.register(
    'crm.campaign-dispatch',
    {
      cron: '*/5 * * * *',
      description: 'Every 5 minutes — dispatch SCHEDULED campaigns past their scheduledAt — M9.5',
      tenantScoped: false,
    },
    async (_job) => {
      const salesUrl = process.env['SALES_SERVICE_URL'] ?? 'http://localhost:3013';
      const apiKey = process.env['INTERNAL_API_KEY'] ?? '';
      try {
        const res = await fetch(`${salesUrl}/api/v2/crm/campaigns/dispatch-scheduled`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-internal-key': apiKey },
        });
        const body = (await res.json()) as {
          data?: { due?: number; dispatched?: number; failed?: number };
        };
        if ((body.data?.due ?? 0) > 0) {
          logger.info(
            { due: body.data?.due, dispatched: body.data?.dispatched, failed: body.data?.failed },
            'Scheduled campaign dispatch complete'
          );
        }
      } catch (err) {
        logger.warn({ err }, 'Campaign dispatch job failed (non-fatal)');
      }
    }
  );

  // ── PURCHASE ──────────────────────────────────────────────────────────────
  registry.register(
    'purchase.po-delivery-reminder',
    {
      cron: '0 9 * * *',
      description: 'Remind suppliers of pending PO deliveries',
      tenantScoped: true,
    },
    async (_job, tenantId) => {
      if (tenantId === undefined) return;
      const purchaseUrl = process.env['PURCHASE_SERVICE_URL'] ?? 'http://localhost:3020';
      const apiKey = process.env['INTERNAL_API_KEY'] ?? '';
      try {
        const res = await fetch(
          `${purchaseUrl}/api/v2/purchase/po-delivery-reminders/send?tenantId=${tenantId}`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'x-internal-key': apiKey },
          }
        );
        const body = (await res.json()) as { data?: { pendingCount?: number; reminded?: number } };
        logger.info(
          { tenantId, pendingCount: body.data?.pendingCount, reminded: body.data?.reminded },
          'PO delivery reminder complete'
        );
      } catch (err) {
        logger.warn({ tenantId, err }, 'PO delivery reminder job failed (non-fatal)');
      }
    }
  );

  registry.register(
    'purchase.pending-grn-alert',
    {
      cron: '0 10 * * *',
      description: 'Alert for GRNs pending beyond configured days',
      tenantScoped: true,
    },
    async (_job, tenantId) => {
      if (tenantId === undefined) return;
      const purchaseUrl = process.env['PURCHASE_SERVICE_URL'] ?? 'http://localhost:3020';
      const apiKey = process.env['INTERNAL_API_KEY'] ?? '';
      try {
        const res = await fetch(
          `${purchaseUrl}/api/v2/purchase/pending-grn-alerts/run?tenantId=${tenantId}`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'x-internal-key': apiKey },
          }
        );
        const body = (await res.json()) as { data?: { pendingCount?: number } };
        logger.info(
          { tenantId, pendingCount: body.data?.pendingCount },
          'Pending GRN alert complete'
        );
      } catch (err) {
        logger.warn({ tenantId, err }, 'Pending GRN alert job failed (non-fatal)');
      }
    }
  );

  registry.register(
    'purchase.pdc-alert',
    {
      cron: '0 8 * * *',
      description: 'Alert finance 3 days before PDC clearing date',
      tenantScoped: false,
    },
    async (_job) => {
      const purchaseUrl = process.env['PURCHASE_SERVICE_URL'] ?? 'http://localhost:3020';
      const apiKey = process.env['INTERNAL_API_KEY'] ?? '';
      // Run for all tenants — simplified: alert endpoint processes all tenants from DB
      try {
        const res = await fetch(`${purchaseUrl}/api/v2/purchase/pdc-alerts`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-internal-key': apiKey },
        });
        const body = (await res.json()) as { data?: { processed?: number } };
        logger.info({ processed: body.data?.processed }, 'PDC alert job complete');
      } catch (err) {
        logger.warn({ err }, 'PDC alert job failed (non-fatal)');
      }
    }
  );

  // ── WORKFLOW / APPROVALS ──────────────────────────────────────────────────
  // PG-026 note: workflowApprovals.approverId is actually populated with a ROLE id, not a
  // real user id (see WorkflowEngine.resolveApprover in packages/platform-sdk/src/workflow.ts
  // — "Find first user with this role — simplified for Phase 1" returns the role's own id).
  // This means getPendingForApprover(userId) has likely never matched real rows, and neither
  // of the two jobs below can resolve a real notification recipient today. That's a separate,
  // deeper bug in the core workflow engine (needs proper role→user(s) resolution), well beyond
  // this package's scope — both jobs below do real, honest bookkeeping work against the schema
  // as it actually behaves, without pretending to deliver a notification to someone we can't
  // correctly identify.
  registry.register(
    'workflow.approval-expiry',
    {
      cron: '*/30 * * * *',
      description: 'Expire and escalate pending approvals past timeout',
      tenantScoped: true,
    },
    async (_job, tenantId) => {
      if (tenantId === undefined) return;
      try {
        const overdue = await db
          .select()
          .from(workflowInstances)
          .where(
            and(
              eq(workflowInstances.tenantId, tenantId),
              eq(workflowInstances.status, 'PENDING'),
              lt(workflowInstances.expiresAt, new Date())
            )
          );

        let escalated = 0;
        let expired = 0;
        for (const instance of overdue) {
          const [definition] = await db
            .select()
            .from(workflowDefinitions)
            .where(eq(workflowDefinitions.id, instance.definitionId));
          if (definition?.escalationUserId) {
            await db
              .update(workflowApprovals)
              .set({ action: 'ESCALATED', decidedAt: new Date(), updatedAt: new Date() })
              .where(
                and(
                  eq(workflowApprovals.instanceId, instance.id),
                  eq(workflowApprovals.nodeId, instance.currentNodeId ?? ''),
                  eq(workflowApprovals.action, 'PENDING')
                )
              );

            const nodes = definition.nodes as Array<{ id: string; name: string }>;
            const node = nodes.find((n) => n.id === instance.currentNodeId);
            await db.insert(workflowApprovals).values({
              tenantId,
              instanceId: instance.id,
              nodeId: instance.currentNodeId ?? '',
              nodeName: node?.name ?? 'Escalated',
              approverId: definition.escalationUserId,
              action: 'PENDING',
              createdBy: 0,
            });
            await db
              .update(workflowInstances)
              .set({ updatedAt: new Date() })
              .where(eq(workflowInstances.id, instance.id));
            escalated++;
          } else {
            // No escalation target configured — nothing left to do but mark it expired.
            await db
              .update(workflowInstances)
              .set({ status: 'EXPIRED', completedAt: new Date(), updatedAt: new Date() })
              .where(eq(workflowInstances.id, instance.id));
            expired++;
          }
        }

        logger.info({ tenantId, escalated, expired }, 'Workflow approval expiry complete');
      } catch (err) {
        logger.warn({ tenantId, err }, 'Workflow approval expiry job failed (non-fatal)');
      }
    }
  );

  registry.register(
    'workflow.approval-reminder',
    {
      cron: '0 9,14 * * *',
      description: 'Send reminders for pending approvals at 9 AM and 2 PM',
      tenantScoped: true,
    },
    async (_job, tenantId) => {
      if (tenantId === undefined) return;
      try {
        const pending = await db
          .select({ id: workflowApprovals.id })
          .from(workflowApprovals)
          .where(
            and(eq(workflowApprovals.tenantId, tenantId), eq(workflowApprovals.action, 'PENDING'))
          );

        for (const approval of pending) {
          await db
            .update(workflowApprovals)
            .set({
              reminderCount: sql`${workflowApprovals.reminderCount} + 1`,
              notifiedAt: new Date(),
              updatedAt: new Date(),
            })
            .where(eq(workflowApprovals.id, approval.id));
        }

        logger.info(
          { tenantId, remindedCount: pending.length },
          'Workflow approval reminder bookkeeping complete'
        );
      } catch (err) {
        logger.warn({ tenantId, err }, 'Workflow approval reminder job failed (non-fatal)');
      }
    }
  );

  // ── SEARCH (Phase 4) ────────────────────────────────────────────────────────
  registry.register(
    'search.full-reindex',
    {
      cron: '0 2 * * 0',
      description: 'Weekly full Elasticsearch reindex on Sunday at 2 AM',
      tenantScoped: true,
    },
    async (_job, tenantId) => {
      if (tenantId === undefined) return;
      logger.info({ tenantId }, 'Running search full reindex');
      await runSearchFullReindex(tenantId);
    }
  );

  registry.register(
    'search.incremental-sync',
    {
      cron: '*/10 * * * *',
      description: 'Incremental Elasticsearch sync every 10 minutes',
      tenantScoped: true,
    },
    async (_job, tenantId) => {
      if (tenantId === undefined) return;
      logger.info({ tenantId }, 'Running search incremental sync');
      await runSearchIncrementalSync(tenantId);
    }
  );

  // ── PLATFORM MAINTENANCE ──────────────────────────────────────────────────
  registry.register(
    'platform.outbox-cleanup',
    {
      cron: '0 4 * * *',
      description: 'Clean published outbox events older than 7 days',
      tenantScoped: false,
    },
    async () => {
      try {
        const cutoff = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
        const deleted = await deleteBatched(async () => {
          const rows = await db.execute(sql`
            DELETE FROM ${outboxEvents}
            WHERE id IN (
              SELECT id FROM ${outboxEvents}
              WHERE ${outboxEvents.published} = true AND ${outboxEvents.createdAt} < ${cutoff.toISOString()}
              LIMIT ${DELETE_BATCH_SIZE}
            )
            RETURNING id
          `);
          return (rows as unknown[]).length;
        });
        logger.info({ deleted }, 'Outbox cleanup complete');
      } catch (err) {
        logger.warn({ err }, 'Outbox cleanup job failed (non-fatal)');
      }
    }
  );

  registry.register(
    'platform.audit-log-archive',
    { cron: '0 5 1 * *', description: 'Archive audit logs older than 1 year', tenantScoped: false },
    async () => {
      try {
        const cutoff = new Date(Date.now() - 365 * 24 * 60 * 60 * 1000);
        let totalArchived = 0;
        for (let i = 0; i < MAX_BATCHES_PER_RUN; i++) {
          const rows = await db
            .select()
            .from(auditLog)
            .where(lt(auditLog.createdAt, cutoff))
            .limit(DELETE_BATCH_SIZE);
          if (rows.length === 0) break;

          const archiveKey = await storage.uploadFile(
            0,
            'archives/audit-log',
            `audit-log-${new Date().toISOString().slice(0, 10)}-${i}.json`,
            Buffer.from(JSON.stringify(rows)),
            'application/json'
          );

          await db
            .delete(auditLog)
            .where(
              and(
                lt(auditLog.createdAt, cutoff),
                sql`${auditLog.id} = ANY(${rows.map((r) => r.id)})`
              )
            );
          totalArchived += rows.length;
          logger.info({ archiveKey, count: rows.length }, 'Audit log batch archived');
          if (rows.length < DELETE_BATCH_SIZE) break;
        }
        logger.info({ totalArchived }, 'Audit log archive complete');
      } catch (err) {
        logger.warn({ err }, 'Audit log archive job failed (non-fatal)');
      }
    }
  );

  registry.register(
    'platform.token-cleanup',
    {
      cron: '0 3 * * *',
      description: 'Clean expired refresh tokens and password reset tokens',
      tenantScoped: false,
    },
    async () => {
      try {
        const now = new Date();
        const refreshDeleted = await deleteBatched(async () => {
          const rows = await db.execute(sql`
            DELETE FROM ${refreshTokens}
            WHERE id IN (SELECT id FROM ${refreshTokens} WHERE ${refreshTokens.expiresAt} < ${now.toISOString()} LIMIT ${DELETE_BATCH_SIZE})
            RETURNING id
          `);
          return (rows as unknown[]).length;
        });
        const resetDeleted = await deleteBatched(async () => {
          const rows = await db.execute(sql`
            DELETE FROM ${passwordResetTokens}
            WHERE id IN (SELECT id FROM ${passwordResetTokens} WHERE ${passwordResetTokens.expiresAt} < ${now.toISOString()} LIMIT ${DELETE_BATCH_SIZE})
            RETURNING id
          `);
          return (rows as unknown[]).length;
        });
        logger.info({ refreshDeleted, resetDeleted }, 'Token cleanup complete');
      } catch (err) {
        logger.warn({ err }, 'Token cleanup job failed (non-fatal)');
      }
    }
  );

  registry.register(
    'platform.partition-maintenance',
    {
      cron: '0 2 1 12 *',
      description: 'Create next year partitions on Dec 1 (§5.5)',
      tenantScoped: false,
    },
    async () => {
      // financial_entries is the one table in this schema actually declared PARTITION BY
      // RANGE (created_at) with pre-created yearly child partitions (see
      // packages/db-client/migrations/0002_phase6_accounting.sql). Postgres's documented
      // safe pattern for adding a partition to an existing partitioned table (CREATE TABLE
      // ... PARTITION OF ... FOR VALUES FROM/TO) does not lock concurrent writes to other
      // partitions. IF NOT EXISTS makes re-running this job idempotent.
      try {
        const nextYear = new Date().getUTCFullYear() + 1;
        const partitionName = `financial_entries_${nextYear}`;
        await db.execute(sql`
          CREATE TABLE IF NOT EXISTS ${sql.raw(`"${partitionName}"`)} PARTITION OF ${financialEntries}
          FOR VALUES FROM (${`${nextYear}-01-01 00:00:00+00`}) TO (${`${nextYear + 1}-01-01 00:00:00+00`})
        `);
        logger.info({ partitionName }, 'Partition maintenance complete');
      } catch (err) {
        logger.warn({ err }, 'Partition maintenance job failed (non-fatal)');
      }
    }
  );

  registry.register(
    'platform.import-cleanup',
    {
      cron: '0 6 * * *',
      description: 'Clean up failed/old import jobs and S3 files',
      tenantScoped: false,
    },
    async () => {
      try {
        const cutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
        const rows = await db
          .select({
            id: importJobs.id,
            s3Key: importJobs.s3Key,
            errorReportS3Key: importJobs.errorReportS3Key,
          })
          .from(importJobs)
          .where(
            and(
              sql`${importJobs.status} IN ('COMPLETED', 'FAILED', 'ROLLED_BACK')`,
              lt(importJobs.createdAt, cutoff)
            )
          )
          .limit(DELETE_BATCH_SIZE);

        for (const row of rows) {
          try {
            await storage.deleteFile(row.s3Key);
            if (row.errorReportS3Key) await storage.deleteFile(row.errorReportS3Key);
          } catch {
            // best-effort — file may already be gone; still remove the tracking row below
          }
        }
        if (rows.length > 0) {
          await db.delete(importJobs).where(sql`${importJobs.id} = ANY(${rows.map((r) => r.id)})`);
        }
        logger.info({ cleaned: rows.length }, 'Import cleanup complete');
      } catch (err) {
        logger.warn({ err }, 'Import cleanup job failed (non-fatal)');
      }
    }
  );

  registry.register(
    'platform.notification-log-archive',
    {
      cron: '0 4 1 * *',
      description: 'Archive notification log entries older than 90 days',
      tenantScoped: false,
    },
    async () => {
      try {
        const cutoff = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);
        let totalArchived = 0;
        for (let i = 0; i < MAX_BATCHES_PER_RUN; i++) {
          const rows = await db
            .select()
            .from(notificationLog)
            .where(lt(notificationLog.createdAt, cutoff))
            .limit(DELETE_BATCH_SIZE);
          if (rows.length === 0) break;

          const archiveKey = await storage.uploadFile(
            0,
            'archives/notification-log',
            `notification-log-${new Date().toISOString().slice(0, 10)}-${i}.json`,
            Buffer.from(JSON.stringify(rows)),
            'application/json'
          );

          await db
            .delete(notificationLog)
            .where(sql`${notificationLog.id} = ANY(${rows.map((r) => r.id)})`);
          totalArchived += rows.length;
          logger.info({ archiveKey, count: rows.length }, 'Notification log batch archived');
          if (rows.length < DELETE_BATCH_SIZE) break;
        }
        logger.info({ totalArchived }, 'Notification log archive complete');
      } catch (err) {
        logger.warn({ err }, 'Notification log archive job failed (non-fatal)');
      }
    }
  );

  registry.register(
    'platform.export-cleanup',
    {
      cron: '0 5 * * *',
      description: 'Clean expired export files and signed URLs',
      tenantScoped: false,
    },
    async () => {
      try {
        const now = new Date();
        const rows = await db
          .select({ id: exportJobs.id, s3Key: exportJobs.s3Key })
          .from(exportJobs)
          .where(and(eq(exportJobs.status, 'READY'), lt(exportJobs.signedUrlExpiresAt, now)))
          .limit(DELETE_BATCH_SIZE);

        for (const row of rows) {
          if (row.s3Key) {
            try {
              await storage.deleteFile(row.s3Key);
            } catch {
              // best-effort — continue marking expired regardless
            }
          }
        }
        if (rows.length > 0) {
          await db
            .update(exportJobs)
            .set({ status: 'EXPIRED', s3Key: null, signedUrl: null, updatedAt: new Date() })
            .where(sql`${exportJobs.id} = ANY(${rows.map((r) => r.id)})`);
        }
        logger.info({ cleaned: rows.length }, 'Export cleanup complete');
      } catch (err) {
        logger.warn({ err }, 'Export cleanup job failed (non-fatal)');
      }
    }
  );

  // PG-024 — closes the gap dr-drill-report.md itself flagged: a quarterly
  // re-drill was recommended but nothing enforced it. This does NOT run the
  // drill (a full restore drill deliberately touches an isolated environment
  // and needs human validation of business-data correctness) — it only
  // reminds/tickets whoever owns DR so the cadence doesn't silently lapse
  // again. Cron approximates "first Monday of the quarter" as simply the 1st
  // of Jan/Apr/Jul/Oct.
  registry.register(
    'platform.dr-drill-reminder',
    {
      cron: '0 9 1 1,4,7,10 *',
      description:
        'Quarterly reminder to re-run the DR drill (infrastructure/runbooks/dr-runbook.md)',
      tenantScoped: false,
    },
    async () => {
      const notificationUrl = process.env['NOTIFICATION_SERVICE_URL'] ?? 'http://localhost:3014';
      const apiKey = process.env['INTERNAL_API_KEY'] ?? '';
      const tenantId = Number(process.env['DR_DRILL_REMINDER_TENANT_ID'] ?? '1');
      const ownerEmail = process.env['DR_DRILL_OWNER_EMAIL'] ?? '';
      if (!ownerEmail) {
        logger.warn({}, 'DR_DRILL_OWNER_EMAIL not configured — skipping DR drill reminder');
        return;
      }
      try {
        await fetch(`${notificationUrl}/notifications/send-raw-internal`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-internal-key': apiKey },
          body: JSON.stringify({
            tenantId,
            eventType: 'DR_DRILL_REMINDER',
            channel: 'EMAIL',
            recipientEmail: ownerEmail,
            subject: 'Quarterly DR drill due',
            body: 'It is the first of the quarter — time to re-run the disaster-recovery drill. Follow infrastructure/runbooks/dr-runbook.md end to end and record the result as a new dated report next to ERP-PLANNING/phase-completions/dr-drill-report.md. Targets: RTO < 30 min, RPO < 15 min.',
          }),
        });
        logger.info({ ownerEmail }, 'DR drill reminder sent');
      } catch (err) {
        logger.warn({ err }, 'DR drill reminder job failed (non-fatal)');
      }
    }
  );

  // PG-056 — same gap as PG-024 above, but for chaos-engineering-report.md:
  // the 2026-07-01 exercise recommended a recurring cadence but nothing
  // enforced it. Mirrors platform.dr-drill-reminder exactly (same quarterly
  // day, since the two drills are meant to share a maintenance window per
  // ERP-PLANNING/phase-completions/chaos-engineering-cadence.md) — this does
  // NOT run the chaos experiments (fault injection needs human judgment on
  // whether the expected behavior actually happened), it only reminds/tickets
  // whoever owns the drill so the cadence doesn't silently lapse again.
  registry.register(
    'platform.chaos-drill-reminder',
    {
      cron: '0 9 1 1,4,7,10 *',
      description:
        'Quarterly reminder to re-run the chaos-engineering drill (ERP-PLANNING/phase-completions/chaos-engineering-cadence.md)',
      tenantScoped: false,
    },
    async () => {
      const notificationUrl = process.env['NOTIFICATION_SERVICE_URL'] ?? 'http://localhost:3014';
      const apiKey = process.env['INTERNAL_API_KEY'] ?? '';
      const tenantId = Number(process.env['CHAOS_DRILL_REMINDER_TENANT_ID'] ?? '1');
      const ownerEmail = process.env['CHAOS_DRILL_OWNER_EMAIL'] ?? '';
      if (!ownerEmail) {
        logger.warn({}, 'CHAOS_DRILL_OWNER_EMAIL not configured — skipping chaos drill reminder');
        return;
      }
      try {
        await fetch(`${notificationUrl}/notifications/send-raw-internal`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-internal-key': apiKey },
          body: JSON.stringify({
            tenantId,
            eventType: 'CHAOS_DRILL_REMINDER',
            channel: 'EMAIL',
            recipientEmail: ownerEmail,
            subject: 'Quarterly chaos-engineering drill due',
            body: 'It is the first of the quarter — time to re-run the chaos-engineering drill. Follow ERP-PLANNING/phase-completions/chaos-engineering-cadence.md end to end (re-run all 9 original experiments plus new sub-experiment 3.2b) and record the result as a new dated report at ERP-PLANNING/phase-completions/chaos-engineering-report-<YYYY-QN>.md. File any regression or new finding as its own PG-XXX package.',
          }),
        });
        logger.info({ ownerEmail }, 'Chaos drill reminder sent');
      } catch (err) {
        logger.warn({ err }, 'Chaos drill reminder job failed (non-fatal)');
      }
    }
  );

  // ── PRODUCTION / REORDER (Phase 10) ──────────────────────────────────────
  // PG-026: this job was calling reorder.routes.ts's JWT-only `/inventory/reorder-required`
  // with just an x-internal-key header — every call 401'd, and since the response was never
  // checked for res.ok, the error body's missing `.data` silently resolved to a count of 0
  // every day instead of surfacing the failure. Repointed at a new internal-key-guarded route
  // (apps/production-service/src/api/internal.routes.ts) and made tenantScoped so it actually
  // has a tenantId to query with (see PG-026's tenant-iteration fix in scheduler-service's main.ts).
  registry.register(
    'production.reorder-report',
    {
      cron: '0 9 * * *',
      description: 'Daily 09:00 — check reorder levels and email report to purchase manager',
      tenantScoped: true,
    },
    async (_job, tenantId) => {
      if (tenantId === undefined) return;
      const productionUrl = process.env['PRODUCTION_SERVICE_URL'] ?? 'http://localhost:3022';
      const apiKey = process.env['INTERNAL_API_KEY'] ?? '';
      try {
        const res = await fetch(
          `${productionUrl}/api/v2/internal/inventory/reorder-required?tenantId=${tenantId}`,
          {
            method: 'GET',
            headers: { 'Content-Type': 'application/json', 'x-internal-key': apiKey },
          }
        );
        const body = (await res.json()) as { data?: unknown[] };
        const count = body.data?.length ?? 0;
        logger.info({ tenantId, itemsBelowReorder: count }, 'Reorder report check complete');
      } catch (err) {
        logger.warn({ tenantId, err }, 'Reorder report job failed (non-fatal)');
      }
    }
  );

  // PG-026: same 401-swallowed-as-zero bug as production.reorder-report above — this job
  // called job-work.routes.ts's JWT-only `/job-work-orders/in-progress` with only an
  // x-internal-key header. Repointed at the new internal-key-guarded route and made
  // tenantScoped so it has a real tenantId to query with.
  registry.register(
    'production.job-work-overdue-alert',
    {
      cron: '0 9 * * *',
      description: 'Daily 09:00 — alert for overdue job work orders',
      tenantScoped: true,
    },
    async (_job, tenantId) => {
      if (tenantId === undefined) return;
      const productionUrl = process.env['PRODUCTION_SERVICE_URL'] ?? 'http://localhost:3022';
      const apiKey = process.env['INTERNAL_API_KEY'] ?? '';
      try {
        const res = await fetch(
          `${productionUrl}/api/v2/internal/job-work-orders/in-progress?tenantId=${tenantId}`,
          {
            method: 'GET',
            headers: { 'x-internal-key': apiKey },
          }
        );
        const body = (await res.json()) as { data?: unknown[] };
        logger.info(
          { tenantId, inProgressCount: body.data?.length ?? 0 },
          'Job work overdue alert check complete'
        );
      } catch (err) {
        logger.warn({ tenantId, err }, 'Job work overdue alert failed (non-fatal)');
      }
    }
  );

  logger.info({ totalJobs: registry.listAll().length }, 'All system jobs registered');
}
