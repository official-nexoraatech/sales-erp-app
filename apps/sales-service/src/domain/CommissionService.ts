import { and, eq, desc, isNull } from 'drizzle-orm';
import {
  commissionPlans,
  commissionAssignments,
  commissionLedger,
  invoices,
  outboxEvents,
} from '@erp/db';
import type { ErpDatabase } from '@erp/db';
import { BusinessError, NotFoundError } from '@erp/types';
import { RuleEngine } from '@erp/sdk';
import { ulid } from 'ulid';

export interface CreatePlanParams {
  name: string;
  calculationBasis: 'PERCENTAGE' | 'FLAT_PER_UNIT' | 'TIERED';
  ratePct?: number;
  flatAmount?: number;
  tierSlabs?: Array<{ uptoAmount: number; ratePct: number }>;
  effectiveFrom: Date;
  effectiveTill?: Date;
}

export interface CreateAssignmentParams {
  planId: number;
  userId?: number;
  roleName?: string;
  branchId?: number;
}

export class CommissionService {
  constructor(private readonly db: ErpDatabase) {}

  // Plan/assignment authoring — gated by COMMISSION_MANAGE (route layer), same "config vs
  // execution" split as RuleEngine/WorkflowEngine's own admin surfaces. Without these, the
  // whole Commission category was computable but never actually configurable by any tenant —
  // computeForInvoice() would forever no-op with "no active assignment matches" for every
  // tenant, since nothing could ever insert the first commissionPlans/commissionAssignments
  // row (found via live end-to-end testing: creating and confirming a real high-value
  // invoice produced zero commission_ledger rows, and there was no route to explain why).
  async createPlan(tenantId: number, userId: number, params: CreatePlanParams) {
    const [row] = await this.db
      .insert(commissionPlans)
      .values({
        tenantId,
        name: params.name,
        calculationBasis: params.calculationBasis,
        ratePct: params.ratePct !== undefined ? String(params.ratePct) : null,
        flatAmount: params.flatAmount !== undefined ? String(params.flatAmount) : null,
        tierSlabs: params.tierSlabs ?? null,
        effectiveFrom: params.effectiveFrom,
        effectiveTill: params.effectiveTill ?? null,
        createdBy: userId,
      })
      .returning();
    return row!;
  }

  async listPlans(tenantId: number) {
    return this.db
      .select()
      .from(commissionPlans)
      .where(eq(commissionPlans.tenantId, tenantId))
      .orderBy(desc(commissionPlans.createdAt));
  }

  async createAssignment(tenantId: number, userId: number, params: CreateAssignmentParams) {
    const specifiers = [params.userId, params.roleName, params.branchId].filter(
      (v) => v !== undefined
    );
    if (specifiers.length !== 1) {
      throw new BusinessError(
        'INVALID_ASSIGNMENT',
        'Exactly one of userId, roleName, or branchId must be set on a commission assignment'
      );
    }
    const [plan] = await this.db
      .select({ id: commissionPlans.id })
      .from(commissionPlans)
      .where(and(eq(commissionPlans.id, params.planId), eq(commissionPlans.tenantId, tenantId)));
    if (!plan) throw new NotFoundError('CommissionPlan', params.planId);

    const [row] = await this.db
      .insert(commissionAssignments)
      .values({
        tenantId,
        planId: params.planId,
        userId: params.userId ?? null,
        roleName: params.roleName ?? null,
        branchId: params.branchId ?? null,
        createdBy: userId,
      })
      .returning();
    return row!;
  }

  async listAssignments(tenantId: number) {
    return this.db
      .select()
      .from(commissionAssignments)
      .where(eq(commissionAssignments.tenantId, tenantId))
      .orderBy(desc(commissionAssignments.createdAt));
  }

