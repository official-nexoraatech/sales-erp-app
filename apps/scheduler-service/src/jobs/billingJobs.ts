/* global process, fetch */
import type { JobRegistry } from '../JobRegistry.js';
import { createLogger } from '@erp/logger';

const logger = createLogger({ serviceName: 'scheduler-service' });

// PG-027 Session 2: new file rather than adding to system-jobs.ts, which is already 2413 lines.
// Platform-level (tenantScoped: false) — the job iterates all due tenants itself via
// tenant-service's own /internal/billing/run-cycle route, matching the same shape
// sales.quotation-expiry already uses for a platform-level job.
export function registerBillingJobs(registry: JobRegistry): void {
  registry.register(
    'platform.tenant-billing-cycle',
    {
      cron: '0 2 * * *',
      description: 'Daily tenant billing cycle: invoices, charges, dunning',
      tenantScoped: false,
    },
    async (_job) => {
      const tenantServiceUrl = process.env['TENANT_SERVICE_URL'] ?? 'http://localhost:3011';
      const apiKey = process.env['INTERNAL_API_KEY'] ?? '';
      // Security/correctness: throws (not catches) on a non-OK response, matching
      // hr.payroll.prepare's pattern — JobRegistry's BullMQ attempts:3/exponential-backoff only
      // retries when the handler actually throws. A billing run that silently swallowed a
      // tenant-service outage would mean invoices/charges/dunning simply never ran for a day,
      // with no automated retry.
      const res = await fetch(`${tenantServiceUrl}/api/v2/internal/billing/run-cycle`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-internal-key': apiKey },
      });
      if (!res.ok) {
        throw new Error(`Billing cycle failed: HTTP ${res.status} ${await res.text()}`);
      }
      const body = (await res.json()) as {
        data?: {
          tenantsProcessed?: number;
          invoicesGenerated?: number;
          paymentsFailed?: number;
          suspended?: number;
        };
      };
      logger.info(
        {
          tenantsProcessed: body.data?.tenantsProcessed,
          invoicesGenerated: body.data?.invoicesGenerated,
          paymentsFailed: body.data?.paymentsFailed,
          suspended: body.data?.suspended,
        },
        'Tenant billing cycle complete'
      );
    }
  );
}
