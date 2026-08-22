import { and, asc, desc, eq, inArray, isNull, or } from 'drizzle-orm';
import {
  crmOpportunities,
  crmOpportunityLineItems,
  crmOpportunityHistory,
  crmPipelineStages,
  items,
  outboxEvents,
} from '@erp/db';
import type { ErpDatabase } from '@erp/db';
import type { BranchScope } from '@erp/sdk';
import { BusinessError, NotFoundError, OptimisticLockError } from '@erp/types';
import { ulid } from 'ulid';

// Duplicated from sales-service's QuotationService.ts (CRM/O2C split) — a type-only shape, no
// runtime dependency, erased at compile time either way; kept in sync manually since both
// services independently agree on the outbox event's payload contract.
export interface QuotationLineInput {
  itemId: number;
  variantId?: number;
  description?: string;
  quantity: number;
  unitId?: number;
  unitPrice: number;
  discountPct?: number;
  discountAmount?: number;
  gstRate: number;
  hsnCode?: string;
}

// CRM-ROADMAP Phase 2, Feature 1 — Sales Pipeline & Opportunity Management.

export interface PipelineStage {
  code: string;
  name: string;
  sequence: number;
  probability: number;
  isWon: boolean;
  isLost: boolean;
}

// Every tenant gets this set for free — customizing via crm_pipeline_stages is optional, same
// "sensible default always applies" convention as TicketService.resolveSlaHours' fallback.
const DEFAULT_STAGES: PipelineStage[] = [
  { code: 'NEW', name: 'New', sequence: 1, probability: 10, isWon: false, isLost: false },
  {
    code: 'QUALIFICATION',
    name: 'Qualification',
    sequence: 2,
    probability: 25,
    isWon: false,
    isLost: false,
  },
  { code: 'PROPOSAL', name: 'Proposal', sequence: 3, probability: 50, isWon: false, isLost: false },
  {
    code: 'NEGOTIATION',
    name: 'Negotiation',
    sequence: 4,
    probability: 75,
    isWon: false,
    isLost: false,
  },
  { code: 'WON', name: 'Won', sequence: 5, probability: 100, isWon: true, isLost: false },
  { code: 'LOST', name: 'Lost', sequence: 6, probability: 0, isWon: false, isLost: true },
];

// Deals with at least this much confidence are counted at full (not probability-weighted)
// value in the "commit" forecast band — a standard CRM forecasting convention.
const COMMIT_PROBABILITY_THRESHOLD = 75;

export interface OpportunityLineInput {
  itemId: number;
  variantId?: number | undefined;
  quantity: number;
  unitId?: number | undefined;
  unitPrice: number;
  discountPct?: number | undefined;
  discountAmount?: number | undefined;
}

export interface CreateOpportunityParams {
  tenantId: number;
  name: string;
  dealType?: string | undefined;
  value: number;
  expectedCloseDate?: Date | undefined;
  customerId?: number | undefined;
  accountId?: number | undefined;
  assignedTo?: number | undefined;
  branchId?: number | undefined;
  notes?: string | undefined;
  lines?: OpportunityLineInput[] | undefined;
  createdBy: number;
}

export interface ForecastBands {
  pipelineValue: number;
  weightedValue: number;
  commitValue: number;
}

function lineTotal(line: OpportunityLineInput): number {
  const gross = line.quantity * line.unitPrice;
  const pctOff = gross * ((line.discountPct ?? 0) / 100);
  return Math.max(0, gross - pctOff - (line.discountAmount ?? 0));
}

