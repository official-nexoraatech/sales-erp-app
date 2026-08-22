import { and, asc, eq, gt, isNotNull, lte, notInArray, sql, type SQL } from 'drizzle-orm';
import {
  crmJourneys,
  crmJourneySteps,
  crmJourneyEnrollments,
  crmJourneyStepEvents,
  customerSegments,
  customers,
  campaigns,
  invoices,
  type CrmJourney,
  type CrmJourneyStep,
  type CrmJourneyEnrollment,
} from '@erp/db';
import type { ErpDatabase } from '@erp/db';
import type { PlatformContext } from '@erp/sdk';
import { BusinessError, NotFoundError, ValidationError } from '@erp/types';
import { createLogger } from '@erp/logger';
import { SegmentService, type SegmentFilterDefinition } from './SegmentService.js';
import { CampaignService } from './CampaignService.js';

const logger = createLogger({ serviceName: 'sales-service' });

// CRM-ROADMAP Phase 2, Feature 2 (Visual Customer Journey Builder). Per AR-3, journeys compile
// to the same scheduler-cron mechanism already driving campaignAutomationRules — every ACTION
// step sends via the existing CampaignService.send(), never a second send mechanism, which is
// how a journey step automatically inherits consent/frequency-cap enforcement for free.

export interface JourneyStepInput {
  stepType: 'DELAY' | 'ACTION' | 'BRANCH';
  delayDays?: number | undefined;
  channel?: 'SMS' | 'WHATSAPP' | 'EMAIL' | 'IN_APP' | undefined;
  messageTemplate?: string | undefined;
  branchConditionType?: 'MADE_PURCHASE' | undefined;
  branchWithinDays?: number | undefined;
  truePath?: JourneyStepInput[] | undefined;
  falsePath?: JourneyStepInput[] | undefined;
}

export interface JourneyStepNode extends CrmJourneyStep {
  truePath?: JourneyStepNode[];
  falsePath?: JourneyStepNode[];
}

function validateStep(step: JourneyStepInput): void {
  if (step.stepType === 'DELAY' && (!step.delayDays || step.delayDays < 1)) {
    throw new ValidationError('DELAY step requires delayDays >= 1');
  }
  if (step.stepType === 'ACTION' && (!step.channel || !step.messageTemplate)) {
    throw new ValidationError('ACTION step requires channel and messageTemplate');
  }
  if (step.stepType === 'BRANCH') {
    if (!step.branchConditionType)
      throw new ValidationError('BRANCH step requires branchConditionType');
    if (!step.truePath?.length && !step.falsePath?.length) {
      throw new ValidationError('BRANCH step requires at least one of truePath/falsePath');
    }
  }
}

// Mirrors CustomerService.ts's isUniqueViolation — without this translation, re-enrolling an
// already-enrolled customer surfaces as an opaque 500 instead of the clean, explicit
// "no accidental re-entry" business error this feature's DoD requires. Drizzle wraps the real
// postgres.js error (with `code`/`constraint_name`) inside a DrizzleQueryError's `.cause` rather
// than exposing those fields on the thrown error itself — checked directly against a live
// duplicate-enrollment insert (postgres.js v3 + drizzle-orm 0.45).
function isUniqueViolation(err: unknown, constraintName: string): boolean {
  const candidate =
    typeof err === 'object' && err !== null && 'cause' in err
      ? (err as { cause?: unknown }).cause
      : err;
  return (
    typeof candidate === 'object' &&
    candidate !== null &&
    (candidate as { code?: unknown }).code === '23505' &&
    (candidate as { constraint_name?: unknown }).constraint_name === constraintName
  );
}

function computeNextEvaluationAt(step: CrmJourneyStep, from: Date): Date {
  if (step.stepType === 'DELAY') {
    return new Date(from.getTime() + (step.delayDays ?? 0) * 24 * 60 * 60 * 1000);
  }
  return from;
}

export class JourneyService {
  // ════════════════════════════════════════════════════════════════════
  // Authoring
  // ════════════════════════════════════════════════════════════════════

  static async create(
    db: ErpDatabase,
    tenantId: number,
    userId: number,
    params: { name: string; segmentId?: number | undefined; steps: JourneyStepInput[] }
  ): Promise<CrmJourney> {
    if (params.steps.length === 0) throw new ValidationError('Journey requires at least one step');

    const [journey] = await db
      .insert(crmJourneys)
      .values({
        tenantId,
        name: params.name,
        segmentId: params.segmentId ?? null,
        createdBy: userId,
      })
      .returning();
    if (!journey) throw new Error('Journey creation failed unexpectedly');

    await JourneyService.insertSteps(db, tenantId, journey.id, params.steps, null, null);
    return journey;
  }

