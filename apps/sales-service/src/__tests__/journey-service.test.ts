// CRM-ROADMAP Phase 2, Feature 2 (Visual Customer Journey Builder). DB-backed integration
// tests only — every method here touches Postgres (journeys/steps/enrollments/campaigns), so
// there's no meaningful pure-function slice to test in isolation. Skipped without DATABASE_URL,
// matching campaign-service.test.ts / segment-service.test.ts's own convention.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createDatabaseClient } from '@erp/db';
import {
  branches,
  customers,
  invoices,
  customerSegments,
  campaigns,
  campaignRecipients,
  crmJourneys,
  crmJourneySteps,
  crmJourneyEnrollments,
  crmJourneyStepEvents,
} from '@erp/db';
import { eq } from 'drizzle-orm';
import type { PlatformContext } from '@erp/sdk';
import { BusinessError } from '@erp/types';
import { JourneyService } from '../domain/JourneyService.js';

const DB_URL = process.env['DATABASE_URL'];

describe.skipIf(!DB_URL)('JourneyService — integration (CRM-ROADMAP Phase 2, Feature 2)', () => {
  let db: ReturnType<typeof createDatabaseClient>;
  const TEST_TENANT = 900_501 + Math.floor(Math.random() * 1000);
  let branchId: number;

  function makeCtx(featureEnabled = true): PlatformContext {
    return {
      db: { raw: db },
      tenant: { tenantId: TEST_TENANT, userId: 1 },
      events: { publish: async () => undefined },
      audit: { log: async () => undefined },
      features: { isEnabled: async () => featureEnabled },
    } as unknown as PlatformContext;
  }

  async function makeCustomer(
    displayName: string,
    opts?: { optOutEmail?: boolean }
  ): Promise<number> {
    const [row] = await db
      .insert(customers)
      .values({
        tenantId: TEST_TENANT,
        branchId,
        displayName,
        phone: `9${Math.floor(100000000 + Math.random() * 899999999)}`,
        creditLimit: '0',
        openingBalance: '0',
        optOutEmail: opts?.optOutEmail ?? false,
        createdBy: 1,
      })
      .returning();
    return row!.id;
  }

  async function markPastDue(enrollmentId: number, when: Date): Promise<void> {
    await db
      .update(crmJourneyEnrollments)
      .set({ nextEvaluationAt: when })
      .where(eq(crmJourneyEnrollments.id, enrollmentId));
  }

  async function reload(enrollmentId: number) {
    const [row] = await db
      .select()
      .from(crmJourneyEnrollments)
      .where(eq(crmJourneyEnrollments.id, enrollmentId));
    return row!;
  }

  beforeAll(async () => {
    db = createDatabaseClient({ url: DB_URL! });
    const [branch] = await db
      .insert(branches)
      .values({
        tenantId: TEST_TENANT,
        name: 'Journey Test HO',
        code: 'JHO',
        isHeadOffice: true,
        isActive: true,
        createdBy: 1,
      })
      .returning();
    branchId = branch!.id;
  });

  afterAll(async () => {
    await db.delete(crmJourneyStepEvents).where(eq(crmJourneyStepEvents.tenantId, TEST_TENANT));
    await db.delete(crmJourneyEnrollments).where(eq(crmJourneyEnrollments.tenantId, TEST_TENANT));
    await db.delete(crmJourneySteps).where(eq(crmJourneySteps.tenantId, TEST_TENANT));
    await db.delete(crmJourneys).where(eq(crmJourneys.tenantId, TEST_TENANT));
    await db.delete(campaignRecipients).where(eq(campaignRecipients.tenantId, TEST_TENANT));
    await db.delete(campaigns).where(eq(campaigns.tenantId, TEST_TENANT));
    await db.delete(customerSegments).where(eq(customerSegments.tenantId, TEST_TENANT));
    await db.delete(invoices).where(eq(invoices.tenantId, TEST_TENANT));
    await db.delete(customers).where(eq(customers.tenantId, TEST_TENANT));
    await db.delete(branches).where(eq(branches.tenantId, TEST_TENANT));
  });

  describe('create / getStepsTree', () => {
    it('persists nested branch steps and reconstructs the same tree', async () => {
      const journey = await JourneyService.create(db, TEST_TENANT, 1, {
        name: 'Tree Test',
        steps: [
          { stepType: 'DELAY', delayDays: 3 },
          {
            stepType: 'BRANCH',
            branchConditionType: 'MADE_PURCHASE',
            branchWithinDays: 7,
            truePath: [{ stepType: 'ACTION', channel: 'EMAIL', messageTemplate: 'Thanks!' }],
            falsePath: [{ stepType: 'ACTION', channel: 'EMAIL', messageTemplate: 'Come back!' }],
          },
        ],
      });

      const tree = await JourneyService.getStepsTree(db, TEST_TENANT, journey.id);
      expect(tree).toHaveLength(2);
      expect(tree[0]!.stepType).toBe('DELAY');
      expect(tree[1]!.stepType).toBe('BRANCH');
      expect(tree[1]!.truePath).toHaveLength(1);
      expect(tree[1]!.truePath![0]!.messageTemplate).toBe('Thanks!');
      expect(tree[1]!.falsePath).toHaveLength(1);
      expect(tree[1]!.falsePath![0]!.messageTemplate).toBe('Come back!');
    });

    it('rejects a journey with zero steps', async () => {
      await expect(
        JourneyService.create(db, TEST_TENANT, 1, { name: 'Empty', steps: [] })
      ).rejects.toThrow('at least one step');
    });
  });

  describe('publish', () => {
    it('moves a DRAFT journey with steps to PUBLISHED', async () => {
      const journey = await JourneyService.create(db, TEST_TENANT, 1, {
        name: 'Publish Test',
        steps: [{ stepType: 'ACTION', channel: 'EMAIL', messageTemplate: 'Hi' }],
      });
      const updated = await JourneyService.publish(db, TEST_TENANT, journey.id);
      expect(updated.status).toBe('PUBLISHED');
      expect(updated.publishedAt).not.toBeNull();
    });

    it('rejects publishing a journey that is not DRAFT', async () => {
      const journey = await JourneyService.create(db, TEST_TENANT, 1, {
        name: 'Publish Twice',
        steps: [{ stepType: 'ACTION', channel: 'EMAIL', messageTemplate: 'Hi' }],
      });
      await JourneyService.publish(db, TEST_TENANT, journey.id);
      await expect(JourneyService.publish(db, TEST_TENANT, journey.id)).rejects.toThrow(
        'Only a DRAFT journey can be published'
      );
    });
  });

  describe('previewAffectedCount', () => {
    it('returns the live matching count for the journey segment', async () => {
      await makeCustomer('JourneyTest PreviewMatch A');
      await makeCustomer('JourneyTest PreviewMatch B');
      const [segment] = await db
        .insert(customerSegments)
        .values({
          tenantId: TEST_TENANT,
          name: 'Preview Segment',
          code: `preview-${TEST_TENANT}`,
          isSystem: false,
          filterDefinition: {
            rules: [{ field: 'displayName', operator: 'contains', value: 'PreviewMatch' }],
            logic: 'AND',
          },
          createdBy: 1,
        })
        .returning();

      const count = await JourneyService.previewAffectedCount(db, TEST_TENANT, segment!.id);
      expect(count).toBe(2);
    });
  });

  describe('enrollCustomer (manual, single-customer)', () => {
    it('creates an ACTIVE enrollment at the journey first step', async () => {
      const customerId = await makeCustomer('JourneyTest Manual Enroll');
      const journey = await JourneyService.create(db, TEST_TENANT, 1, {
        name: 'Manual Enroll Test',
        steps: [{ stepType: 'ACTION', channel: 'EMAIL', messageTemplate: 'Welcome' }],
      });
      await JourneyService.publish(db, TEST_TENANT, journey.id);

      const enrollment = await JourneyService.enrollCustomer(
        db,
        TEST_TENANT,
        journey.id,
        customerId
      );
      expect(enrollment.status).toBe('ACTIVE');
      expect(enrollment.customerId).toBe(customerId);
    });

    it('rejects enrolling into a journey that is not PUBLISHED', async () => {
      const customerId = await makeCustomer('JourneyTest Not Published');
      const journey = await JourneyService.create(db, TEST_TENANT, 1, {
        name: 'Draft Journey',
        steps: [{ stepType: 'ACTION', channel: 'EMAIL', messageTemplate: 'Hi' }],
      });
      await expect(
        JourneyService.enrollCustomer(db, TEST_TENANT, journey.id, customerId)
      ).rejects.toThrow('must be published');
    });

    // Edge case per the roadmap: re-entry rules must be explicit, not accidental — the DB's own
    // UNIQUE(journey_id, customer_id) constraint is the structural guarantee, surfaced here as a
    // clean business error rather than an opaque 500.
    it('blocks a second enrollment for the same customer in the same journey (no accidental re-entry)', async () => {
      const customerId = await makeCustomer('JourneyTest ReEntry');
      const journey = await JourneyService.create(db, TEST_TENANT, 1, {
        name: 'Re-Entry Test',
        steps: [{ stepType: 'ACTION', channel: 'EMAIL', messageTemplate: 'Hi' }],
      });
      await JourneyService.publish(db, TEST_TENANT, journey.id);
      await JourneyService.enrollCustomer(db, TEST_TENANT, journey.id, customerId);

      await expect(
        JourneyService.enrollCustomer(db, TEST_TENANT, journey.id, customerId)
      ).rejects.toThrow(/already been enrolled/);
    });
  });

  describe('evaluateDueEnrollments — feature flag gate', () => {
    it('is a no-op when crm.journey_engine.enabled is false (rollback verified)', async () => {
      const customerId = await makeCustomer('JourneyTest FlagGate');
      const journey = await JourneyService.create(db, TEST_TENANT, 1, {
        name: 'Flag Gate Test',
        steps: [{ stepType: 'ACTION', channel: 'EMAIL', messageTemplate: 'Hi' }],
      });
      await JourneyService.publish(db, TEST_TENANT, journey.id);
      const enrollment = await JourneyService.enrollCustomer(
        db,
        TEST_TENANT,
        journey.id,
        customerId
      );

      const result = await JourneyService.evaluateDueEnrollments(makeCtx(false));
      expect(result).toEqual({ enrolled: 0, evaluated: 0 });

      const reloaded = await reload(enrollment.id);
      expect(reloaded.status).toBe('ACTIVE');
      expect(reloaded.currentStepId).toBe(enrollment.currentStepId);
    });
  });

  describe('evaluateDueEnrollments — DELAY step', () => {
    it('advances to the next step once the wait has elapsed', async () => {
      const customerId = await makeCustomer('JourneyTest Delay');
      const journey = await JourneyService.create(db, TEST_TENANT, 1, {
        name: 'Delay Test',
        steps: [
          { stepType: 'DELAY', delayDays: 3 },
          { stepType: 'ACTION', channel: 'EMAIL', messageTemplate: 'After delay' },
        ],
      });
      await JourneyService.publish(db, TEST_TENANT, journey.id);
      const enrollment = await JourneyService.enrollCustomer(
        db,
        TEST_TENANT,
        journey.id,
        customerId
      );

      const steps = await db
        .select()
        .from(crmJourneySteps)
        .where(eq(crmJourneySteps.journeyId, journey.id));
      const delayStep = steps.find((s) => s.stepType === 'DELAY')!;
      const actionStep = steps.find((s) => s.stepType === 'ACTION')!;
      expect(enrollment.currentStepId).toBe(delayStep.id);

      // Not due yet — a tick right now must not advance it.
      await JourneyService.evaluateDueEnrollments(makeCtx());
      expect((await reload(enrollment.id)).currentStepId).toBe(delayStep.id);

      // Simulate the 3 days elapsing.
      await markPastDue(enrollment.id, new Date(Date.now() - 1000));
      await JourneyService.evaluateDueEnrollments(makeCtx());
      const afterDelay = await reload(enrollment.id);
      expect(afterDelay.currentStepId).toBe(actionStep.id);
      expect(afterDelay.status).toBe('ACTIVE');
    });
  });

  describe('evaluateDueEnrollments — ACTION step', () => {
    it('sends via CampaignService.send() and completes the enrollment when it was the last step', async () => {
      const customerId = await makeCustomer('JourneyTest Action');
      const journey = await JourneyService.create(db, TEST_TENANT, 1, {
        name: 'Action Test',
        steps: [
          { stepType: 'ACTION', channel: 'EMAIL', messageTemplate: 'Welcome {{customerName}}!' },
        ],
      });
      await JourneyService.publish(db, TEST_TENANT, journey.id);
      const enrollment = await JourneyService.enrollCustomer(
        db,
        TEST_TENANT,
        journey.id,
        customerId
      );

      await JourneyService.evaluateDueEnrollments(makeCtx());

      const reloaded = await reload(enrollment.id);
      expect(reloaded.status).toBe('COMPLETED');
      expect(reloaded.completedAt).not.toBeNull();

      const sentCampaigns = await db
        .select()
        .from(campaigns)
        .where(eq(campaigns.tenantId, TEST_TENANT));
      // Filtered by customerId, not just campaignType — other tests in this suite share
      // TEST_TENANT and also create JOURNEY_STEP campaigns for their own customers.
      const journeyCampaign = sentCampaigns.find(
        (c) =>
          c.campaignType === 'JOURNEY_STEP' &&
          (c.customerIds as number[] | null)?.includes(customerId)
      );
      expect(journeyCampaign).toBeTruthy();
      expect(journeyCampaign!.customerIds).toEqual([customerId]);

      const recipientRows = await db
        .select()
        .from(campaignRecipients)
        .where(eq(campaignRecipients.campaignId, journeyCampaign!.id));
      expect(recipientRows).toHaveLength(1);
      expect(recipientRows[0]!.customerId).toBe(customerId);
    });

    // Edge case per the roadmap: a published journey must not become a way to bypass consent —
    // a customer who opted out mid-journey must exit cleanly, not retry forever.
    it('exits an enrollment as OPTED_OUT when the customer has no sendable recipients', async () => {
      const customerId = await makeCustomer('JourneyTest OptedOut', { optOutEmail: true });
      const journey = await JourneyService.create(db, TEST_TENANT, 1, {
        name: 'Opt Out Test',
        steps: [{ stepType: 'ACTION', channel: 'EMAIL', messageTemplate: 'Hi' }],
      });
      await JourneyService.publish(db, TEST_TENANT, journey.id);
      const enrollment = await JourneyService.enrollCustomer(
        db,
        TEST_TENANT,
        journey.id,
        customerId
      );

      await JourneyService.evaluateDueEnrollments(makeCtx());

      const reloaded = await reload(enrollment.id);
      expect(reloaded.status).toBe('EXITED');
      expect(reloaded.exitReason).toBe('OPTED_OUT');
    });
  });

  describe('evaluateDueEnrollments — BRANCH step', () => {
    async function makeBranchJourney() {
      return JourneyService.create(db, TEST_TENANT, 1, {
        name: `Branch Test ${Date.now()}-${Math.random()}`,
        steps: [
          {
            stepType: 'BRANCH',
            branchConditionType: 'MADE_PURCHASE',
            branchWithinDays: 30,
            truePath: [
              { stepType: 'ACTION', channel: 'EMAIL', messageTemplate: 'Thanks for buying!' },
            ],
            falsePath: [{ stepType: 'ACTION', channel: 'EMAIL', messageTemplate: 'Come back!' }],
          },
        ],
      });
    }

    it('routes to the TRUE path when the customer purchased after enrolling', async () => {
      const customerId = await makeCustomer('JourneyTest Branch Purchased');
      const journey = await makeBranchJourney();
      await JourneyService.publish(db, TEST_TENANT, journey.id);
      const enrollment = await JourneyService.enrollCustomer(
        db,
        TEST_TENANT,
        journey.id,
        customerId
      );

      await db.insert(invoices).values({
        tenantId: TEST_TENANT,
        branchId,
        warehouseId: branchId,
        customerId,
        invoiceNumber: `JT-${Date.now()}`,
        placeOfSupply: '27',
        invoiceDate: new Date(),
        dueDate: new Date(Date.now() + 30 * 86_400_000),
        status: 'CONFIRMED',
        subtotal: '100',
        taxableAmount: '100',
        grandTotal: '100',
        paidAmount: '0',
        createdBy: 1,
      } as unknown as typeof invoices.$inferInsert);

      await JourneyService.evaluateDueEnrollments(makeCtx());

      const steps = await db
        .select()
        .from(crmJourneySteps)
        .where(eq(crmJourneySteps.journeyId, journey.id));
      const trueStep = steps.find((s) => s.branchPath === 'TRUE')!;
      const reloaded = await reload(enrollment.id);
      expect(reloaded.currentStepId).toBe(trueStep.id);
    });

    it('routes to the FALSE path when the customer has not purchased', async () => {
      const customerId = await makeCustomer('JourneyTest Branch NoPurchase');
      const journey = await makeBranchJourney();
      await JourneyService.publish(db, TEST_TENANT, journey.id);
      const enrollment = await JourneyService.enrollCustomer(
        db,
        TEST_TENANT,
        journey.id,
        customerId
      );

      await JourneyService.evaluateDueEnrollments(makeCtx());

      const steps = await db
        .select()
        .from(crmJourneySteps)
        .where(eq(crmJourneySteps.journeyId, journey.id));
      const falseStep = steps.find((s) => s.branchPath === 'FALSE')!;
      const reloaded = await reload(enrollment.id);
      expect(reloaded.currentStepId).toBe(falseStep.id);
    });
  });

  describe('evaluateDueEnrollments — segment-driven auto-enrollment', () => {
    it('enrolls new segment matches and skips already-enrolled customers on the next tick', async () => {
      const customerId = await makeCustomer('JourneyTest AutoEnroll');
      const [segment] = await db
        .insert(customerSegments)
        .values({
          tenantId: TEST_TENANT,
          name: 'Auto Enroll Segment',
          code: `auto-enroll-${TEST_TENANT}`,
          isSystem: false,
          filterDefinition: {
            rules: [{ field: 'displayName', operator: 'contains', value: 'AutoEnroll' }],
            logic: 'AND',
          },
          createdBy: 1,
        })
        .returning();

      const journey = await JourneyService.create(db, TEST_TENANT, 1, {
        name: 'Auto Enroll Journey',
        segmentId: segment!.id,
        steps: [{ stepType: 'DELAY', delayDays: 30 }],
      });
      await JourneyService.publish(db, TEST_TENANT, journey.id);

      const firstTick = await JourneyService.evaluateDueEnrollments(makeCtx());
      expect(firstTick.enrolled).toBe(1);

      const enrollments = await db
        .select()
        .from(crmJourneyEnrollments)
        .where(eq(crmJourneyEnrollments.journeyId, journey.id));
      expect(enrollments).toHaveLength(1);
      expect(enrollments[0]!.customerId).toBe(customerId);

      const secondTick = await JourneyService.evaluateDueEnrollments(makeCtx());
      expect(secondTick.enrolled).toBe(0);
    });
  });

  describe('full lifecycle — ACTION -> DELAY -> BRANCH', () => {
    it('a customer progresses through all 3 steps and completes down the TRUE path', async () => {
      const customerId = await makeCustomer('JourneyTest FullLifecycle');
      const journey = await JourneyService.create(db, TEST_TENANT, 1, {
        name: 'Full Lifecycle Test',
        steps: [
          { stepType: 'ACTION', channel: 'EMAIL', messageTemplate: 'Welcome!' },
          { stepType: 'DELAY', delayDays: 3 },
          {
            stepType: 'BRANCH',
            branchConditionType: 'MADE_PURCHASE',
            branchWithinDays: 7,
            truePath: [
              { stepType: 'ACTION', channel: 'EMAIL', messageTemplate: 'Thanks for buying!' },
            ],
            falsePath: [{ stepType: 'ACTION', channel: 'EMAIL', messageTemplate: 'We miss you!' }],
          },
        ],
      });
      await JourneyService.publish(db, TEST_TENANT, journey.id);
      const enrollment = await JourneyService.enrollCustomer(
        db,
        TEST_TENANT,
        journey.id,
        customerId
      );

      const allSteps = await db
        .select()
        .from(crmJourneySteps)
        .where(eq(crmJourneySteps.journeyId, journey.id));
      const welcomeStep = allSteps.find((s) => s.stepType === 'ACTION' && s.parentStepId === null)!;
      const delayStep = allSteps.find((s) => s.stepType === 'DELAY')!;
      const branchStep = allSteps.find((s) => s.stepType === 'BRANCH')!;
      const trueStep = allSteps.find((s) => s.branchPath === 'TRUE')!;

      expect(enrollment.currentStepId).toBe(welcomeStep.id);

      // Tick 1: sends the welcome ACTION, advances to DELAY.
      await JourneyService.evaluateDueEnrollments(makeCtx());
      expect((await reload(enrollment.id)).currentStepId).toBe(delayStep.id);

      // Customer purchases during the delay window.
      await db.insert(invoices).values({
        tenantId: TEST_TENANT,
        branchId,
        warehouseId: branchId,
        customerId,
        invoiceNumber: `JT-FULL-${Date.now()}`,
        placeOfSupply: '27',
        invoiceDate: new Date(),
        dueDate: new Date(Date.now() + 30 * 86_400_000),
        status: 'CONFIRMED',
        subtotal: '100',
        taxableAmount: '100',
        grandTotal: '100',
        paidAmount: '0',
        createdBy: 1,
      } as unknown as typeof invoices.$inferInsert);

      // Simulate the 3-day wait elapsing.
      await markPastDue(enrollment.id, new Date(Date.now() - 1000));

      // Tick 2: DELAY elapsed, advances to BRANCH.
      await JourneyService.evaluateDueEnrollments(makeCtx());
      expect((await reload(enrollment.id)).currentStepId).toBe(branchStep.id);

      // Tick 3: BRANCH evaluates TRUE (purchase found), moves to the TRUE-path ACTION step.
      await JourneyService.evaluateDueEnrollments(makeCtx());
      expect((await reload(enrollment.id)).currentStepId).toBe(trueStep.id);

      // Tick 4: sends the TRUE-path ACTION; no further step -> journey completes.
      await JourneyService.evaluateDueEnrollments(makeCtx());
      const final = await reload(enrollment.id);
      expect(final.status).toBe('COMPLETED');
      expect(final.completedAt).not.toBeNull();

      const events = await db
        .select()
        .from(crmJourneyStepEvents)
        .where(eq(crmJourneyStepEvents.enrollmentId, enrollment.id));
      expect(events.filter((e) => e.eventType === 'ENTERED').length).toBeGreaterThanOrEqual(4);
      expect(events.filter((e) => e.eventType === 'COMPLETED')).toHaveLength(1);
    });
  });

  describe('archive', () => {
    it('hard-deletes a DRAFT journey and its steps', async () => {
      const journey = await JourneyService.create(db, TEST_TENANT, 1, {
        name: 'Archive Draft Test',
        steps: [{ stepType: 'ACTION', channel: 'EMAIL', messageTemplate: 'Hi' }],
      });
      await JourneyService.archive(db, TEST_TENANT, journey.id);
      await expect(JourneyService.getJourney(db, TEST_TENANT, journey.id)).rejects.toThrow(
        /not found/i
      );
    });

    it('archives (not deletes) a PUBLISHED journey — stops future evaluation, keeps history', async () => {
      const journey = await JourneyService.create(db, TEST_TENANT, 1, {
        name: 'Archive Published Test',
        steps: [{ stepType: 'ACTION', channel: 'EMAIL', messageTemplate: 'Hi' }],
      });
      await JourneyService.publish(db, TEST_TENANT, journey.id);
      await JourneyService.archive(db, TEST_TENANT, journey.id);

      const reloaded = await JourneyService.getJourney(db, TEST_TENANT, journey.id);
      expect(reloaded.status).toBe('ARCHIVED');

      const ctx = makeCtx();
      const result = await JourneyService.evaluateDueEnrollments(ctx);
      expect(result.enrolled).toBe(0);
    });
  });

  describe('BusinessError codes', () => {
    it('publish() throws JOURNEY_HAS_NO_STEPS with the expected code', async () => {
      // A journey can only reach 0 steps via a direct DB row insert bypassing create()'s own
      // guard — simulates a corrupted/manually-edited row rather than a normal user flow.
      const [journey] = await db
        .insert(crmJourneys)
        .values({ tenantId: TEST_TENANT, name: 'No Steps', createdBy: 1 })
        .returning();
      try {
        await JourneyService.publish(db, TEST_TENANT, journey!.id);
        expect.unreachable('publish() should have thrown');
      } catch (err) {
        expect(err).toBeInstanceOf(BusinessError);
        expect((err as BusinessError).code).toBe('JOURNEY_HAS_NO_STEPS');
      }
    });
  });
});