export class OpportunityService {
  /**
   * Resolves this tenant's pipeline stages for a deal type: its own active
   * crm_pipeline_stages rows (matching dealType, or the tenant's dealType-null general rows)
   * if any exist, otherwise the hardcoded default set. Never a mix of the two — a tenant that
   * has customized its stages for one dealType doesn't get default stages silently mixed in.
   */
  static async getStages(
    db: ErpDatabase,
    tenantId: number,
    dealType?: string | null
  ): Promise<PipelineStage[]> {
    const rows = await db
      .select()
      .from(crmPipelineStages)
      .where(
        and(
          eq(crmPipelineStages.tenantId, tenantId),
          eq(crmPipelineStages.isActive, true),
          dealType
            ? or(eq(crmPipelineStages.dealType, dealType), isNull(crmPipelineStages.dealType))!
            : isNull(crmPipelineStages.dealType)
        )
      )
      .orderBy(asc(crmPipelineStages.sequence));

    if (rows.length === 0) return DEFAULT_STAGES;
    return rows.map((r) => ({
      code: r.code,
      name: r.name,
      sequence: r.sequence,
      probability: r.probability,
      isWon: r.isWon,
      isLost: r.isLost,
    }));
  }

  static async create(
    db: ErpDatabase,
    params: CreateOpportunityParams
  ): Promise<typeof crmOpportunities.$inferSelect> {
    return db.transaction(async (trx) => {
      const stages = await OpportunityService.getStages(trx, params.tenantId, params.dealType);
      const initialStage = stages.find((s) => !s.isWon && !s.isLost) ?? stages[0]!;

      const [created] = await trx
        .insert(crmOpportunities)
        .values({
          tenantId: params.tenantId,
          name: params.name,
          dealType: params.dealType,
          stage: initialStage.code,
          probability: initialStage.probability,
          value: String(params.value),
          expectedCloseDate: params.expectedCloseDate,
          customerId: params.customerId,
          accountId: params.accountId,
          assignedTo: params.assignedTo,
          branchId: params.branchId,
          notes: params.notes,
          createdBy: params.createdBy,
        })
        .returning();
      if (!created) throw new Error('Opportunity creation failed unexpectedly');

      if (params.lines && params.lines.length > 0) {
        await trx.insert(crmOpportunityLineItems).values(
          params.lines.map((l, i) => ({
            tenantId: params.tenantId,
            opportunityId: created.id,
            lineNumber: i + 1,
            itemId: l.itemId,
            variantId: l.variantId,
            quantity: String(l.quantity),
            unitId: l.unitId,
            unitPrice: String(l.unitPrice),
            discountPct: String(l.discountPct ?? 0),
            discountAmount: String(l.discountAmount ?? 0),
            lineTotal: String(lineTotal(l)),
          }))
        );
      }

      await trx.insert(crmOpportunityHistory).values({
        tenantId: params.tenantId,
        opportunityId: created.id,
        activityType: 'CREATED',
        toStage: initialStage.code,
        actorId: params.createdBy,
      });

      return created;
    });
  }

  /**
   * Branch-scoped opportunity list (AR-6) — a branch-restricted caller (branchScope an array)
   * sees only opportunities in one of their branches plus any unassigned (null branch_id)
   * ones; a caller with 'all' (BRANCH_SCOPE_BYPASS or no branch assignments) sees every
   * opportunity. Same `or(isNull(...), inArray(...))` shape every other CRM list route in this
   * codebase already uses (ticket.routes.ts/lead.routes.ts) — extracted here (rather than
   * inlined in the route) specifically so this feature's own DoD requirement — "branch scoping
   * tested for both a scoped and unscoped user" — has a directly callable, unit-testable
   * function to test it against.
   */
  static async list(
    db: ErpDatabase,
    tenantId: number,
    branchScope: BranchScope,
    filters: {
      stage?: string | undefined;
      dealType?: string | undefined;
      customerId?: number | undefined;
    } = {}
  ): Promise<(typeof crmOpportunities.$inferSelect)[]> {
    const conditions = [eq(crmOpportunities.tenantId, tenantId)];
    if (filters.stage) conditions.push(eq(crmOpportunities.stage, filters.stage));
    if (filters.dealType) conditions.push(eq(crmOpportunities.dealType, filters.dealType));
    if (filters.customerId) conditions.push(eq(crmOpportunities.customerId, filters.customerId));
    if (branchScope !== 'all') {
      conditions.push(
        or(isNull(crmOpportunities.branchId), inArray(crmOpportunities.branchId, branchScope))!
      );
    }

    return db
      .select()
      .from(crmOpportunities)
      .where(and(...conditions))
      .orderBy(desc(crmOpportunities.createdAt));
  }

