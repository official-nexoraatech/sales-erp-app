import { eq } from 'drizzle-orm';
import type { ERPEventPayload } from '@erp/types';
import type { TenantScopedDatabase } from '@erp/sdk';
import { crmOpportunities, outboxEvents } from '@erp/db';
import { createLogger } from '@erp/logger';
import { ulid } from 'ulid';
import { QuotationService, type QuotationLineInput } from '../domain/QuotationService.js';

const logger = createLogger({ serviceName: 'sales-service' });

// CRM/O2C split, step 1 — the async half of OpportunityService.markWon()'s outbox redesign (see
// that method's own doc comment for why). Creates the Quotation a Won opportunity was frozen
// against at Won-time, and writes convertedQuotationId back onto the opportunity.
//
// Accepted gap, recorded not silently absorbed: if quotation creation fails here (e.g. the
// customer was blocked between Won-time and now), PlatformEventConsumer marks the inbox row
// FAILED and there is no automatic retry — no such reprocessing mechanism exists anywhere in
// this codebase yet, and building one was explicitly scoped out of this step. The opportunity
// is left Won with convertedQuotationId: null, a recoverable-but-not-yet-automated state.
interface OpportunityWonPayload {
  opportunityId: number;
  tenantId: number;
  userId: number;
  branchId: number;
  customerId: number;
  placeOfSupply: string;
  sellerStateCode: string;
  validUntil: string;
  quotationNumber: string;
  notes: string;
  lines: QuotationLineInput[];
}

export async function handleOpportunityWon(
  event: ERPEventPayload,
  db: TenantScopedDatabase
): Promise<void> {
  const p = event.payload as unknown as OpportunityWonPayload;
  if (!p.opportunityId) return;

  // Idempotent no-op if this opportunity was already converted — guards against a duplicate
  // *business* trigger (e.g. a redelivered-but-already-fully-processed event racing a retry),
  // on top of (not instead of) the inbox table's own delivery-level idempotency. Mirrors
  // EInvoiceService.generateIrn's pre-check-before-creating pattern.
  const [existing] = await db.raw
    .select({ convertedQuotationId: crmOpportunities.convertedQuotationId })
    .from(crmOpportunities)
    .where(eq(crmOpportunities.id, p.opportunityId));
  if (existing?.convertedQuotationId) {
    logger.info(
      { opportunityId: p.opportunityId, quotationId: existing.convertedQuotationId },
      'OPPORTUNITY_WON already converted — skipping'
    );
    return;
  }

  await db.transaction(async (trx) => {
    const quotationService = new QuotationService(trx.raw);
    const quotationId = await quotationService.create({
      tenantId: p.tenantId,
      branchId: p.branchId,
      customerId: p.customerId,
      quotationNumber: p.quotationNumber,
      placeOfSupply: p.placeOfSupply,
      sellerStateCode: p.sellerStateCode,
      validUntil: new Date(p.validUntil),
      lines: p.lines,
      notes: p.notes,
      createdBy: p.userId,
    });

    await trx.raw
      .update(crmOpportunities)
      .set({ convertedQuotationId: quotationId })
      .where(eq(crmOpportunities.id, p.opportunityId));

    // Same shape the manual-creation route (quotation.routes.ts) publishes, so search-service's
    // indexing consumer works identically regardless of quotation origin.
    await trx.raw.insert(outboxEvents).values({
      eventId: ulid(),
      eventType: 'QUOTATION_CREATED',
      aggregateType: 'quotation',
      aggregateId: quotationId,
      tenantId: p.tenantId,
      payload: {
        quotationId,
        quotationNumber: p.quotationNumber,
        customerId: p.customerId,
        branchId: p.branchId,
        status: 'DRAFT',
      },
      published: false,
    });
  });

  logger.info({ opportunityId: p.opportunityId }, 'OPPORTUNITY_WON converted to a real Quotation');
}