  private static async insertSteps(
    db: ErpDatabase,
    tenantId: number,
    journeyId: number,
    steps: JourneyStepInput[],
    parentStepId: number | null,
    branchPath: 'TRUE' | 'FALSE' | null
  ): Promise<void> {
    for (let i = 0; i < steps.length; i++) {
      const step = steps[i]!;
      validateStep(step);
      const [row] = await db
        .insert(crmJourneySteps)
        .values({
          tenantId,
          journeyId,
          parentStepId,
          branchPath,
          sequence: i + 1,
          stepType: step.stepType,
          delayDays: step.delayDays ?? null,
          channel: step.channel ?? null,
          messageTemplate: step.messageTemplate ?? null,
          branchConditionType: step.branchConditionType ?? null,
          branchWithinDays: step.branchWithinDays ?? null,
        })
        .returning();
      if (!row) throw new Error('Journey step creation failed unexpectedly');

      if (step.stepType === 'BRANCH') {
        if (step.truePath?.length) {
          await JourneyService.insertSteps(db, tenantId, journeyId, step.truePath, row.id, 'TRUE');
        }
        if (step.falsePath?.length) {
          await JourneyService.insertSteps(
            db,
            tenantId,
            journeyId,
            step.falsePath,
            row.id,
            'FALSE'
          );
        }
      }
    }
  }

  static async getJourney(
    db: ErpDatabase,
    tenantId: number,
    journeyId: number
  ): Promise<CrmJourney> {
    const [journey] = await db
      .select()
      .from(crmJourneys)
      .where(and(eq(crmJourneys.id, journeyId), eq(crmJourneys.tenantId, tenantId)));
    if (!journey) throw new NotFoundError('Journey', journeyId);
    return journey;
  }

  static async listJourneys(db: ErpDatabase, tenantId: number): Promise<CrmJourney[]> {
    return db
      .select()
      .from(crmJourneys)
      .where(eq(crmJourneys.tenantId, tenantId))
      .orderBy(sql`created_at DESC`);
  }

  static async getStepsTree(
    db: ErpDatabase,
    tenantId: number,
    journeyId: number
  ): Promise<JourneyStepNode[]> {
    const flat = await db
      .select()
      .from(crmJourneySteps)
      .where(and(eq(crmJourneySteps.journeyId, journeyId), eq(crmJourneySteps.tenantId, tenantId)))
      .orderBy(asc(crmJourneySteps.sequence));
    return JourneyService.buildTree(flat, null, null);
  }

  private static buildTree(
    flat: CrmJourneyStep[],
    parentStepId: number | null,
    branchPath: 'TRUE' | 'FALSE' | null
  ): JourneyStepNode[] {
    return flat
      .filter((s) => s.parentStepId === parentStepId && s.branchPath === branchPath)
      .map((s) => {
        const node: JourneyStepNode = { ...s };
        if (s.stepType === 'BRANCH') {
          node.truePath = JourneyService.buildTree(flat, s.id, 'TRUE');
          node.falsePath = JourneyService.buildTree(flat, s.id, 'FALSE');
        }
        return node;
      });
  }

  /** Preview-affected-count safeguard (roadmap's own required check before publish, not just after). */
  static async previewAffectedCount(
    db: ErpDatabase,
    tenantId: number,
    segmentId: number
  ): Promise<number> {
    const [segment] = await db
      .select()
      .from(customerSegments)
      .where(and(eq(customerSegments.id, segmentId), eq(customerSegments.tenantId, tenantId)));
    if (!segment) throw new NotFoundError('Segment', segmentId);
    const where = await SegmentService.resolveWhere(db, tenantId, {
      code: segment.code,
      isSystem: segment.isSystem,
      filterDefinition: segment.filterDefinition as SegmentFilterDefinition | null,
    });
    return SegmentService.countMatching(db, where);
  }