  static async listLineItems(
    db: ErpDatabase,
    tenantId: number,
    opportunityId: number
  ): Promise<(typeof crmOpportunityLineItems.$inferSelect)[]> {
    return db
      .select()
      .from(crmOpportunityLineItems)
      .where(
        and(
          eq(crmOpportunityLineItems.opportunityId, opportunityId),
          eq(crmOpportunityLineItems.tenantId, tenantId)
        )
      )
      .orderBy(asc(crmOpportunityLineItems.lineNumber));
  }

  static async addLineItem(
    db: ErpDatabase,
    tenantId: number,
    opportunityId: number,
    input: OpportunityLineInput
  ): Promise<typeof crmOpportunityLineItems.$inferSelect> {
    const existing = await OpportunityService.listLineItems(db, tenantId, opportunityId);
    const nextLineNumber = existing.reduce((max, l) => Math.max(max, l.lineNumber), 0) + 1;

    const [created] = await db
      .insert(crmOpportunityLineItems)
      .values({
        tenantId,
        opportunityId,
        lineNumber: nextLineNumber,
        itemId: input.itemId,
        variantId: input.variantId,
        quantity: String(input.quantity),
        unitId: input.unitId,
        unitPrice: String(input.unitPrice),
        discountPct: String(input.discountPct ?? 0),
        discountAmount: String(input.discountAmount ?? 0),
        lineTotal: String(lineTotal(input)),
      })
      .returning();
    if (!created) throw new Error('Line item creation failed unexpectedly');
    return created;
  }

  static async removeLineItem(
    db: ErpDatabase,
    tenantId: number,
    opportunityId: number,
    lineItemId: number
  ): Promise<void> {
    await db
      .delete(crmOpportunityLineItems)
      .where(
        and(
          eq(crmOpportunityLineItems.id, lineItemId),
          eq(crmOpportunityLineItems.opportunityId, opportunityId),
          eq(crmOpportunityLineItems.tenantId, tenantId)
        )
      );
  }

  /**
   * Generic stage transition — works for any target stage, including a tenant's Won/Lost
   * stages, enforcing this feature's two documented exit criteria: a Lost transition requires
   * a reason; a Won transition requires at least one line item (there's nothing to quote
   * otherwise — the roadmap's own stated "zero line items" edge case, resolved here: allowed
   * at every stage except Won). `markWon`/`markLost` below are the intent-revealing entry
   * points routes should call for terminal transitions; this method is what they both use.
   */
  static async changeStage(
    db: ErpDatabase,
    tenantId: number,
    userId: number,
    opportunityId: number,
    params: { toStageCode: string; version: number; lostReason?: string }
  ): Promise<typeof crmOpportunities.$inferSelect> {
    const [existing] = await db
      .select()
      .from(crmOpportunities)
      .where(and(eq(crmOpportunities.id, opportunityId), eq(crmOpportunities.tenantId, tenantId)));
    if (!existing) throw new NotFoundError('CrmOpportunity', opportunityId);

    const stages = await OpportunityService.getStages(db, tenantId, existing.dealType);
    const currentStage = stages.find((s) => s.code === existing.stage);
    const toStage = stages.find((s) => s.code === params.toStageCode);
    if (!toStage) {
      throw new BusinessError('INVALID_STAGE', `Unknown pipeline stage: ${params.toStageCode}`);
    }
    if (currentStage && (currentStage.isWon || currentStage.isLost)) {
      throw new BusinessError(
        'OPPORTUNITY_CLOSED',
        'A Won or Lost opportunity cannot change stage'
      );
    }
    if (toStage.isLost && !params.lostReason?.trim()) {
      throw new BusinessError(
        'LOST_REASON_REQUIRED',
        'A reason is required to mark an opportunity Lost'
      );
    }
    if (toStage.isWon) {
      const lines = await OpportunityService.listLineItems(db, tenantId, opportunityId);
      if (lines.length === 0) {
        throw new BusinessError(
          'NO_LINE_ITEMS',
          'At least one line item is required before marking an opportunity Won'
        );
      }
    }

    const now = new Date();
    const [updated] = await db
      .update(crmOpportunities)
      .set({
        stage: toStage.code,
        probability: toStage.probability,
        updatedAt: now,
        version: existing.version + 1,
        ...(toStage.isWon ? { wonAt: now } : {}),
        ...(toStage.isLost ? { lostAt: now, lostReason: params.lostReason } : {}),
      })
      .where(
        and(
          eq(crmOpportunities.id, opportunityId),
          eq(crmOpportunities.tenantId, tenantId),
          eq(crmOpportunities.version, params.version)
        )
      )
      .returning();
    if (!updated) throw new OptimisticLockError('CrmOpportunity');

    await db.insert(crmOpportunityHistory).values({
      tenantId,
      opportunityId,
      activityType: toStage.isWon ? 'WON' : toStage.isLost ? 'LOST' : 'STAGE_CHANGE',
      fromStage: existing.stage,
      toStage: toStage.code,
      notes: params.lostReason,
      actorId: userId,
    });

    return updated;
  }

