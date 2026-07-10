import type { ErpDatabase } from '@erp/db';
import { usageEvents, usageSummary, users, documentAttachments } from '@erp/db';
import { and, eq, gte, lt, sql } from 'drizzle-orm';
import { createLogger } from '@erp/logger';
import type { JobRegistry } from '../JobRegistry.js';

const logger = createLogger({ serviceName: 'scheduler-service' });

export interface UsageEventRow {
  eventType: string;
  quantity: number;
}

// Pure aggregation — given the current period's raw usage_events rows, sums quantity per
// countable event type. Split out from rollupTenantUsage() so it's unit-testable without a DB.
export function aggregateUsageEvents(rows: UsageEventRow[]): { invoiceCount: number; apiCallCount: number } {
  let invoiceCount = 0;
  let apiCallCount = 0;
  for (const row of rows) {
    if (row.eventType === 'USAGE_INVOICE_CREATED') invoiceCount += row.quantity;
    else if (row.eventType === 'USAGE_API_CALL_BATCH') apiCallCount += row.quantity;
  }
  return { invoiceCount, apiCallCount };
}

export interface UsageSummaryInput {
  events: UsageEventRow[];
  activeUserCount: number;
  storageBytes: number;
  periodStart: string;
  periodEnd: string;
}

export interface UsageSummaryResult {
  periodStart: string;
  periodEnd: string;
  invoiceCount: number;
  activeUserCount: number;
  storageBytes: number;
  apiCallCount: number;
}

// Combines the outbox-fed usage_events aggregation with the two point-in-time-derived
// metrics (active users, storage bytes — both already durably recorded elsewhere, so they
// need no dedicated event, see the gap-prompt's Architecture section) into one summary row.
export function computeUsageSummary(input: UsageSummaryInput): UsageSummaryResult {
  const { invoiceCount, apiCallCount } = aggregateUsageEvents(input.events);
  return {
    periodStart: input.periodStart,
    periodEnd: input.periodEnd,
    invoiceCount,
    activeUserCount: input.activeUserCount,
    storageBytes: input.storageBytes,
    apiCallCount,
  };
}

// Current calendar month in UTC, as YYYY-MM-DD boundaries (periodEnd = last day of month,
// inclusive — matches usage_summary.period_end's semantics).
export function computeCurrentPeriod(now: Date): { periodStart: string; periodEnd: string } {
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0));
  return { periodStart: start.toISOString().slice(0, 10), periodEnd: end.toISOString().slice(0, 10) };
}

export async function rollupTenantUsage(db: ErpDatabase, tenantId: number, now: Date = new Date()): Promise<void> {
  const { periodStart, periodEnd } = computeCurrentPeriod(now);
  const periodStartDate = new Date(`${periodStart}T00:00:00.000Z`);
  const periodEndExclusive = new Date(new Date(`${periodEnd}T00:00:00.000Z`).getTime() + 24 * 60 * 60 * 1000);

  const eventRows = await db
    .select({ eventType: usageEvents.eventType, quantity: usageEvents.quantity })
    .from(usageEvents)
    .where(
      and(
        eq(usageEvents.tenantId, tenantId),
        gte(usageEvents.occurredAt, periodStartDate),
        lt(usageEvents.occurredAt, periodEndExclusive)
      )
    );

  const [userRow] = await db
    .select({ total: sql<number>`count(*)::int` })
    .from(users)
    .where(and(eq(users.tenantId, tenantId), eq(users.isActive, true)));

  const [storageRow] = await db
    .select({ total: sql<number>`coalesce(sum(${documentAttachments.fileSize}), 0)::bigint` })
    .from(documentAttachments)
    .where(eq(documentAttachments.tenantId, tenantId));

  const summary = computeUsageSummary({
    events: eventRows,
    activeUserCount: userRow?.total ?? 0,
    storageBytes: storageRow?.total ?? 0,
    periodStart,
    periodEnd,
  });

  // Idempotent upsert — a retried or manually re-triggered rollup for the same period
  // recomputes rather than double-counting (see JobRegistry's built-in retry/backoff).
  await db
    .insert(usageSummary)
    .values({ tenantId, ...summary, computedAt: new Date() })
    .onConflictDoUpdate({
      target: [usageSummary.tenantId, usageSummary.periodStart],
      set: {
        periodEnd: summary.periodEnd,
        invoiceCount: summary.invoiceCount,
        activeUserCount: summary.activeUserCount,
        storageBytes: summary.storageBytes,
        apiCallCount: summary.apiCallCount,
        computedAt: new Date(),
      },
    });

  logger.info({ tenantId, ...summary }, 'Usage rollup complete for tenant');
}

export function registerUsageRollupJob(registry: JobRegistry, db: ErpDatabase): void {
  registry.register(
    'usage-rollup',
    { cron: '0 3 * * *', description: 'Nightly per-tenant usage_summary rollup', tenantScoped: true },
    async (_job, tenantId) => {
      if (tenantId === undefined) return;
      await rollupTenantUsage(db, tenantId);
    }
  );
}