  static async publish(db: ErpDatabase, tenantId: number, journeyId: number): Promise<CrmJourney> {
    const journey = await JourneyService.getJourney(db, tenantId, journeyId);
    if (journey.status !== 'DRAFT') {
      throw new BusinessError('JOURNEY_NOT_DRAFT', 'Only a DRAFT journey can be published');
    }
    const [firstStep] = await db
      .select({ id: crmJourneySteps.id })
      .from(crmJourneySteps)
      .where(
        and(eq(crmJourneySteps.journeyId, journeyId), sql`${crmJourneySteps.parentStepId} IS NULL`)
      )
      .limit(1);
    if (!firstStep)
      throw new BusinessError('JOURNEY_HAS_NO_STEPS', 'Journey has no steps to publish');

    const [updated] = await db
      .update(crmJourneys)
      .set({
        status: 'PUBLISHED',
        publishedAt: new Date(),
        updatedAt: new Date(),
        version: sql`${crmJourneys.version} + 1`,
      })
      .where(eq(crmJourneys.id, journeyId))
      .returning();
    if (!updated) throw new Error('Journey publish failed unexpectedly');
    return updated;
  }

  /**
   * DRAFT journeys never have enrollments (enrollment requires PUBLISHED), so they're
   * hard-deleted. A published/paused journey is archived instead — its enrollments and step
   * history stay intact for audit, and archiving stops all future evaluation (evaluateDueEnrollments
   * only ever loads PUBLISHED journeys).
   */
  static async archive(db: ErpDatabase, tenantId: number, journeyId: number): Promise<void> {
    const journey = await JourneyService.getJourney(db, tenantId, journeyId);
    if (journey.status === 'DRAFT') {
      await db
        .delete(crmJourneySteps)
        .where(
          and(eq(crmJourneySteps.journeyId, journeyId), eq(crmJourneySteps.tenantId, tenantId))
        );
      await db.delete(crmJourneys).where(eq(crmJourneys.id, journeyId));
      return;
    }
    await db
      .update(crmJourneys)
      .set({ status: 'ARCHIVED', updatedAt: new Date(), version: sql`${crmJourneys.version} + 1` })
      .where(eq(crmJourneys.id, journeyId));
  }

  // ════════════════════════════════════════════════════════════════════
  // Enrollment
  // ════════════════════════════════════════════════════════════════════

  static async listEnrollments(
    db: ErpDatabase,
    tenantId: number,
    journeyId: number
  ): Promise<CrmJourneyEnrollment[]> {
    return db
      .select()
      .from(crmJourneyEnrollments)
      .where(
        and(
          eq(crmJourneyEnrollments.tenantId, tenantId),
          eq(crmJourneyEnrollments.journeyId, journeyId)
        )
      )
      .orderBy(sql`enrolled_at DESC`);
  }

  /** Per-step entered/completed/exited counts — the roadmap's "see per-step conversion" acceptance criterion. */
  static async getFunnelStats(
    db: ErpDatabase,
    tenantId: number,
    journeyId: number
  ): Promise<Array<{ stepId: number; entered: number; completed: number; exited: number }>> {
    const rows = await db
      .select({
        stepId: crmJourneyStepEvents.stepId,
        eventType: crmJourneyStepEvents.eventType,
        count: sql<number>`count(*)::int`,
      })
      .from(crmJourneyStepEvents)
      .where(
        and(
          eq(crmJourneyStepEvents.tenantId, tenantId),
          eq(crmJourneyStepEvents.journeyId, journeyId),
          isNotNull(crmJourneyStepEvents.stepId)
        )
      )
      .groupBy(crmJourneyStepEvents.stepId, crmJourneyStepEvents.eventType);

    const byStep = new Map<
      number,
      { stepId: number; entered: number; completed: number; exited: number }
    >();
    for (const row of rows) {
      if (row.stepId === null) continue;
      const entry = byStep.get(row.stepId) ?? {
        stepId: row.stepId,
        entered: 0,
        completed: 0,
        exited: 0,
      };
      if (row.eventType === 'ENTERED') entry.entered = row.count;
      if (row.eventType === 'COMPLETED') entry.completed = row.count;
      if (row.eventType === 'EXITED') entry.exited = row.count;
      byStep.set(row.stepId, entry);
    }
    return Array.from(byStep.values());
  }

  private static async firstStep(
    db: ErpDatabase,
    tenantId: number,
    journeyId: number
  ): Promise<CrmJourneyStep> {
    const [step] = await db
      .select()
      .from(crmJourneySteps)
      .where(
        and(
          eq(crmJourneySteps.journeyId, journeyId),
          eq(crmJourneySteps.tenantId, tenantId),
          sql`${crmJourneySteps.parentStepId} IS NULL`
        )
      )
      .orderBy(asc(crmJourneySteps.sequence))
      .limit(1);
    if (!step) throw new BusinessError('JOURNEY_HAS_NO_STEPS', 'Journey has no steps');
    return step;
  }