  /**
   * Marks an opportunity Won and publishes an OPPORTUNITY_WON outbox event carrying everything
   * needed to create the resulting Quotation — the actual creation happens asynchronously (see
   * consumers/OpportunityWonConsumer.ts), not in this transaction. This is a deliberate outbox
   * redesign (CRM/O2C split step 1): a same-transaction call into QuotationService.create()
   * won't survive Opportunity (CRM) and Quotation (O2C) becoming physically separate services,
   * so the handoff is decoupled now, before that split happens, along the seam it will later
   * cut along. Line items carry no GST/HSN (see crmOpportunityLineItems' own comment); both are
   * looked up fresh from `items` here and frozen into the event payload, exactly as they would
   * be if a rep created the quotation manually today — the async consumer does not re-derive
   * them, preserving today's "frozen at Won-moment" audit guarantee despite the created-at-time
   * shifting later.
   *
   * Tradeoff, recorded not silently absorbed: unlike before, a failure in Quotation creation no
   * longer rolls back the Won transition (Won always commits once this returns). If the async
   * creation then fails (e.g. a blocked customer), the opportunity is left Won with
   * `convertedQuotationId: null` and no automatic retry — see OpportunityWonConsumer.ts's own
   * comment for the accepted-gap decision.
   */
  static async markWon(
    db: ErpDatabase,
    tenantId: number,
    userId: number,
    opportunityId: number,
    params: {
      version: number;
      branchId: number;
      placeOfSupply: string;
      sellerStateCode: string;
      validUntil: Date;
    }
  ): Promise<{ opportunity: typeof crmOpportunities.$inferSelect; quotationId: null }> {
    return db.transaction(async (trxRaw) => {
      const trx = trxRaw as unknown as ErpDatabase;

      const [existing] = await trx
        .select()
        .from(crmOpportunities)
        .where(
          and(eq(crmOpportunities.id, opportunityId), eq(crmOpportunities.tenantId, tenantId))
        );
      if (!existing) throw new NotFoundError('CrmOpportunity', opportunityId);
      if (!existing.customerId) {
        throw new BusinessError(
          'NO_CUSTOMER',
          'An opportunity must have a linked customer before it can be Won'
        );
      }

      const stages = await OpportunityService.getStages(trx, tenantId, existing.dealType);
      const wonStage = stages.find((s) => s.isWon);
      if (!wonStage) {
        throw new BusinessError(
          'NO_WON_STAGE_CONFIGURED',
          'This tenant has no pipeline stage flagged as Won'
        );
      }

      const withStage = await OpportunityService.changeStage(trx, tenantId, userId, opportunityId, {
        toStageCode: wonStage.code,
        version: params.version,
      });

      const lines = await OpportunityService.listLineItems(trx, tenantId, opportunityId);
      const itemIds = [...new Set(lines.map((l) => l.itemId))];
      const itemRows = await trx
        .select({ id: items.id, gstRate: items.gstRate, hsnCode: items.hsnCode })
        .from(items)
        .where(and(eq(items.tenantId, tenantId), inArray(items.id, itemIds)));
      const itemById = new Map(itemRows.map((r) => [r.id, r]));

      const quotationLines: QuotationLineInput[] = lines.map((l) => {
        const item = itemById.get(l.itemId);
        return {
          itemId: l.itemId,
          ...(l.variantId ? { variantId: l.variantId } : {}),
          quantity: parseFloat(l.quantity),
          ...(l.unitId ? { unitId: l.unitId } : {}),
          unitPrice: parseFloat(l.unitPrice),
          discountPct: parseFloat(l.discountPct),
          discountAmount: parseFloat(l.discountAmount),
          gstRate: parseFloat(item?.gstRate ?? '0'),
          ...(item?.hsnCode ? { hsnCode: item.hsnCode } : {}),
        };
      });

      await trx.insert(outboxEvents).values({
        eventId: ulid(),
        eventType: 'OPPORTUNITY_WON',
        aggregateType: 'crm_opportunity',
        aggregateId: opportunityId,
        tenantId,
        payload: {
          opportunityId,
          tenantId,
          userId,
          branchId: params.branchId,
          customerId: existing.customerId,
          placeOfSupply: params.placeOfSupply,
          sellerStateCode: params.sellerStateCode,
          validUntil: params.validUntil.toISOString(),
          quotationNumber: `QT-OPP-${tenantId}-${Date.now()}`,
          notes: `Auto-created from Opportunity #${opportunityId} (${existing.name})`,
          lines: quotationLines,
        },
        published: false,
      });

      return { opportunity: withStage, quotationId: null };
    });
  }

