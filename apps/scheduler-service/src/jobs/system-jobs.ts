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
  tenants,
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
    'accounting.depreciation.monthly-run',
    {
      cron: '0 3 1 * *',
      description: 'Post monthly depreciation for all active fixed assets',
      tenantScoped: true,
    },
    async (_job, tenantId) => {
      if (tenantId === undefined) return;
      const accountingUrl = process.env['ACCOUNTING_SERVICE_URL'] ?? 'http://localhost:3019';
      const apiKey = process.env['INTERNAL_API_KEY'] ?? '';
      try {
        const res = await fetch(
          `${accountingUrl}/api/v2/internal/fixed-assets/depreciation/run?tenantId=${tenantId}`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'x-internal-key': apiKey },
          }
        );
        const body = (await res.json()) as { data?: { processed?: number; errors?: number } };
        logger.info(
          { tenantId, processed: body.data?.processed, errors: body.data?.errors },
          'Monthly depreciation batch complete'
        );
      } catch (err) {
        logger.warn({ tenantId, err }, 'Monthly depreciation job failed (non-fatal)');
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

  // Detection job for the "phantom zero-value journal" bug class (2026-07-31 product audit):
  // a Kafka event-payload field-name drift between a producer and its accounting consumer
  // (e.g. ExpenseAccountingConsumer reading p.grandTotal when the producer sent totalAmount)
  // has independently caused a real journal to be posted — tied to a real business document
  // via reference_type/reference_id — where every financial_entries line for it is debit=0
  // AND credit=0. This has already recurred at least 3 times (expense, sale-return, and one
  // earlier instance), each found only by a manual QA pass. This job closes that detection gap
  // permanently rather than waiting for the next QA pass to notice by chance. Read-only —
  // flags, never auto-corrects (a wrong journal needs a human to trace the real root cause).
  registry.register(
    'accounting.zero-value-journal-audit',
    {
      cron: '0 6 * * *',
      description:
        'Flag journals linked to a real business document that posted zero value on every line (regression guard for the recurring producer/consumer field-drift bug class)',
      tenantScoped: true,
    },
    async (_job, tenantId) => {
      if (tenantId === undefined) return;
      try {
        const rows = (await db.execute(sql`
          SELECT j.journal_id, j.reference_type, j.reference_id, j.posted_at
          FROM journals j
          JOIN financial_entries fe
            ON fe.journal_id = j.journal_id AND fe.tenant_id = j.tenant_id
          WHERE j.tenant_id = ${tenantId}
            AND j.status = 'POSTED'
            AND j.reference_type IS NOT NULL
            AND j.posted_at >= NOW() - INTERVAL '2 days'
          GROUP BY j.journal_id, j.reference_type, j.reference_id, j.posted_at
          HAVING SUM(fe.debit_amount) = 0 AND SUM(fe.credit_amount) = 0
          ORDER BY j.posted_at DESC
        `)) as unknown as Array<{
          journal_id: string;
          reference_type: string;
          reference_id: number | null;
          posted_at: string;
        }>;

        if (rows.length > 0) {
          const [tenant] = await db
            .select({ contactEmail: tenants.contactEmail })
            .from(tenants)
            .where(eq(tenants.id, tenantId));
          if (tenant?.contactEmail) {
            const notificationUrl =
              process.env['NOTIFICATION_SERVICE_URL'] ?? 'http://localhost:3014';
            const apiKey = process.env['INTERNAL_API_KEY'] ?? '';
            try {
              await fetch(`${notificationUrl}/notifications/send-raw-internal`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'x-internal-key': apiKey },
                body: JSON.stringify({
                  tenantId,
                  eventType: 'ZERO_VALUE_JOURNAL_DETECTED',
                  channel: 'EMAIL',
                  recipientEmail: tenant.contactEmail,
                  subject: `${rows.length} accounting journal(s) posted with zero value`,
                  body: `The following journal(s) are linked to a real ${rows.length === 1 ? 'document' : 'documents'} but posted zero debit/credit on every line — this usually means a data field was dropped between two services and needs investigation: ${rows
                    .map(
                      (r) => `${r.journal_id} (${r.reference_type} #${r.reference_id ?? 'unknown'})`
                    )
                    .join(', ')}`,
                }),
              });
            } catch {
              // best-effort
            }
          }
        }
        logger.info(
          { tenantId, zeroValueJournals: rows.length },
          'Zero-value journal audit complete'
        );
      } catch (err) {
        logger.warn({ tenantId, err }, 'Zero-value journal audit job failed (non-fatal)');
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
      // Intentionally log-only: this runs 1hr before production.reorder-report, which is the job
      // that actually emails the purchase manager — this one exists purely as an early ops-log
      // signal, so the same list isn't emailed to the same person twice within an hour.
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

  // Multi-vertical platform audit 2026-08-16, Phase 1: batch/expiry now reaches
  // inventory_fifo_layers (GRNService.approve()) — this closes the loop by publishing a
  // STOCK_NEAR_EXPIRY event per near-expiring layer. automation-service already subscribes to
  // every EventTypes topic, so any tenant-authored EVENT-triggered workflow_definition
  // listening for STOCK_NEAR_EXPIRY fires with zero automation-service code changes.
  registry.register(
    'inventory.near-expiry-alert',
    {
      cron: '0 7 * * *',
      description: 'Publish STOCK_NEAR_EXPIRY for FIFO layers expiring within 3 days',
      tenantScoped: false,
    },
    async (_job) => {
      const inventoryUrl = process.env['INVENTORY_SERVICE_URL'] ?? 'http://localhost:3012';
      const apiKey = process.env['INTERNAL_API_KEY'] ?? '';
      try {
        const res = await inventoryServiceBreaker.fire(
          inventoryUrl,
          '/api/v2/inventory/near-expiry-alert',
          apiKey
        );
        const body = (await res.json()) as {
          data?: { checked?: number; alertsPublished?: number };
        };
        logger.info(
          { checked: body.data?.checked, alertsPublished: body.data?.alertsPublished },
          'Near-expiry alert check complete'
        );
      } catch (err) {
        logger.warn({ err }, 'Near-expiry alert job failed (non-fatal)');
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
      tenantScoped: true,
    },
    // Notification-service audit 2026-07-23, bug #5: previously called the JWT-only GET
    // /api/v2/gst/eway-bill/expiring-soon with only an x-internal-key header — 401'd on every
    // run, swallowed into a non-fatal warn log — and even on success only logged a count rather
    // than notifying anyone. Repointed at the new internal-key-guarded POST
    // /api/v2/gst/eway-bill/expiry-alert (same shape as PG-026's fix for
    // production.reorder-report), made tenantScoped so it has a real tenantId to query and email
    // with.
    async (_job, tenantId) => {
      if (tenantId === undefined) return;
      const gstUrl = process.env['GST_SERVICE_URL'] ?? 'http://localhost:3018';
      const apiKey = process.env['INTERNAL_API_KEY'] ?? '';
      try {
        const res = await fetch(
          `${gstUrl}/api/v2/gst/eway-bill/expiry-alert?tenantId=${tenantId}`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'x-internal-key': apiKey },
          }
        );
        const body = (await res.json()) as { data?: { totalElements?: number; sent?: boolean } };
        logger.info(
          { tenantId, totalElements: body.data?.totalElements, sent: body.data?.sent },
          'e-Way Bill expiry check complete'
        );
      } catch (err) {
        logger.warn({ tenantId, err }, 'e-Way Bill expiry check failed (non-fatal)');
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

  // Detection job for the recurring "producer/consumer event-payload contract drift" bug
  // class (2026-07-31 product audit) — this module alone had 4 confirmed instances (invoice
  // tax lines, sale-return GST ledger, RCM tax amount, CDNR classification), all with the same
  // shape: a gst_ledger row gets written with a real taxable amount but the tax fields never
  // actually populated. Flags two signatures: (a) gst_rate left NULL (the producer never sent
  // it — always a bug, a genuinely nil-rated/exempt supply still gets an explicit rate of 0,
  // not null); (b) a nonzero gst_rate with a nonzero taxable amount but CGST+SGST+IGST all zero
  // (a rate that should have produced tax but didn't — the exact shape of the RCM tax-amount
  // bug). Read-only — flags, never auto-corrects.
  registry.register(
    'gst.ledger-completeness-audit',
    {
      cron: '0 6 * * *',
      description:
        'Flag gst_ledger rows with a missing or inconsistent tax rate/amount (regression guard for the recurring producer/consumer field-drift bug class)',
      tenantScoped: true,
    },
    async (_job, tenantId) => {
      if (tenantId === undefined) return;
      try {
        const rows = (await db.execute(sql`
          SELECT id, entry_type, document_number, source_document_type, source_document_id
          FROM gst_ledger
          WHERE tenant_id = ${tenantId}
            AND created_at >= NOW() - INTERVAL '2 days'
            AND (
              gst_rate IS NULL
              OR (
                gst_rate > 0
                AND taxable_amount > 0
                AND cgst_amount = 0
                AND sgst_amount = 0
                AND igst_amount = 0
              )
            )
          ORDER BY created_at DESC
        `)) as unknown as Array<{
          id: number;
          entry_type: string;
          document_number: string;
          source_document_type: string | null;
          source_document_id: number | null;
        }>;

        if (rows.length > 0) {
          const [tenant] = await db
            .select({ contactEmail: tenants.contactEmail })
            .from(tenants)
            .where(eq(tenants.id, tenantId));
          if (tenant?.contactEmail) {
            const notificationUrl =
              process.env['NOTIFICATION_SERVICE_URL'] ?? 'http://localhost:3014';
            const apiKey = process.env['INTERNAL_API_KEY'] ?? '';
            try {
              await fetch(`${notificationUrl}/notifications/send-raw-internal`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'x-internal-key': apiKey },
                body: JSON.stringify({
                  tenantId,
                  eventType: 'GST_LEDGER_INCOMPLETE_ROW_DETECTED',
                  channel: 'EMAIL',
                  recipientEmail: tenant.contactEmail,
                  subject: `${rows.length} GST ledger entr${rows.length === 1 ? 'y has' : 'ies have'} a missing or inconsistent tax rate/amount`,
                  body: `The following GST ledger entries have a missing gst_rate or a nonzero rate that produced zero tax — this usually means a data field was dropped between two services and needs investigation before the next return is filed: ${rows
                    .map(
                      (r) =>
                        `${r.document_number} (${r.entry_type}, ${r.source_document_type ?? 'unknown'} #${r.source_document_id ?? 'unknown'})`
                    )
                    .join(', ')}`,
                }),
              });
            } catch {
              // best-effort
            }
          }
        }
        logger.info(
          { tenantId, incompleteGstLedgerRows: rows.length },
          'GST ledger completeness audit complete'
        );
      } catch (err) {
        logger.warn({ tenantId, err }, 'GST ledger completeness audit job failed (non-fatal)');
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
      // Security/correctness audit: this used to swallow every failure (network error AND
      // non-2xx response) into a `logger.warn` with no rethrow — since JobRegistry's worker
      // only lets BullMQ's attempts:3/exponential-backoff retry fire when the handler
      // actually throws, a swallowed error meant the job was marked COMPLETED and never
      // retried. A brief hr-service outage at 1 AM on the 25th meant that tenant's payroll
      // prep for the month silently never ran, with no automated retry and nothing beyond a
      // log line to notice it. Now checks res.ok and rethrows on any failure.
      const res = await fetch(`${hrUrl}/api/v2/internal/payroll/prepare?tenantId=${tenantId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-internal-key': apiKey },
      });
      if (!res.ok) {
        throw new Error(`Payroll prepare failed: HTTP ${res.status} ${await res.text()}`);
      }
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
      // See hr.payroll.prepare's comment above — same swallow-and-never-retry gap, same fix.
      const res = await fetch(`${hrUrl}/api/v2/internal/payroll/send-slips?tenantId=${tenantId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-internal-key': apiKey },
      });
      if (!res.ok) {
        throw new Error(
          `Salary slip email dispatch failed: HTTP ${res.status} ${await res.text()}`
        );
      }
      const body = (await res.json()) as { data?: { payrollRunId?: number; count?: number } };
      logger.info(
        { tenantId, payrollRunId: body.data?.payrollRunId, count: body.data?.count },
        'Salary slip email dispatch complete'
      );
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

  // CRM-ROADMAP Phase 2, Feature 3 — only meaningful now that earnPoints() actually sets
  // expiry_date on EARN transactions (see LoyaltyService.ts's own comment on the pipeline that
  // never fired before this feature). Runs at 01:30, an hour before the expiry job itself, so a
  // customer is warned before their points are actually deducted the following night.
  registry.register(
    'sales.loyalty-points-expiry-warning',
    {
      cron: '30 1 * * *',
      description: 'Warn customers whose loyalty points are expiring within 30 days',
      tenantScoped: false,
    },
    async (_job) => {
      const salesUrl = process.env['SALES_SERVICE_URL'] ?? 'http://localhost:3013';
      const apiKey = process.env['INTERNAL_API_KEY'] ?? '';
      try {
        const res = await fetch(`${salesUrl}/api/v2/loyalty/expiry-warnings/send`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-internal-key': apiKey },
        });
        const body = (await res.json()) as {
          data?: { tenantsProcessed?: number; candidateCount?: number; sent?: number };
        };
        if ((body.data?.candidateCount ?? 0) > 0) {
          logger.info(
            { candidateCount: body.data?.candidateCount, sent: body.data?.sent },
            'Loyalty points expiry-warning dispatch complete'
          );
        }
      } catch (err) {
        logger.warn({ err }, 'Loyalty points expiry-warning job failed (non-fatal)');
      }
    }
  );

  // CRM-ROADMAP Phase 2, Feature 4 — daily referral-payout attribution (all active tenants).
  registry.register(
    'crm.referral-attribution',
    {
      cron: '0 5 * * *',
      description: 'Pay out referral rewards once the referee has a qualifying purchase',
      tenantScoped: false,
    },
    async (_job) => {
      const salesUrl = process.env['SALES_SERVICE_URL'] ?? 'http://localhost:3013';
      const apiKey = process.env['INTERNAL_API_KEY'] ?? '';
      try {
        const res = await fetch(`${salesUrl}/api/v2/referral/attribute-purchases`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-internal-key': apiKey },
        });
        const body = (await res.json()) as {
          data?: { tenantsProcessed?: number; totalPaid?: number };
        };
        if ((body.data?.totalPaid ?? 0) > 0) {
          logger.info(
            { tenantsProcessed: body.data?.tenantsProcessed, totalPaid: body.data?.totalPaid },
            'Referral payout attribution complete'
          );
        }
      } catch (err) {
        logger.warn({ err }, 'Referral payout attribution job failed (non-fatal)');
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

  // Product audit 2026-07-31, Phase 1 Step 10: staged payment-reminder ladder. Off by default
  // per-tenant (tenant_communication_settings.payment_reminder_enabled) — sends real
  // customer-facing messages, so a tenant must explicitly opt in rather than this silently
  // activating for everyone. EMAIL-only deliberately: SMS/WhatsApp for this event type would
  // need a registered DLT template first (NotificationEngine.sendRaw's hard compliance gate —
  // see the CRM DLT/TRAI compliance work), which is a separate, later decision, not bundled
  // into this pass. invoice_reminder_log (migration 0150) dedupes so each of the 4 stages
  // (due today, 7/15/30 days overdue) only ever fires once per invoice; the highest threshold
  // an invoice has newly crossed since the last run is the one sent, not a backfill of every
  // missed stage.
  registry.register(
    'sales.payment-reminder-ladder',
    {
      cron: '0 10 * * *',
      description: 'Daily 10:00 — staged overdue-invoice payment reminders (0/7/15/30 days)',
      tenantScoped: true,
    },
    async (_job, tenantId) => {
      if (tenantId === undefined) return;
      try {
        const [settings] = (await db.execute(sql`
          SELECT payment_reminder_enabled FROM tenant_communication_settings WHERE tenant_id = ${tenantId}
        `)) as unknown as Array<{ payment_reminder_enabled: boolean }>;
        if (!settings?.payment_reminder_enabled) {
          logger.info({ tenantId }, 'Payment reminder ladder not enabled for tenant — skipping');
          return;
        }

        const overdueInvoices = (await db.execute(sql`
          SELECT
            i.id, i.invoice_number, i.balance_due, c.email AS customer_email, c.display_name AS customer_name,
            GREATEST(0, EXTRACT(DAY FROM (NOW() - i.due_date))::int) AS days_overdue
          FROM invoices i
          JOIN customers c ON c.id = i.customer_id AND c.tenant_id = i.tenant_id
          WHERE i.tenant_id = ${tenantId}
            AND i.status IN ('CONFIRMED', 'PARTIALLY_PAID', 'OVERDUE')
            AND i.balance_due > 0
            AND i.due_date < NOW()
            AND c.email IS NOT NULL
        `)) as unknown as Array<{
          id: number;
          invoice_number: string;
          balance_due: string;
          customer_email: string;
          customer_name: string;
          days_overdue: number;
        }>;

        if (overdueInvoices.length === 0) {
          logger.info({ tenantId }, 'Payment reminder ladder: no overdue invoices');
          return;
        }

        const alreadySent = (await db.execute(sql`
          SELECT invoice_id, stage FROM invoice_reminder_log
          WHERE tenant_id = ${tenantId}
            AND invoice_id = ANY(${sql.raw(`ARRAY[${overdueInvoices.map((i) => i.id).join(',')}]`)})
        `)) as unknown as Array<{ invoice_id: number; stage: string }>;
        const sentKey = (invoiceId: number, stage: string) => `${invoiceId}:${stage}`;
        const alreadySentSet = new Set(alreadySent.map((r) => sentKey(r.invoice_id, r.stage)));

        // Highest threshold first — an invoice that's 40 days overdue gets DAY_30, not a
        // backfill of DAY_0/7/15 it also technically crossed.
        const STAGES: Array<{ stage: 'DAY_30' | 'DAY_15' | 'DAY_7' | 'DAY_0'; threshold: number }> =
          [
            { stage: 'DAY_30', threshold: 30 },
            { stage: 'DAY_15', threshold: 15 },
            { stage: 'DAY_7', threshold: 7 },
            { stage: 'DAY_0', threshold: 0 },
          ];

        const notificationUrl = process.env['NOTIFICATION_SERVICE_URL'] ?? 'http://localhost:3014';
        const apiKey = process.env['INTERNAL_API_KEY'] ?? '';
        let sentCount = 0;

        for (const inv of overdueInvoices) {
          const due = STAGES.find(
            (s) => inv.days_overdue >= s.threshold && !alreadySentSet.has(sentKey(inv.id, s.stage))
          );
          if (!due) continue;

          try {
            await fetch(`${notificationUrl}/notifications/send-raw-internal`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', 'x-internal-key': apiKey },
              body: JSON.stringify({
                tenantId,
                eventType: 'PAYMENT_REMINDER',
                channel: 'EMAIL',
                recipientEmail: inv.customer_email,
                subject: `Payment reminder: Invoice ${inv.invoice_number}`,
                body:
                  due.stage === 'DAY_0'
                    ? `Dear ${inv.customer_name}, invoice ${inv.invoice_number} for ₹${inv.balance_due} is now due. Please arrange payment at your earliest convenience.`
                    : `Dear ${inv.customer_name}, invoice ${inv.invoice_number} for ₹${inv.balance_due} is ${inv.days_overdue} day(s) overdue. Please arrange payment as soon as possible to avoid further action.`,
              }),
            });

            await db.execute(sql`
              INSERT INTO invoice_reminder_log (tenant_id, invoice_id, stage)
              VALUES (${tenantId}, ${inv.id}, ${due.stage})
              ON CONFLICT (tenant_id, invoice_id, stage) DO NOTHING
            `);
            sentCount += 1;

            // Escalate to the tenant's own contact at the final (30-day) stage — this codebase
            // has no per-customer assigned-rep concept to notify instead (see the sales-service
            // schema: customers has no ownerId/assignedRepId field).
            if (due.stage === 'DAY_30') {
              const [tenant] = await db
                .select({ contactEmail: tenants.contactEmail })
                .from(tenants)
                .where(eq(tenants.id, tenantId));
              if (tenant?.contactEmail) {
                try {
                  await fetch(`${notificationUrl}/notifications/send-raw-internal`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', 'x-internal-key': apiKey },
                    body: JSON.stringify({
                      tenantId,
                      eventType: 'PAYMENT_REMINDER_ESCALATION',
                      channel: 'EMAIL',
                      recipientEmail: tenant.contactEmail,
                      subject: `Invoice ${inv.invoice_number} is 30+ days overdue`,
                      body: `Invoice ${inv.invoice_number} (₹${inv.balance_due}, customer: ${inv.customer_name}) is ${inv.days_overdue} days overdue and has not been resolved by the standard reminder ladder.`,
                    }),
                  });
                } catch {
                  // best-effort
                }
              }
            }
          } catch (err) {
            logger.warn(
              { tenantId, invoiceId: inv.id, err },
              'Payment reminder send failed (non-fatal)'
            );
          }
        }

        logger.info(
          { tenantId, overdueCount: overdueInvoices.length, sentCount },
          'Payment reminder ladder run complete'
        );
      } catch (err) {
        logger.warn({ tenantId, err }, 'Payment reminder ladder job failed (non-fatal)');
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

  // CRM-ROADMAP Phase 2, Feature 7 (Advanced Segmentation Engine) — nightly, not weekly like
  // health-score above, since segment membership (used for campaign targeting) should reflect
  // yesterday's purchases, not last week's.
  registry.register(
    'crm.segment-membership-refresh',
    {
      cron: '0 3 * * *',
      description: 'Nightly refresh of behavioral-segment membership cache (03:00)',
      tenantScoped: false,
    },
    async (_job) => {
      const salesUrl = process.env['SALES_SERVICE_URL'] ?? 'http://localhost:3013';
      const apiKey = process.env['INTERNAL_API_KEY'] ?? '';
      try {
        const res = await fetch(`${salesUrl}/api/v2/crm/segment-membership/refresh`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-internal-key': apiKey },
        });
        const body = (await res.json()) as {
          data?: {
            tenantsProcessed?: number;
            segmentsRefreshed?: number;
            customersCached?: number;
          };
        };
        logger.info(
          {
            tenantsProcessed: body.data?.tenantsProcessed,
            segmentsRefreshed: body.data?.segmentsRefreshed,
            customersCached: body.data?.customersCached,
          },
          'Segment membership cache refresh complete'
        );
      } catch (err) {
        logger.warn({ err }, 'Segment membership refresh job failed (non-fatal)');
      }
    }
  );

  // CRM-ROADMAP Phase 2, Feature 6 — nightly, so a purchase made the same day as (or shortly
  // after) a campaign send gets attributed within a day, not a week.
  registry.register(
    'crm.campaign-conversion-attribution',
    {
      cron: '0 4 * * *',
      description: 'Nightly campaign-conversion attribution (04:00)',
      tenantScoped: false,
    },
    async (_job) => {
      const salesUrl = process.env['SALES_SERVICE_URL'] ?? 'http://localhost:3013';
      const apiKey = process.env['INTERNAL_API_KEY'] ?? '';
      try {
        const res = await fetch(`${salesUrl}/api/v2/crm/campaign-conversions/attribute`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-internal-key': apiKey },
        });
        const body = (await res.json()) as {
          data?: { tenantsProcessed?: number; totalConverted?: number };
        };
        logger.info(
          {
            tenantsProcessed: body.data?.tenantsProcessed,
            totalConverted: body.data?.totalConverted,
          },
          'Campaign conversion attribution complete'
        );
      } catch (err) {
        logger.warn({ err }, 'Campaign conversion attribution job failed (non-fatal)');
      }
    }
  );

  // CRM-ROADMAP Phase 3, Feature 1 (AI & Predictive Intelligence Suite) — nightly, never
  // computed synchronously on Customer 360 page load (07-PERFORMANCE-PLAN.md §3). A customer
  // flagged high-risk who makes a large purchase mid-day sees their prediction update on the
  // NEXT run — up to ~24h staleness, an explicit, accepted tradeoff, not an oversight.
  registry.register(
    'crm.ai-predictions-compute',
    {
      cron: '0 5 * * *',
      description: 'Nightly churn/next-best-action/product-recommendation scoring (05:00)',
      tenantScoped: false,
    },
    async (_job) => {
      const salesUrl = process.env['SALES_SERVICE_URL'] ?? 'http://localhost:3013';
      const apiKey = process.env['INTERNAL_API_KEY'] ?? '';
      try {
        const res = await fetch(`${salesUrl}/api/v2/crm/predictions/compute`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-internal-key': apiKey },
        });
        const body = (await res.json()) as {
          data?: { tenantsProcessed?: number; customersProcessed?: number };
        };
        logger.info(
          {
            tenantsProcessed: body.data?.tenantsProcessed,
            customersProcessed: body.data?.customersProcessed,
          },
          'AI predictions computation complete'
        );
      } catch (err) {
        logger.warn({ err }, 'AI predictions computation job failed (non-fatal)');
      }
    }
  );

  // CRM-ROADMAP Phase 4, Feature 3 (Festival Intelligence AI) — genuinely nightly, same as the
  // AI-predictions job above, even though seasons themselves are infrequent: the compute logic
  // only ever writes a suggestion row when a tenant has a completed prior-year season to compare
  // against, so most nightly runs for most tenants are a cheap no-op rather than a real seasonal
  // cadence needing its own scheduling shape.
  registry.register(
    'crm.festival-suggestions-compute',
    {
      cron: '0 6 * * *',
      description: 'Nightly festival/season stock+loyalty multiplier suggestions (06:00)',
      tenantScoped: false,
    },
    async (_job) => {
      const salesUrl = process.env['SALES_SERVICE_URL'] ?? 'http://localhost:3013';
      const apiKey = process.env['INTERNAL_API_KEY'] ?? '';
      try {
        const res = await fetch(`${salesUrl}/api/v2/crm/festival-suggestions/compute`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-internal-key': apiKey },
        });
        const body = (await res.json()) as {
          data?: { tenantsProcessed?: number; suggestionsWritten?: number };
        };
        logger.info(
          {
            tenantsProcessed: body.data?.tenantsProcessed,
            suggestionsWritten: body.data?.suggestionsWritten,
          },
          'Festival suggestion computation complete'
        );
      } catch (err) {
        logger.warn({ err }, 'Festival suggestion computation job failed (non-fatal)');
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

  // CP-5: the dispatch-due internal route (fires enabled campaignAutomationRules) has existed
  // since CP-5 but was never wired to a cron job — confirmed via CP-5's own completion report,
  // which explicitly deferred "mirror the existing crm.campaign-dispatch job registration."
  // Automation rules have never fired in production as a result. Every-5-minutes matches the
  // cadence of every other CRM dispatch job above.
  registry.register(
    'crm.automation-rules-dispatch-due',
    {
      cron: '*/5 * * * *',
      description:
        'Every 5 minutes — fire enabled campaign automation rules not already fired today',
      tenantScoped: false,
    },
    async (_job) => {
      const salesUrl = process.env['SALES_SERVICE_URL'] ?? 'http://localhost:3013';
      const apiKey = process.env['INTERNAL_API_KEY'] ?? '';
      try {
        const res = await fetch(`${salesUrl}/api/v2/crm/automation-rules/dispatch-due`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-internal-key': apiKey },
        });
        const body = (await res.json()) as {
          data?: { evaluated?: number; fired?: number; skipped?: number; failed?: number };
        };
        if ((body.data?.fired ?? 0) > 0) {
          logger.info(
            { evaluated: body.data?.evaluated, fired: body.data?.fired, failed: body.data?.failed },
            'Automation rule dispatch complete'
          );
        }
      } catch (err) {
        logger.warn({ err }, 'Automation rule dispatch job failed (non-fatal)');
      }
    }
  );

  // CRM-ROADMAP Phase 2, Feature 2 (Visual Customer Journey Builder) — per AR-3, journeys
  // compile to this same scheduler-cron mechanism. Every 5 minutes matches crm.campaign-dispatch
  // and crm.automation-rules-dispatch-due above; per-tick cost scales with active enrollments,
  // not journey count (JourneyService.evaluateDueEnrollments only loads PUBLISHED journeys and
  // their currently-due enrollments).
  registry.register(
    'crm.journey-step-evaluate',
    {
      cron: '*/5 * * * *',
      description: 'Every 5 minutes — enroll new segment matches and evaluate due journey steps',
      tenantScoped: false,
    },
    async (_job) => {
      const salesUrl = process.env['SALES_SERVICE_URL'] ?? 'http://localhost:3013';
      const apiKey = process.env['INTERNAL_API_KEY'] ?? '';
      try {
        const res = await fetch(`${salesUrl}/api/v2/crm/journeys/evaluate-due`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-internal-key': apiKey },
        });
        const body = (await res.json()) as {
          data?: {
            tenantsProcessed?: number;
            enrolled?: number;
            evaluated?: number;
            failed?: number;
          };
        };
        if ((body.data?.enrolled ?? 0) > 0 || (body.data?.evaluated ?? 0) > 0) {
          logger.info(
            {
              tenantsProcessed: body.data?.tenantsProcessed,
              enrolled: body.data?.enrolled,
              evaluated: body.data?.evaluated,
              failed: body.data?.failed,
            },
            'Journey step evaluation complete'
          );
        }
      } catch (err) {
        logger.warn({ err }, 'Journey step evaluation job failed (non-fatal)');
      }
    }
  );

  // CRM-ROADMAP Phase 1, Feature 4 (Support & Ticketing): sweeps open tickets past their
  // sla_due_at, marks them breached, and dispatches an escalation notification to the
  // assignee — all on the sales-service side (see internal.routes.ts's own comment on why
  // the notification dispatch lives there, not here). Every 5 minutes matches this
  // codebase's existing SLA-sensitive cadence (gst.e-invoice-retry, inventory.reservation-expiry).
  registry.register(
    'crm.ticket-sla-breach-sweep',
    {
      cron: '*/5 * * * *',
      description: 'Every 5 minutes — flag tickets past their SLA and escalate to the assignee',
      tenantScoped: true,
    },
    async (_job, tenantId) => {
      if (tenantId === undefined) return;
      const salesUrl = process.env['SALES_SERVICE_URL'] ?? 'http://localhost:3013';
      const apiKey = process.env['INTERNAL_API_KEY'] ?? '';
      try {
        const res = await fetch(
          `${salesUrl}/api/v2/crm/tickets/sla-breach-sweep?tenantId=${tenantId}`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'x-internal-key': apiKey },
          }
        );
        const body = (await res.json()) as { data?: { breachedCount?: number } };
        if ((body.data?.breachedCount ?? 0) > 0) {
          logger.info(
            { tenantId, breachedCount: body.data?.breachedCount },
            'Ticket SLA-breach sweep complete'
          );
        }
      } catch (err) {
        logger.warn({ tenantId, err }, 'Ticket SLA-breach sweep job failed (non-fatal)');
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
  // Fixed 2026-07-17: workflowApprovals.approverId now holds a real user id (WorkflowEngine
  // .resolveApprovers resolves ROLE nodes to every active user holding that role, one approval
  // row each), so getPendingForApprover(userId) and the bulk updates below correctly target
  // real approvers.
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
      // Notification-service audit 2026-07-23, bug #1: this job previously only bumped
      // reminderCount/notifiedAt bookkeeping and never actually notified the approver —
      // "Send reminders" sent nothing. Now dispatches a real IN_APP reminder per pending
      // approval (best-effort per-approval — one delivery failure doesn't block the rest).
      const notificationUrl = process.env['NOTIFICATION_SERVICE_URL'] ?? 'http://localhost:3014';
      const apiKey = process.env['INTERNAL_API_KEY'] ?? '';
      try {
        const pending = await db
          .select({
            id: workflowApprovals.id,
            nodeName: workflowApprovals.nodeName,
            approverId: workflowApprovals.approverId,
            instanceId: workflowApprovals.instanceId,
          })
          .from(workflowApprovals)
          .where(
            and(eq(workflowApprovals.tenantId, tenantId), eq(workflowApprovals.action, 'PENDING'))
          );

        let reminded = 0;
        for (const approval of pending) {
          const [instance] = await db
            .select({
              entityType: workflowInstances.entityType,
              entityId: workflowInstances.entityId,
            })
            .from(workflowInstances)
            .where(eq(workflowInstances.id, approval.instanceId));

          try {
            const res = await fetch(`${notificationUrl}/notifications/send-raw-internal`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', 'x-internal-key': apiKey },
              body: JSON.stringify({
                tenantId,
                eventType: 'WORKFLOW_APPROVAL_REMINDER',
                channel: 'IN_APP',
                recipientUserId: approval.approverId,
                body: `Reminder: "${approval.nodeName}" approval is pending your action${
                  instance ? ` for ${instance.entityType} #${instance.entityId}` : ''
                }.`,
              }),
            });
            if (res.ok) reminded++;
          } catch (err) {
            logger.warn(
              { tenantId, approvalId: approval.id, err },
              'Workflow approval reminder delivery failed for one approval (non-fatal)'
            );
          }

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
          { tenantId, pendingCount: pending.length, reminded },
          'Workflow approval reminder complete'
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

  // ── NOTIFICATIONS ─────────────────────────────────────────────────────────
  // Notification-service audit 2026-07-23: a FAILED notification (all delivery attempts
  // exhausted) previously had no automated re-drive at all — it stayed FAILED forever.
  // This periodically re-queues recent FAILED rows via the
  // POST /notifications/retry-failed-internal sweep (capped at 9 cumulative attempts
  // server-side, see NotificationEngine.MAX_TOTAL_ATTEMPTS, so a permanently-bad recipient
  // doesn't retry forever). Architectural tier update: delivery is now queue-based
  // (DeliveryQueue/BullMQ) — re-queuing is fire-and-forget from this job's perspective, the real
  // outcome lands asynchronously on notification_log via the queue worker.
  registry.register(
    'notification.retry-failed',
    {
      cron: '*/15 * * * *',
      description: 'Retry recent FAILED notifications up to the per-notification attempt cap',
      tenantScoped: true,
    },
    async (_job, tenantId) => {
      if (tenantId === undefined) return;
      const notificationUrl = process.env['NOTIFICATION_SERVICE_URL'] ?? 'http://localhost:3014';
      const apiKey = process.env['INTERNAL_API_KEY'] ?? '';
      try {
        const res = await fetch(
          `${notificationUrl}/notifications/retry-failed-internal?tenantId=${tenantId}`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'x-internal-key': apiKey },
          }
        );
        const body = (await res.json()) as { data?: { requeued?: number } };
        if ((body.data?.requeued ?? 0) > 0) {
          logger.info(
            { tenantId, requeued: body.data?.requeued },
            'Notification retry sweep complete'
          );
        }
      } catch (err) {
        logger.warn({ tenantId, err }, 'Notification retry sweep failed (non-fatal)');
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
        const body = (await res.json()) as { data?: Array<{ itemCode?: string; name?: string }> };
        const items = body.data ?? [];
        // Notification-service audit 2026-07-23, bug #3: this job's own description promises
        // "email report to purchase manager" but previously only logged the count — nothing was
        // ever emailed. inventory.low-stock-alert (1hr earlier) hits the same endpoint as a
        // lightweight log-only early signal; this job is now the one that actually notifies, so
        // the purchase manager isn't emailed twice for the same list.
        let sent = false;
        if (items.length > 0) {
          const notificationUrl =
            process.env['NOTIFICATION_SERVICE_URL'] ?? 'http://localhost:3014';
          const [tenant] = await db
            .select({ contactEmail: tenants.contactEmail })
            .from(tenants)
            .where(eq(tenants.id, tenantId));
          if (tenant?.contactEmail) {
            try {
              await fetch(`${notificationUrl}/notifications/send-raw-internal`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'x-internal-key': apiKey },
                body: JSON.stringify({
                  tenantId,
                  eventType: 'REORDER_REPORT',
                  channel: 'EMAIL',
                  recipientEmail: tenant.contactEmail,
                  subject: `${items.length} item(s) below reorder level`,
                  body: `The following item(s) are below their reorder level: ${items
                    .map((i) => i.name ?? i.itemCode ?? 'unknown item')
                    .join(', ')}`,
                }),
              });
              sent = true;
            } catch {
              // best-effort
            }
          }

          // Product audit 2026-07-31, Phase 1 Step 9: the email above is the only signal this
          // job has ever sent — nothing shows up in-app, even though the Reorder Report page
          // (apps/web-frontend/src/pages/production/ReorderReportPage.tsx) already has a full,
          // working, one-click "select items -> create POs" flow. Adds a real IN_APP
          // notification (send-raw-internal's IN_APP channel, which requires a recipientUserId —
          // see notification.routes.ts's SendRawInternalSchema comment) to every active user
          // holding REORDER_CREATE_PO, in addition to the existing email, so the already-built
          // create-PO flow is actually one click away from a notification instead of only ever
          // reachable by remembering to check the page.
          try {
            const recipients = (await db.execute(sql`
              SELECT DISTINCT u.id
              FROM users u
              JOIN user_roles ur ON ur.user_id = u.id AND ur.tenant_id = u.tenant_id
              JOIN role_permissions rp ON rp.role_id = ur.role_id AND rp.tenant_id = u.tenant_id
              WHERE u.tenant_id = ${tenantId}
                AND u.is_active = true
                AND rp.permission = 'REORDER_CREATE_PO'
            `)) as unknown as Array<{ id: number }>;

            for (const recipient of recipients) {
              try {
                await fetch(`${notificationUrl}/notifications/send-raw-internal`, {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json', 'x-internal-key': apiKey },
                  body: JSON.stringify({
                    tenantId,
                    eventType: 'REORDER_REPORT',
                    channel: 'IN_APP',
                    recipientUserId: recipient.id,
                    subject: `${items.length} item(s) below reorder level`,
                    body: `${items.length} item(s) need restocking. Open Reorder Report to create purchase orders in one click.`,
                  }),
                });
              } catch {
                // best-effort — one recipient's failure shouldn't block the rest
              }
            }
          } catch (err) {
            logger.warn(
              { tenantId, err },
              'Reorder report in-app notification lookup failed (non-fatal)'
            );
          }
        }
        logger.info(
          { tenantId, itemsBelowReorder: items.length, sent },
          'Reorder report check complete'
        );
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
        const body = (await res.json()) as { data?: Array<{ orderNumber?: string }> };
        const orders = body.data ?? [];
        // Notification-service audit 2026-07-23, bug #4: previously log-only — nobody was ever
        // actually alerted about overdue job-work orders.
        let sent = false;
        if (orders.length > 0) {
          const [tenant] = await db
            .select({ contactEmail: tenants.contactEmail })
            .from(tenants)
            .where(eq(tenants.id, tenantId));
          if (tenant?.contactEmail) {
            const notificationUrl =
              process.env['NOTIFICATION_SERVICE_URL'] ?? 'http://localhost:3014';
            try {
              await fetch(`${notificationUrl}/notifications/send-raw-internal`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'x-internal-key': apiKey },
                body: JSON.stringify({
                  tenantId,
                  eventType: 'JOB_WORK_OVERDUE_ALERT',
                  channel: 'EMAIL',
                  recipientEmail: tenant.contactEmail,
                  subject: `${orders.length} job-work order(s) in progress — review for overdue status`,
                  body: `The following job-work order(s) are still in progress: ${orders
                    .map((o) => o.orderNumber ?? 'unknown')
                    .join(', ')}`,
                }),
              });
              sent = true;
            } catch {
              // best-effort
            }
          }
        }
        logger.info(
          { tenantId, inProgressCount: orders.length, sent },
          'Job work overdue alert check complete'
        );
      } catch (err) {
        logger.warn({ tenantId, err }, 'Job work overdue alert failed (non-fatal)');
      }
    }
  );

  logger.info({ totalJobs: registry.listAll().length }, 'All system jobs registered');
}