  /** Manual, single-customer enrollment (POST /journeys/:id/enrollments). */
  static async enrollCustomer(
    db: ErpDatabase,
    tenantId: number,
    journeyId: number,
    customerId: number
  ): Promise<CrmJourneyEnrollment> {
    const journey = await JourneyService.getJourney(db, tenantId, journeyId);
    if (journey.status !== 'PUBLISHED') {
      throw new BusinessError(
        'JOURNEY_NOT_PUBLISHED',
        'Journey must be published before customers can be enrolled'
      );
    }
    const step = await JourneyService.firstStep(db, tenantId, journeyId);
    const now = new Date();

    try {
      const [enrollment] = await db
        .insert(crmJourneyEnrollments)
        .values({
          tenantId,
          journeyId,
          customerId,
          currentStepId: step.id,
          currentStepEnteredAt: now,
          nextEvaluationAt: computeNextEvaluationAt(step, now),
          enrolledAt: now,
        })
        .returning();
      if (!enrollment) throw new Error('Journey enrollment failed unexpectedly');
      await db.insert(crmJourneyStepEvents).values({
        tenantId,
        journeyId,
        enrollmentId: enrollment.id,
        stepId: step.id,
        eventType: 'ENTERED',
      });
      return enrollment;
    } catch (err) {
      if (isUniqueViolation(err, 'crm_journey_enrollments_journey_customer_unique')) {
        throw new BusinessError(
          'ALREADY_ENROLLED',
          'This customer has already been enrolled in this journey and cannot re-enter it'
        );
      }
      throw err;
    }
  }

  /** Enrolls segment members who match but aren't yet enrolled. Returns the count newly enrolled. */
  private static async enrollNewMatches(
    db: ErpDatabase,
    tenantId: number,
    journey: CrmJourney,
    step: CrmJourneyStep
  ): Promise<number> {
    if (!journey.segmentId) return 0;
    const [segment] = await db
      .select()
      .from(customerSegments)
      .where(
        and(eq(customerSegments.id, journey.segmentId), eq(customerSegments.tenantId, tenantId))
      );
    if (!segment) return 0;

    const where: SQL = await SegmentService.resolveWhere(db, tenantId, {
      code: segment.code,
      isSystem: segment.isSystem,
      filterDefinition: segment.filterDefinition as SegmentFilterDefinition | null,
    });
    const matches = await db.select({ id: customers.id }).from(customers).where(where);
    if (matches.length === 0) return 0;

    const existing = await db
      .select({ customerId: crmJourneyEnrollments.customerId })
      .from(crmJourneyEnrollments)
      .where(
        and(
          eq(crmJourneyEnrollments.tenantId, tenantId),
          eq(crmJourneyEnrollments.journeyId, journey.id)
        )
      );
    const existingIds = new Set(existing.map((e) => e.customerId));
    const newCustomerIds = matches.map((m) => m.id).filter((id) => !existingIds.has(id));
    if (newCustomerIds.length === 0) return 0;

    const now = new Date();
    const nextEvaluationAt = computeNextEvaluationAt(step, now);
    for (const customerId of newCustomerIds) {
      const [enrollment] = await db
        .insert(crmJourneyEnrollments)
        .values({
          tenantId,
          journeyId: journey.id,
          customerId,
          currentStepId: step.id,
          currentStepEnteredAt: now,
          nextEvaluationAt,
          enrolledAt: now,
        })
        .returning();
      if (enrollment) {
        await db.insert(crmJourneyStepEvents).values({
          tenantId,
          journeyId: journey.id,
          enrollmentId: enrollment.id,
          stepId: step.id,
          eventType: 'ENTERED',
        });
      }
    }
    return newCustomerIds.length;
  }

  // ════════════════════════════════════════════════════════════════════
  // Evaluation (scheduler-driven state-machine tick — AR-3)
  // ════════════════════════════════════════════════════════════════════

  private static async evaluateBranchCondition(
    db: ErpDatabase,
    tenantId: number,
    step: CrmJourneyStep,
    enrollment: CrmJourneyEnrollment
  ): Promise<boolean> {
    if (step.branchConditionType === 'MADE_PURCHASE') {
      const [purchase] = await db
        .select({ id: invoices.id })
        .from(invoices)
        .where(
          and(
            eq(invoices.tenantId, tenantId),
            eq(invoices.customerId, enrollment.customerId),
            gt(invoices.invoiceDate, enrollment.enrolledAt),
            notInArray(invoices.status, ['DRAFT', 'CANCELLED'])
          )
        )
        .limit(1);
      return !!purchase;
    }
    // Unknown/unset condition type — degrade gracefully to FALSE rather than throw, so a bad
    // journey definition never wedges the scheduler tick for every other enrollment.
    return false;
  }