  static async markLost(
    db: ErpDatabase,
    tenantId: number,
    userId: number,
    opportunityId: number,
    params: { version: number; lostReason: string }
  ): Promise<typeof crmOpportunities.$inferSelect> {
    const [existing] = await db
      .select()
      .from(crmOpportunities)
      .where(and(eq(crmOpportunities.id, opportunityId), eq(crmOpportunities.tenantId, tenantId)));
    if (!existing) throw new NotFoundError('CrmOpportunity', opportunityId);

    const stages = await OpportunityService.getStages(db, tenantId, existing.dealType);
    const lostStage = stages.find((s) => s.isLost);
    if (!lostStage) {
      throw new BusinessError(
        'NO_LOST_STAGE_CONFIGURED',
        'This tenant has no pipeline stage flagged as Lost'
      );
    }

    return OpportunityService.changeStage(db, tenantId, userId, opportunityId, {
      toStageCode: lostStage.code,
      version: params.version,
      lostReason: params.lostReason,
    });
  }

  /**
   * Pure math, independently testable against a hand-computed fixture per this feature's DoD.
   * `pipelineValue` = raw total across every OPEN (not Won, not Lost) opportunity passed in;
   * `weightedValue` (best case) = probability-weighted total; `commitValue` = full value of
   * only the high-confidence subset (probability >= threshold) — a standard three-band
   * CRM forecast, not something this codebase had a prior convention for.
   */
  static computeForecast(
    opportunities: Array<{ value: number; probability: number }>
  ): ForecastBands {
    let pipelineValue = 0;
    let weightedValue = 0;
    let commitValue = 0;
    for (const o of opportunities) {
      pipelineValue += o.value;
      weightedValue += o.value * (o.probability / 100);
      if (o.probability >= COMMIT_PROBABILITY_THRESHOLD) commitValue += o.value;
    }
    return {
      pipelineValue: Math.round(pipelineValue * 100) / 100,
      weightedValue: Math.round(weightedValue * 100) / 100,
      commitValue: Math.round(commitValue * 100) / 100,
    };
  }
}