  // Computes and records a DRAFT commission_ledger row for a just-confirmed invoice, if the
  // invoice's creator (or their branch, as a fallback default) has an active commission
  // assignment. Deliberately non-fatal to the caller — a commission-calculation bug must
  // never block a legitimate sale from being confirmed (see InvoiceService.confirm()'s
  // call site, which catches and logs rather than propagating).
  //
  // Assignment resolution is 2-tier in this version (userId > branchId) — the schema also
  // reserves a roleName tier (commissionAssignments.roleName) for a future pass that needs a
  // role→user join; not required for the common "commission by rep" / "commission by branch
  // default" cases this covers today.
  async computeForInvoice(invoiceId: number, tenantId: number): Promise<void> {
    const [invoice] = await this.db
      .select({
        branchId: invoices.branchId,
        createdBy: invoices.createdBy,
        taxableAmount: invoices.taxableAmount,
        grandTotal: invoices.grandTotal,
      })
      .from(invoices)
      .where(and(eq(invoices.id, invoiceId), eq(invoices.tenantId, tenantId)));
    if (!invoice) throw new NotFoundError('Invoice', invoiceId);

    // Two sequential queries rather than one ORDER BY userId DESC LIMIT 1 — Postgres's
    // default NULL ordering for DESC is NULLS FIRST (nulls sort as larger than any non-null
    // value, and larger sorts first in DESC), which would have picked the branch-default
    // (NULL userId) row ahead of a more-specific user-level assignment — backwards from the
    // intended "userId match > branch-default" priority. Explicit and unambiguous beats
    // relying on NULL-ordering semantics for something this consequential.
    let [assignment] = await this.db
      .select()
      .from(commissionAssignments)
      .where(
        and(
          eq(commissionAssignments.tenantId, tenantId),
          eq(commissionAssignments.isActive, true),
          eq(commissionAssignments.userId, invoice.createdBy)
        )
      )
      .limit(1);
    if (!assignment) {
      [assignment] = await this.db
        .select()
        .from(commissionAssignments)
        .where(
          and(
            eq(commissionAssignments.tenantId, tenantId),
            eq(commissionAssignments.isActive, true),
            isNull(commissionAssignments.userId),
            eq(commissionAssignments.branchId, invoice.branchId)
          )
        )
        .limit(1);
    }
    if (!assignment) return; // no commission plan applies to this invoice — not an error

    const now = new Date();
    const [plan] = await this.db
      .select()
      .from(commissionPlans)
      .where(
        and(
          eq(commissionPlans.id, assignment.planId),
          eq(commissionPlans.tenantId, tenantId),
          eq(commissionPlans.isActive, true)
        )
      );
    if (!plan) return; // assignment points at a plan that's since been deactivated
    if (plan.effectiveFrom > now) return;
    if (plan.effectiveTill && plan.effectiveTill < now) return;

    const baseAmount = parseFloat(String(invoice.taxableAmount));

    // Business Rules Engine wiring: eligibility can be tenant-customized (e.g. "no commission
    // on invoices under ₹500", or a promo period with a temporary BLOCK) without a code
    // change — mirrors the credit-limit/PO-approval wiring elsewhere in this feature.
    const ruleResult = await new RuleEngine(this.db).evaluate({
      tenantId,
      userId: assignment.userId ?? invoice.createdBy,
      entityType: 'COMMISSION',
      eventType: 'INVOICE_CONFIRMED',
      data: { invoiceId, baseAmount, grandTotal: parseFloat(String(invoice.grandTotal)) },
    });
    if (ruleResult.blocked) return;

    const commissionAmount = this.computeAmount(plan, baseAmount);
    if (commissionAmount <= 0) return;

    await this.db.insert(commissionLedger).values({
      tenantId,
      invoiceId,
      planId: plan.id,
      assignmentId: assignment.id,
      earnedByUserId: invoice.createdBy,
      baseAmount: String(baseAmount),
      commissionAmount: String(commissionAmount),
      status: 'DRAFT',
    });
  }

  private computeAmount(plan: typeof commissionPlans.$inferSelect, baseAmount: number): number {
    switch (plan.calculationBasis) {
      case 'PERCENTAGE':
        return Math.round(baseAmount * (parseFloat(String(plan.ratePct ?? '0')) / 100) * 100) / 100;
      case 'FLAT_PER_UNIT':
        // Flat-per-unit plans are computed at invoice-line granularity by design (a flat ₹
        // per unit sold), which needs the invoice's line quantities — deliberately out of
        // scope for this pass; treated as 0 (no commission) rather than guessing a shape.
        // PERCENTAGE and TIERED (both computed off taxableAmount) cover the common cases.
        return 0;
      case 'TIERED': {
        const slabs = (plan.tierSlabs ?? []).slice().sort((a, b) => a.uptoAmount - b.uptoAmount);
        const slab = slabs.find((s) => baseAmount <= s.uptoAmount) ?? slabs[slabs.length - 1];
        if (!slab) return 0;
        return Math.round(baseAmount * (slab.ratePct / 100) * 100) / 100;
      }
      default:
        return 0;
    }
  }

  async approve(id: number, tenantId: number, userId: number): Promise<void> {
    await this.db.transaction(async (trx) => {
      const [claimed] = await trx
        .update(commissionLedger)
        .set({
          status: 'APPROVED',
          approvedBy: userId,
          approvedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(commissionLedger.id, id),
            eq(commissionLedger.tenantId, tenantId),
            eq(commissionLedger.status, 'DRAFT')
          )
        )
        .returning();

      if (!claimed) {
        const [current] = await trx
          .select({ status: commissionLedger.status })
          .from(commissionLedger)
          .where(and(eq(commissionLedger.id, id), eq(commissionLedger.tenantId, tenantId)));
        if (!current) throw new NotFoundError('CommissionLedgerRow', id);
        throw new BusinessError(
          'INVALID_STATUS',
          `Commission cannot be approved in status ${current.status}`
        );
      }

      // Accounting posts this via PostingMatrixService's COMMISSION_APPROVED rule (see
      // accounting-service's CommissionAccountingConsumer) — sales-service never posts a
      // journal directly, same "caller asks the domain service, doesn't reimplement" rule
      // this whole initiative is meant to enforce.
      await trx.insert(outboxEvents).values({
        eventId: ulid(),
        eventType: 'COMMISSION_APPROVED',
        aggregateType: 'CommissionLedgerRow',
        aggregateId: id,
        tenantId,
        payload: {
          commissionId: id,
          invoiceId: claimed.invoiceId,
          earnedByUserId: claimed.earnedByUserId,
          amount: claimed.commissionAmount,
        },
        published: false,
      });
    });
  }

  async listForUser(tenantId: number, userId: number) {
    return this.db
      .select()
      .from(commissionLedger)
      .where(
        and(eq(commissionLedger.tenantId, tenantId), eq(commissionLedger.earnedByUserId, userId))
      )
      .orderBy(desc(commissionLedger.createdAt));
  }
}