  private static async moveTo(
    db: ErpDatabase,
    tenantId: number,
    enrollment: CrmJourneyEnrollment,
    next: CrmJourneyStep
  ): Promise<void> {
    const now = new Date();
    await db
      .update(crmJourneyEnrollments)
      .set({
        currentStepId: next.id,
        currentStepEnteredAt: now,
        nextEvaluationAt: computeNextEvaluationAt(next, now),
        updatedAt: now,
        version: sql`${crmJourneyEnrollments.version} + 1`,
      })
      .where(eq(crmJourneyEnrollments.id, enrollment.id));
    await db.insert(crmJourneyStepEvents).values({
      tenantId,
      journeyId: enrollment.journeyId,
      enrollmentId: enrollment.id,
      stepId: next.id,
      eventType: 'ENTERED',
    });
  }

  private static async completeEnrollment(
    db: ErpDatabase,
    tenantId: number,
    enrollment: CrmJourneyEnrollment
  ): Promise<void> {
    const now = new Date();
    await db
      .update(crmJourneyEnrollments)
      .set({
        status: 'COMPLETED',
        completedAt: now,
        nextEvaluationAt: null,
        updatedAt: now,
        version: sql`${crmJourneyEnrollments.version} + 1`,
      })
      .where(eq(crmJourneyEnrollments.id, enrollment.id));
    await db.insert(crmJourneyStepEvents).values({
      tenantId,
      journeyId: enrollment.journeyId,
      enrollmentId: enrollment.id,
      stepId: enrollment.currentStepId,
      eventType: 'COMPLETED',
    });
  }

  private static async exitEnrollment(
    db: ErpDatabase,
    tenantId: number,
    enrollment: CrmJourneyEnrollment,
    reason: 'OPTED_OUT' | 'MANUAL'
  ): Promise<void> {
    const now = new Date();
    await db
      .update(crmJourneyEnrollments)
      .set({
        status: 'EXITED',
        exitedAt: now,
        exitReason: reason,
        nextEvaluationAt: null,
        updatedAt: now,
        version: sql`${crmJourneyEnrollments.version} + 1`,
      })
      .where(eq(crmJourneyEnrollments.id, enrollment.id));
    await db.insert(crmJourneyStepEvents).values({
      tenantId,
      journeyId: enrollment.journeyId,
      enrollmentId: enrollment.id,
      stepId: enrollment.currentStepId,
      eventType: 'EXITED',
      metadata: { reason },
    });
  }

  private static async advance(
    db: ErpDatabase,
    tenantId: number,
    enrollment: CrmJourneyEnrollment,
    currentStep: CrmJourneyStep,
    allSteps: CrmJourneyStep[]
  ): Promise<void> {
    const next = allSteps
      .filter(
        (s) =>
          s.parentStepId === currentStep.parentStepId &&
          s.branchPath === currentStep.branchPath &&
          s.sequence === currentStep.sequence + 1
      )
      .sort((a, b) => a.sequence - b.sequence)[0];
    if (next) {
      await JourneyService.moveTo(db, tenantId, enrollment, next);
    } else {
      await JourneyService.completeEnrollment(db, tenantId, enrollment);
    }
  }

  /** One state-machine tick for a single due enrollment. */
  private static async evaluateEnrollment(
    ctx: PlatformContext,
    journey: CrmJourney,
    enrollment: CrmJourneyEnrollment,
    allSteps: CrmJourneyStep[]
  ): Promise<void> {
    const db = ctx.db.raw;
    const tenantId = ctx.tenant.tenantId;
    const currentStep = allSteps.find((s) => s.id === enrollment.currentStepId);
    if (!currentStep) {
      await JourneyService.completeEnrollment(db, tenantId, enrollment);
      return;
    }

    if (currentStep.stepType === 'DELAY') {
      // The wait already elapsed (that's why this enrollment's nextEvaluationAt was due) —
      // nothing left to do but move on.
      await JourneyService.advance(db, tenantId, enrollment, currentStep, allSteps);
      return;
    }

    if (currentStep.stepType === 'BRANCH') {
      const result = await JourneyService.evaluateBranchCondition(
        db,
        tenantId,
        currentStep,
        enrollment
      );
      const branchPath: 'TRUE' | 'FALSE' = result ? 'TRUE' : 'FALSE';
      const next = allSteps
        .filter((s) => s.parentStepId === currentStep.id && s.branchPath === branchPath)
        .sort((a, b) => a.sequence - b.sequence)[0];
      if (next) {
        await JourneyService.moveTo(db, tenantId, enrollment, next);
      } else {
        await JourneyService.completeEnrollment(db, tenantId, enrollment);
      }
      return;
    }

    // ACTION — reuses CampaignService.send() with a single-customer campaign, exactly the
    // pattern CampaignService.fireAutomationRule already established for automation rules.
    try {
      const [campaign] = await db
        .insert(campaigns)
        .values({
          tenantId,
          name: `[Journey] ${journey.name} — step ${currentStep.sequence}`,
          customerIds: [enrollment.customerId],
          channel: currentStep.channel!,
          messageTemplate: currentStep.messageTemplate ?? 'Hi {{customerName}}!',
          campaignType: 'JOURNEY_STEP',
          status: 'DRAFT',
          createdBy: journey.createdBy,
          // Auto-approved for the same reason CP-7's recurring occurrences and automation rules
          // are: the journey itself was already reviewed when it was published.
          approvalStatus: 'APPROVED',
          approvedBy: journey.createdBy,
          approvedAt: new Date(),
        })
        .returning();
      if (!campaign) throw new Error('Journey step campaign creation failed unexpectedly');

      await CampaignService.send(ctx, campaign.id);
      await JourneyService.advance(db, tenantId, enrollment, currentStep, allSteps);
    } catch (err) {
      if (err instanceof BusinessError && err.code === 'NO_RECIPIENTS') {
        // resolveRecipients() filtered this customer out — opted out or consent-revoked since
        // enrolling. A clean exit, not a retry-worthy failure: a published journey must never
        // become a way to bypass consent.
        await JourneyService.exitEnrollment(db, tenantId, enrollment, 'OPTED_OUT');
        return;
      }
      logger.warn(
        { err, enrollmentId: enrollment.id },
        'Journey ACTION step failed, will retry next tick'
      );
    }
  }

  /**
   * Per-tenant orchestrator: called once per scheduler tick. Checks the rollback feature flag
   * first (per this feature's own DoD — must stop all further evaluation immediately when
   * toggled off, no deploy required), then enrolls new segment matches and evaluates every due
   * enrollment for every PUBLISHED journey.
   */
  static async evaluateDueEnrollments(
    ctx: PlatformContext
  ): Promise<{ enrolled: number; evaluated: number }> {
    const engineEnabled = await ctx.features.isEnabled('crm.journey_engine.enabled');
    if (!engineEnabled) return { enrolled: 0, evaluated: 0 };

    const db = ctx.db.raw;
    const tenantId = ctx.tenant.tenantId;
    const journeys = await db
      .select()
      .from(crmJourneys)
      .where(and(eq(crmJourneys.tenantId, tenantId), eq(crmJourneys.status, 'PUBLISHED')));

    let enrolled = 0;
    let evaluated = 0;
    for (const journey of journeys) {
      const steps = await db
        .select()
        .from(crmJourneySteps)
        .where(
          and(eq(crmJourneySteps.journeyId, journey.id), eq(crmJourneySteps.tenantId, tenantId))
        );
      const first = steps
        .filter((s) => s.parentStepId === null)
        .sort((a, b) => a.sequence - b.sequence)[0];
      if (!first) continue;

      enrolled += await JourneyService.enrollNewMatches(db, tenantId, journey, first);

      const now = new Date();
      const due = await db
        .select()
        .from(crmJourneyEnrollments)
        .where(
          and(
            eq(crmJourneyEnrollments.tenantId, tenantId),
            eq(crmJourneyEnrollments.journeyId, journey.id),
            eq(crmJourneyEnrollments.status, 'ACTIVE'),
            lte(crmJourneyEnrollments.nextEvaluationAt, now)
          )
        );

      for (const enrollment of due) {
        try {
          await JourneyService.evaluateEnrollment(ctx, journey, enrollment, steps);
          evaluated++;
        } catch (err) {
          logger.warn(
            { err, enrollmentId: enrollment.id },
            'Journey enrollment evaluation failed, will retry next tick'
          );
        }
      }
    }
    return { enrolled, evaluated };
  }
}
