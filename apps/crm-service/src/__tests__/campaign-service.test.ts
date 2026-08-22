// CP-1 (Campaign Management Platform initiative — see ERP-PLANNING/Campaign-Planning/) baseline
// regression tests for CampaignService's CURRENT behavior, written before any later phase (CP-2+)
// changes this file. Pure-function tests always run; DB-backed tests are skipped without
// DATABASE_URL, matching the convention in es18-crm-gaps.test.ts / customer.integration.test.ts.
import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import { createDatabaseClient } from '@erp/db';
import {
  branches,
  campaigns,
  campaignAutomationRules,
  campaignRecipients,
  crmCampaignVariants,
  crmCampaignMessageTranslations,
  crmLinkClicks,
  customers,
  customerSegments,
  invoices,
  tenantCommunicationSettings,
  customerCommunicationPreferences,
  crmDltTemplates,
} from '@erp/db';
import { and, eq, isNull, notInArray } from 'drizzle-orm';
import type { PlatformContext } from '@erp/sdk';
import {
  checkChannelLimits,
  renderCampaignMessage,
  optOutCondition,
  mediaTypeFromMime,
  validateMediaForChannel,
  detectFallbackTokens,
  computeNextFireDate,
  isSameCalendarDay,
  checkDltCompliance,
  assignVariant,
  resolveRecipientTemplate,
  CampaignService,
} from '../domain/CampaignService.js';

describe('checkChannelLimits', () => {
  it('flags plain-ASCII SMS over 160 characters', () => {
    const msg = 'a'.repeat(161);
    const warnings = checkChannelLimits('SMS', msg);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain('161 characters');
  });

  it('does not flag plain-ASCII SMS at or under 160 characters', () => {
    expect(checkChannelLimits('SMS', 'a'.repeat(160))).toHaveLength(0);
  });

  it('flags Unicode SMS over the 70-character limit', () => {
    const msg = 'न'.repeat(71); // Devanagari, forces Unicode branch
    const warnings = checkChannelLimits('SMS', msg);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain('Unicode');
  });

  it('never flags non-SMS channels regardless of length', () => {
    expect(checkChannelLimits('EMAIL', 'a'.repeat(1000))).toHaveLength(0);
    expect(checkChannelLimits('WHATSAPP', 'a'.repeat(1000))).toHaveLength(0);
    expect(checkChannelLimits('IN_APP', 'a'.repeat(1000))).toHaveLength(0);
  });
});

describe('renderCampaignMessage', () => {
  const vars = {
    customerName: 'Ramesh',
    balance: 1234.5,
    loyaltyPoints: 500,
    shopName: 'Style Hub',
  };

  it('substitutes every known token', () => {
    const out = renderCampaignMessage(
      'Hi {{customerName}}, balance {{balance}}, points {{loyaltyPoints}}, store {{shopName}}, note {{customField}}',
      { ...vars, customField: 'VIP' }
    );
    expect(out).toBe('Hi Ramesh, balance 1234.50, points 500, store Style Hub, note VIP');
  });

  it('renders an empty string for a missing customField', () => {
    const out = renderCampaignMessage('Note: {{customField}}', vars);
    expect(out).toBe('Note: ');
  });

  it('tolerates whitespace inside the token braces', () => {
    const out = renderCampaignMessage('Hi {{  customerName  }}!', vars);
    expect(out).toBe('Hi Ramesh!');
  });

  it('leaves unrecognized tokens untouched', () => {
    const out = renderCampaignMessage('{{unknownToken}}', vars);
    expect(out).toBe('{{unknownToken}}');
  });

  // CP-3: purchase-history tokens
  it('substitutes lastPurchaseDate/lastPurchaseAmount when present', () => {
    const out = renderCampaignMessage(
      'Last order: {{lastPurchaseDate}} for {{lastPurchaseAmount}}',
      {
        ...vars,
        lastPurchaseDate: '2026-06-01',
        lastPurchaseAmount: 999.9,
      }
    );
    expect(out).toBe('Last order: 2026-06-01 for 999.90');
  });

  it('falls back to a friendly message when lastPurchaseDate/Amount are missing (FR-F2)', () => {
    const out = renderCampaignMessage(
      'Last order: {{lastPurchaseDate}} for {{lastPurchaseAmount}}',
      vars
    );
    expect(out).toBe('Last order: no purchases yet for 0.00');
  });

  // CRM-ROADMAP Phase 2, Feature 6 — the one token whose value is unique per recipient
  // (a tracking URL), not a shared value like every other token.
  it('substitutes {{link}} with the provided trackingUrl', () => {
    const out = renderCampaignMessage('Visit: {{link}}', {
      ...vars,
      trackingUrl: 'https://t.example/abc123',
    });
    expect(out).toBe('Visit: https://t.example/abc123');
  });

  it('renders an empty string for {{link}} when no trackingUrl is provided (unchanged behavior for every pre-existing template with no link)', () => {
    const out = renderCampaignMessage('No link here', vars);
    expect(out).toBe('No link here');
    const outWithToken = renderCampaignMessage('Link: {{link}}', vars);
    expect(outWithToken).toBe('Link: ');
  });
});

describe('assignVariant — pure weighting math', () => {
  const variants = [
    { id: 1, label: 'A', messageTemplate: 'Template A', weight: 70 },
    { id: 2, label: 'B', messageTemplate: 'Template B', weight: 30 },
  ];

  it('returns null for an empty variant list (a non-A/B campaign)', () => {
    expect(assignVariant([], 0)).toBeNull();
  });

  it('is deterministic — the same seed always yields the same variant', () => {
    expect(assignVariant(variants, 42)?.label).toBe(assignVariant(variants, 42)?.label);
  });

  it('splits exactly according to the configured weight ratio across many seeds (not random noise)', () => {
    const counts = { A: 0, B: 0 };
    for (let seed = 0; seed < 1000; seed++) {
      const label = assignVariant(variants, seed)!.label as 'A' | 'B';
      counts[label]++;
    }
    // Deterministic modulo assignment over 1000 seeds against a 70/30 weight split — exact,
    // not approximate, since this isn't Math.random()-based.
    expect(counts.A).toBe(700);
    expect(counts.B).toBe(300);
  });
});

describe('resolveRecipientTemplate (CRM-ROADMAP Phase 3, Feature 5)', () => {
  const variants = [
    { id: 1, label: 'A', messageTemplate: 'Variant A', weight: 70 },
    { id: 2, label: 'B', messageTemplate: 'Variant B', weight: 30 },
  ];
  const translations = new Map([
    ['hi', 'Hindi message'],
    ['ta', 'Tamil message'],
  ]);

  it('uses the matching-language translation when the recipient has a preference for it', () => {
    const result = resolveRecipientTemplate('hi', translations, variants, 'Base template', 0);
    expect(result.template).toBe('Hindi message');
    expect(result.variant).toBeNull();
  });

  it('falls back to A/B variant assignment when the preferred language has no translation', () => {
    const result = resolveRecipientTemplate('fr', translations, variants, 'Base template', 0);
    expect(result.template).toBe('Variant A');
    expect(result.variant?.label).toBe('A');
  });

  it('falls back to the base template when there is no preferred language and no variants', () => {
    const result = resolveRecipientTemplate(null, translations, [], 'Base template', 0);
    expect(result.template).toBe('Base template');
    expect(result.variant).toBeNull();
  });

  it('falls back to A/B variant assignment when the recipient has no preferred language at all', () => {
    const result = resolveRecipientTemplate(null, translations, variants, 'Base template', 0);
    expect(result.variant?.label).toBe('A');
  });

  it('never assigns an A/B variant for a recipient whose language matched a translation, even when variants are configured', () => {
    const result = resolveRecipientTemplate('ta', translations, variants, 'Base template', 5);
    expect(result.template).toBe('Tamil message');
    expect(result.variant).toBeNull();
  });
});

describe('detectFallbackTokens (CP-3, FR-F2)', () => {
  const vars = { customerName: 'Ramesh', balance: 0, loyaltyPoints: 0, shopName: 'Shop' };

  it('reports no fallbacks when the template uses no personalization tokens', () => {
    expect(detectFallbackTokens('Hi there!', vars)).toEqual([]);
  });

  it('reports customField as a fallback hit when the template uses it and the value is missing', () => {
    expect(detectFallbackTokens('Note: {{customField}}', vars)).toEqual(['customField']);
  });

  it('does not report customField when a value is present', () => {
    expect(detectFallbackTokens('Note: {{customField}}', { ...vars, customField: 'VIP' })).toEqual(
      []
    );
  });

  it('reports lastPurchaseDate and lastPurchaseAmount independently', () => {
    expect(detectFallbackTokens('{{lastPurchaseDate}} / {{lastPurchaseAmount}}', vars)).toEqual([
      'lastPurchaseDate',
      'lastPurchaseAmount',
    ]);
    expect(
      detectFallbackTokens('{{lastPurchaseDate}}', { ...vars, lastPurchaseDate: '2026-01-01' })
    ).toEqual([]);
  });

  it('does not report a token that is not used in the template even if the value is missing', () => {
    expect(detectFallbackTokens('Hi {{customerName}}', vars)).toEqual([]);
  });
});

describe('optOutCondition', () => {
  it('returns undefined for IN_APP (no consent gate)', () => {
    expect(optOutCondition('IN_APP')).toBeUndefined();
  });

  it('returns a defined condition for every consent-gated channel', () => {
    expect(optOutCondition('SMS')).toBeDefined();
    expect(optOutCondition('WHATSAPP')).toBeDefined();
    expect(optOutCondition('EMAIL')).toBeDefined();
  });
});

describe('mediaTypeFromMime', () => {
  it('classifies image/* mime types as image', () => {
    expect(mediaTypeFromMime('image/png')).toBe('image');
    expect(mediaTypeFromMime('image/jpeg')).toBe('image');
  });

  it('classifies video/* mime types as video', () => {
    expect(mediaTypeFromMime('video/mp4')).toBe('video');
  });

  it('classifies everything else as document', () => {
    expect(mediaTypeFromMime('application/pdf')).toBe('document');
    expect(mediaTypeFromMime('application/vnd.ms-excel')).toBe('document');
  });
});

describe('validateMediaForChannel (CP-2)', () => {
  it('rejects any media on SMS', () => {
    expect(() => validateMediaForChannel('SMS', 'image/png', 1000)).toThrow(
      'SMS campaigns cannot have media attachments'
    );
  });

  it('rejects any media on IN_APP', () => {
    expect(() => validateMediaForChannel('IN_APP', 'image/png', 1000)).toThrow(
      'IN_APP campaigns cannot have media attachments'
    );
  });

  it('allows an image under the 5MB limit on EMAIL', () => {
    expect(() => validateMediaForChannel('EMAIL', 'image/png', 4 * 1024 * 1024)).not.toThrow();
  });

  it('rejects an image over the 5MB limit on WHATSAPP', () => {
    expect(() => validateMediaForChannel('WHATSAPP', 'image/jpeg', 6 * 1024 * 1024)).toThrow(
      /exceeds the 5MB limit/
    );
  });

  it('allows a video under the 16MB limit on WHATSAPP', () => {
    expect(() => validateMediaForChannel('WHATSAPP', 'video/mp4', 10 * 1024 * 1024)).not.toThrow();
  });

  it('rejects a video over the 16MB limit on EMAIL', () => {
    expect(() => validateMediaForChannel('EMAIL', 'video/mp4', 20 * 1024 * 1024)).toThrow(
      /exceeds the 16MB limit/
    );
  });

  it('allows a document under the 100MB limit on EMAIL', () => {
    expect(() =>
      validateMediaForChannel('EMAIL', 'application/pdf', 50 * 1024 * 1024)
    ).not.toThrow();
  });
});

describe('computeNextFireDate (CP-5, MH-09)', () => {
  const from = new Date('2026-07-15T10:00:00Z');

  it('advances by N days for DAILY', () => {
    expect(computeNextFireDate({ frequency: 'DAILY', interval: 3 }, from).toISOString()).toBe(
      new Date('2026-07-18T10:00:00Z').toISOString()
    );
  });

  it('advances by N*7 days for WEEKLY', () => {
    expect(computeNextFireDate({ frequency: 'WEEKLY', interval: 2 }, from).toISOString()).toBe(
      new Date('2026-07-29T10:00:00Z').toISOString()
    );
  });

  it('advances by N months for MONTHLY', () => {
    expect(computeNextFireDate({ frequency: 'MONTHLY', interval: 1 }, from).toISOString()).toBe(
      new Date('2026-08-15T10:00:00Z').toISOString()
    );
  });
});

describe('isSameCalendarDay', () => {
  it('is true for two timestamps on the same UTC calendar day', () => {
    expect(
      isSameCalendarDay(new Date('2026-07-15T01:00:00Z'), new Date('2026-07-15T23:00:00Z'))
    ).toBe(true);
  });

  it('is false for timestamps on different UTC calendar days', () => {
    expect(
      isSameCalendarDay(new Date('2026-07-15T23:59:00Z'), new Date('2026-07-16T00:01:00Z'))
    ).toBe(false);
  });
});

const DB_URL = process.env['DATABASE_URL'];

describe.skipIf(!DB_URL)('CampaignService — integration (CP-1 baseline)', () => {
  let db: ReturnType<typeof createDatabaseClient>;
  const TEST_TENANT = 900_301 + Math.floor(Math.random() * 1000);
  let branchId: number;
  let branchId2: number;
  let optedInCustomerId: number;
  let optedOutSmsCustomerId: number;
  let branch2CustomerId: number;

  function makeCtx(): PlatformContext {
    return {
      db: { raw: db },
      tenant: { tenantId: TEST_TENANT, userId: 1 },
      events: { publish: async () => undefined },
      audit: { log: async () => undefined },
    } as unknown as PlatformContext;
  }

  beforeAll(async () => {
    db = createDatabaseClient({ url: DB_URL! });

    const [branch] = await db
      .insert(branches)
      .values({
        tenantId: TEST_TENANT,
        name: 'Test HO',
        code: 'HO',
        isHeadOffice: true,
        isActive: true,
        createdBy: 1,
      })
      .returning();
    branchId = branch!.id;

    const [optedIn] = await db
      .insert(customers)
      .values({
        tenantId: TEST_TENANT,
        branchId,
        displayName: 'Opted In Customer',
        phone: '9000000101',
        creditLimit: '0',
        openingBalance: '0',
        loyaltyPoints: 10,
        createdBy: 1,
      })
      .returning();
    optedInCustomerId = optedIn!.id;

    const [optedOut] = await db
      .insert(customers)
      .values({
        tenantId: TEST_TENANT,
        branchId,
        displayName: 'Opted Out SMS Customer',
        phone: '9000000102',
        creditLimit: '0',
        openingBalance: '0',
        optOutSms: true,
        createdBy: 1,
      })
      .returning();
    optedOutSmsCustomerId = optedOut!.id;

    // CP-8: a second branch + a customer belonging only to it, for branch-scoping tests.
    const [branch2] = await db
      .insert(branches)
      .values({
        tenantId: TEST_TENANT,
        name: 'Test Branch 2',
        code: 'BR2',
        isHeadOffice: false,
        isActive: true,
        createdBy: 1,
      })
      .returning();
    branchId2 = branch2!.id;

    const [branch2Customer] = await db
      .insert(customers)
      .values({
        tenantId: TEST_TENANT,
        branchId: branchId2,
        // Deliberately doesn't contain "Customer" — the pre-existing segment test above
        // ("resolves recipients from a saved custom segment...") filters on
        // displayName contains 'Customer', and this row must not accidentally match it.
        displayName: 'Branch 2 Shopper',
        phone: '9000000103',
        creditLimit: '0',
        openingBalance: '0',
        createdBy: 1,
      })
      .returning();
    branch2CustomerId = branch2Customer!.id;
  });

  afterAll(async () => {
    // CRM-ROADMAP Phase 2, Feature 6 — new tables this feature added; no DB-enforced FK to
    // campaign_recipients/campaigns, so deletion order relative to those doesn't matter.
    await db.delete(crmLinkClicks).where(eq(crmLinkClicks.tenantId, TEST_TENANT));
    await db.delete(crmCampaignVariants).where(eq(crmCampaignVariants.tenantId, TEST_TENANT));
    await db.delete(invoices).where(eq(invoices.tenantId, TEST_TENANT));
    await db.delete(campaignRecipients).where(eq(campaignRecipients.tenantId, TEST_TENANT));
    await db.delete(campaigns).where(eq(campaigns.tenantId, TEST_TENANT));
    await db
      .delete(campaignAutomationRules)
      .where(eq(campaignAutomationRules.tenantId, TEST_TENANT));
    await db.delete(customerSegments).where(eq(customerSegments.tenantId, TEST_TENANT));
    await db
      .delete(tenantCommunicationSettings)
      .where(eq(tenantCommunicationSettings.tenantId, TEST_TENANT));
    await db.delete(crmDltTemplates).where(eq(crmDltTemplates.tenantId, TEST_TENANT));
    await db.delete(customers).where(eq(customers.tenantId, TEST_TENANT));
    await db.delete(branches).where(eq(branches.tenantId, TEST_TENANT));
  });

  // CRM-ROADMAP Phase 1, Feature 6 — DLT/TRAI SMS Compliance: the earlier, best-effort
  // campaign creation/preview-time check (the authoritative gate is
  // NotificationEngine.sendRaw, covered separately in notification-service's own
  // dlt-compliance.test.ts).
  describe('checkDltCompliance', () => {
    afterAll(async () => {
      await db.delete(crmDltTemplates).where(eq(crmDltTemplates.tenantId, TEST_TENANT));
    });

    it('is always compliant for non-SMS channels regardless of registered templates', async () => {
      const result = await checkDltCompliance(
        makeCtx(),
        'EMAIL',
        'Anything at all, no template needed'
      );
      expect(result.compliant).toBe(true);
    });

    it('reports non-compliant with an actionable reason when zero templates are registered', async () => {
      const result = await checkDltCompliance(makeCtx(), 'SMS', 'Diwali Sale! Flat 50% off.');
      expect(result.compliant).toBe(false);
      expect(result.reason).toMatch(/no dlt templates are registered/i);
    });

    it('is compliant once a matching template is registered', async () => {
      await db.insert(crmDltTemplates).values({
        tenantId: TEST_TENANT,
        createdBy: 1,
        templateId: 'DLT-TEST-001',
        header: 'TXTIND',
        messagePattern: 'Dear {#var#}, enjoy {#var#}% off this festive season.',
      });

      const result = await checkDltCompliance(
        makeCtx(),
        'SMS',
        'Dear Ramesh, enjoy 50% off this festive season.'
      );
      expect(result.compliant).toBe(true);
    });

    it('reports non-compliant with a specific reason when content does not match any registered template', async () => {
      const result = await checkDltCompliance(
        makeCtx(),
        'SMS',
        'Completely unrelated wording here.'
      );
      expect(result.compliant).toBe(false);
      expect(result.reason).toMatch(/does not match any registered dlt template/i);
    });
  });

  describe('resolveRecipients', () => {
    it('resolves an explicit customerIds list, tenant-scoped', async () => {
      const ctx = makeCtx();
      const rows = await CampaignService.resolveRecipients(ctx, {
        segmentId: null,
        customerIds: [optedInCustomerId, optedOutSmsCustomerId],
        channel: 'EMAIL',
      });
      expect(rows.map((r) => r.id).sort()).toEqual(
        [optedInCustomerId, optedOutSmsCustomerId].sort()
      );
    });

    it('excludes a customer opted out of the campaign channel', async () => {
      const ctx = makeCtx();
      const rows = await CampaignService.resolveRecipients(ctx, {
        segmentId: null,
        customerIds: [optedInCustomerId, optedOutSmsCustomerId],
        channel: 'SMS',
      });
      expect(rows.map((r) => r.id)).toEqual([optedInCustomerId]);
    });

    it('does not opt-out-filter IN_APP recipients', async () => {
      const ctx = makeCtx();
      const rows = await CampaignService.resolveRecipients(ctx, {
        segmentId: null,
        customerIds: [optedInCustomerId, optedOutSmsCustomerId],
        channel: 'IN_APP',
      });
      expect(rows.map((r) => r.id).sort()).toEqual(
        [optedInCustomerId, optedOutSmsCustomerId].sort()
      );
    });

    it('throws ValidationError when neither segmentId nor customerIds is given', async () => {
      const ctx = makeCtx();
      await expect(
        CampaignService.resolveRecipients(ctx, {
          segmentId: null,
          customerIds: null,
          channel: 'EMAIL',
        })
      ).rejects.toThrow('Campaign must target either a segmentId or a customerIds list');
    });

    it('resolves recipients from a saved custom segment, respecting opt-out', async () => {
      const [segment] = await db
        .insert(customerSegments)
        .values({
          tenantId: TEST_TENANT,
          name: 'All Test Customers',
          code: `all-test-${TEST_TENANT}`,
          isSystem: false,
          filterDefinition: {
            rules: [{ field: 'displayName', operator: 'contains', value: 'Customer' }],
            logic: 'AND',
          },
          createdBy: 1,
        })
        .returning();

      const ctx = makeCtx();
      const rows = await CampaignService.resolveRecipients(ctx, {
        segmentId: segment!.id,
        customerIds: null,
        channel: 'SMS',
      });
      expect(rows.map((r) => r.id)).toEqual([optedInCustomerId]);
    });
  });

  describe('frequency capping (CP-5, MH-10)', () => {
    // Scoped cleanup: this block is the only place in the file that writes
    // tenantCommunicationSettings and pre-dated SENT campaignRecipients rows for
    // optedInCustomerId — both must be gone before later describe blocks run, or every later
    // resolveRecipients()/send() call involving optedInCustomerId would be silently frequency-
    // capped by leftover state from these tests.
    afterAll(async () => {
      await db
        .delete(tenantCommunicationSettings)
        .where(eq(tenantCommunicationSettings.tenantId, TEST_TENANT));
      await db.delete(campaignRecipients).where(eq(campaignRecipients.tenantId, TEST_TENANT));
    });

    it('does not filter anyone when no tenant frequency cap is configured', async () => {
      const ctx = makeCtx();
      const rows = await CampaignService.resolveRecipients(ctx, {
        segmentId: null,
        customerIds: [optedInCustomerId],
        channel: 'EMAIL',
      });
      expect(rows.map((r) => r.id)).toEqual([optedInCustomerId]);
    });

    it("excludes a customer who already hit today's cap, across any campaign", async () => {
      await db
        .insert(tenantCommunicationSettings)
        .values({ tenantId: TEST_TENANT, frequencyCap: { maxPerDay: 1 } });

      const [priorCampaign] = await db
        .insert(campaigns)
        .values({
          tenantId: TEST_TENANT,
          name: `Cap Test Prior ${Date.now()}`,
          customerIds: [optedInCustomerId],
          channel: 'EMAIL',
          messageTemplate: 'Hi',
          status: 'SENT',
          createdBy: 1,
        })
        .returning();
      await db.insert(campaignRecipients).values({
        tenantId: TEST_TENANT,
        campaignId: priorCampaign!.id,
        customerId: optedInCustomerId,
        status: 'SENT',
        sentAt: new Date(),
      });

      const ctx = makeCtx();
      const rows = await CampaignService.resolveRecipients(ctx, {
        segmentId: null,
        customerIds: [optedInCustomerId, optedOutSmsCustomerId],
        channel: 'EMAIL',
      });
      expect(rows.map((r) => r.id)).toEqual([optedOutSmsCustomerId]);
    });

    it('does not count a PENDING/FAILED delivery toward the cap', async () => {
      // Clears the SENT row the previous test left behind — each test in this block owns its
      // own campaignRecipients fixture, not a shared one (afterAll does the final sweep).
      await db.delete(campaignRecipients).where(eq(campaignRecipients.tenantId, TEST_TENANT));
      await db
        .update(tenantCommunicationSettings)
        .set({ frequencyCap: { maxPerDay: 1 } })
        .where(eq(tenantCommunicationSettings.tenantId, TEST_TENANT));

      const [priorCampaign] = await db
        .insert(campaigns)
        .values({
          tenantId: TEST_TENANT,
          name: `Cap Test Failed ${Date.now()}`,
          customerIds: [optedInCustomerId],
          channel: 'EMAIL',
          messageTemplate: 'Hi',
          status: 'SENT',
          createdBy: 1,
        })
        .returning();
      await db.insert(campaignRecipients).values({
        tenantId: TEST_TENANT,
        campaignId: priorCampaign!.id,
        customerId: optedInCustomerId,
        status: 'FAILED',
        sentAt: new Date(),
      });

      const ctx = makeCtx();
      const rows = await CampaignService.resolveRecipients(ctx, {
        segmentId: null,
        customerIds: [optedInCustomerId],
        channel: 'EMAIL',
      });
      expect(rows.map((r) => r.id)).toEqual([optedInCustomerId]);
    });
  });

  describe('previewSample', () => {
    it('reports recipient count and renders a sample message for the first match', async () => {
      const ctx = makeCtx();
      const result = await CampaignService.previewSample(
        ctx,
        undefined,
        [optedInCustomerId],
        'Hi {{customerName}}!',
        'EMAIL'
      );
      expect(result.recipientCount).toBe(1);
      expect(result.sampleMessage).toBe('Hi Opted In Customer!');
    });

    it('returns a null sample message when there are zero matching recipients', async () => {
      const ctx = makeCtx();
      const result = await CampaignService.previewSample(
        ctx,
        undefined,
        [999_999_999],
        'Hi {{customerName}}!',
        'EMAIL'
      );
      expect(result.recipientCount).toBe(0);
      expect(result.sampleMessage).toBeNull();
    });

    it('flags lastPurchaseDate as a fallback for a customer with no purchase history (CP-3, FR-F2)', async () => {
      const ctx = makeCtx();
      const result = await CampaignService.previewSample(
        ctx,
        undefined,
        [optedInCustomerId],
        'Hi {{customerName}}, last order {{lastPurchaseDate}}',
        'EMAIL'
      );
      expect(result.sampleMessage).toBe('Hi Opted In Customer, last order no purchases yet');
      expect(result.fallbackWarnings).toContain('lastPurchaseDate');
    });

    it('reports no fallback warnings when the template uses no personalization tokens beyond customerName', async () => {
      const ctx = makeCtx();
      const result = await CampaignService.previewSample(
        ctx,
        undefined,
        [optedInCustomerId],
        'Hi {{customerName}}!',
        'EMAIL'
      );
      expect(result.fallbackWarnings).toEqual([]);
    });
  });

  describe('status transition guards', () => {
    async function createCampaign(status: 'DRAFT' | 'SCHEDULED' | 'SENT' | 'CANCELLED') {
      const [campaign] = await db
        .insert(campaigns)
        .values({
          tenantId: TEST_TENANT,
          name: `Guard Test ${status} ${Date.now()}`,
          customerIds: [optedInCustomerId],
          channel: 'EMAIL',
          messageTemplate: 'Hi {{customerName}}',
          status,
          createdBy: 1,
        })
        .returning();
      return campaign!;
    }

    it('send() rejects a campaign not in DRAFT/SCHEDULED', async () => {
      const campaign = await createCampaign('SENT');
      const ctx = makeCtx();
      await expect(CampaignService.send(ctx, campaign.id)).rejects.toThrow(
        /Cannot send campaign in status SENT/
      );
    });

    it('send() throws NotFoundError for a nonexistent campaign', async () => {
      const ctx = makeCtx();
      await expect(CampaignService.send(ctx, 999_999_999)).rejects.toThrow();
    });

    it('schedule() rejects a non-DRAFT campaign', async () => {
      const campaign = await createCampaign('SENT');
      const ctx = makeCtx();
      await expect(
        CampaignService.schedule(ctx, campaign.id, new Date(Date.now() + 60_000))
      ).rejects.toThrow(/Cannot schedule campaign in status SENT/);
    });

    it('schedule() rejects a scheduledAt in the past', async () => {
      const campaign = await createCampaign('DRAFT');
      const ctx = makeCtx();
      await expect(
        CampaignService.schedule(ctx, campaign.id, new Date(Date.now() - 60_000))
      ).rejects.toThrow('scheduledAt must be in the future');
    });

    it('schedule() succeeds from DRAFT and increments version', async () => {
      const campaign = await createCampaign('DRAFT');
      const ctx = makeCtx();
      const updated = await CampaignService.schedule(
        ctx,
        campaign.id,
        new Date(Date.now() + 60_000)
      );
      expect(updated.status).toBe('SCHEDULED');
      expect(updated.version).toBe(campaign.version + 1);
    });

    it('cancel() rejects a campaign not in DRAFT/SCHEDULED', async () => {
      const campaign = await createCampaign('SENT');
      const ctx = makeCtx();
      await expect(CampaignService.cancel(ctx, campaign.id)).rejects.toThrow(
        /Cannot cancel campaign in status SENT/
      );
    });

    it('cancel() succeeds from DRAFT and increments version', async () => {
      const campaign = await createCampaign('DRAFT');
      const ctx = makeCtx();
      const updated = await CampaignService.cancel(ctx, campaign.id);
      expect(updated.status).toBe('CANCELLED');
      expect(updated.cancelledAt).not.toBeNull();
      expect(updated.version).toBe(campaign.version + 1);
    });

    it('send() rejects a campaign whose recipients are all opted out (NO_RECIPIENTS)', async () => {
      const [campaign] = await db
        .insert(campaigns)
        .values({
          tenantId: TEST_TENANT,
          name: `Guard Test NoRecipients ${Date.now()}`,
          customerIds: [optedOutSmsCustomerId],
          channel: 'SMS',
          messageTemplate: 'Hi {{customerName}}',
          status: 'DRAFT',
          createdBy: 1,
        })
        .returning();
      const ctx = makeCtx();
      await expect(CampaignService.send(ctx, campaign!.id)).rejects.toThrow(
        'Campaign has no matching recipients'
      );
    });
  });

  describe('update (CP-4)', () => {
    async function createCampaign(status: 'DRAFT' | 'SCHEDULED' | 'SENT', scheduledAt?: Date) {
      const [campaign] = await db
        .insert(campaigns)
        .values({
          tenantId: TEST_TENANT,
          name: `Edit Test ${status} ${Date.now()}`,
          customerIds: [optedInCustomerId],
          channel: 'EMAIL',
          messageTemplate: 'Hi {{customerName}}',
          status,
          scheduledAt,
          createdBy: 1,
        })
        .returning();
      return campaign!;
    }

    it('edits a DRAFT campaign, increments version, and writes a history row', async () => {
      const campaign = await createCampaign('DRAFT');
      const ctx = makeCtx();
      const updated = await CampaignService.update(ctx, campaign.id, campaign.version, {
        name: 'Renamed Campaign',
        messageTemplate: 'Updated message',
      });
      expect(updated.name).toBe('Renamed Campaign');
      expect(updated.messageTemplate).toBe('Updated message');
      expect(updated.version).toBe(campaign.version + 1);
      expect(updated.status).toBe('DRAFT');

      const history = await CampaignService.listHistory(ctx, campaign.id);
      expect(history[0]?.action).toBe('UPDATE');
      expect(history[0]?.fromStatus).toBe('DRAFT');
      expect(history[0]?.toStatus).toBe('DRAFT');
    });

    it('editing a SCHEDULED campaign resets it to DRAFT and clears scheduledAt', async () => {
      const campaign = await createCampaign('SCHEDULED', new Date(Date.now() + 3_600_000));
      const ctx = makeCtx();
      const updated = await CampaignService.update(ctx, campaign.id, campaign.version, {
        name: 'Rescoped',
      });
      expect(updated.status).toBe('DRAFT');
      expect(updated.scheduledAt).toBeNull();
    });

    it('rejects editing a SENT campaign', async () => {
      const campaign = await createCampaign('SENT');
      const ctx = makeCtx();
      await expect(
        CampaignService.update(ctx, campaign.id, campaign.version, { name: 'x' })
      ).rejects.toThrow(/Cannot edit campaign in status SENT/);
    });

    it('throws OptimisticLockError when the expected version is stale', async () => {
      const campaign = await createCampaign('DRAFT');
      const ctx = makeCtx();
      await expect(
        CampaignService.update(ctx, campaign.id, campaign.version + 1, { name: 'x' })
      ).rejects.toThrow(/modified by another user/);
    });

    it('throws NotFoundError for a nonexistent campaign', async () => {
      const ctx = makeCtx();
      await expect(CampaignService.update(ctx, 999_999_999, 0, { name: 'x' })).rejects.toThrow();
    });
  });

  describe('dispatchRecurringOccurrence (CP-5, MH-09)', () => {
    it('creates a concrete occurrence linked to the definition and advances scheduledAt', async () => {
      const [definition] = await db
        .insert(campaigns)
        .values({
          tenantId: TEST_TENANT,
          name: 'Weekly Recurring Test',
          customerIds: [optedInCustomerId],
          channel: 'IN_APP',
          messageTemplate: 'Hi {{customerName}}',
          status: 'SCHEDULED',
          scheduledAt: new Date('2026-07-15T10:00:00Z'),
          recurrenceRule: { frequency: 'WEEKLY', interval: 1 },
          createdBy: 1,
        })
        .returning();

      const ctx = makeCtx();
      const result = await CampaignService.dispatchRecurringOccurrence(ctx, definition!.id);
      expect(result.seriesEnded).toBe(false);

      const [occurrence] = await db
        .select()
        .from(campaigns)
        .where(eq(campaigns.id, result.occurrenceId));
      expect(occurrence?.parentRecurringCampaignId).toBe(definition!.id);
      expect(occurrence?.status).toBe('SENT');

      const [reloadedDefinition] = await db
        .select()
        .from(campaigns)
        .where(eq(campaigns.id, definition!.id));
      expect(reloadedDefinition?.status).toBe('SCHEDULED');
      expect(reloadedDefinition?.scheduledAt?.toISOString()).toBe(
        new Date('2026-07-22T10:00:00Z').toISOString()
      );
    });

    it('ends the series (CANCELLED) once the next fire date passes endDate', async () => {
      const [definition] = await db
        .insert(campaigns)
        .values({
          tenantId: TEST_TENANT,
          name: 'Ending Recurring Test',
          customerIds: [optedInCustomerId],
          channel: 'IN_APP',
          messageTemplate: 'Hi {{customerName}}',
          status: 'SCHEDULED',
          scheduledAt: new Date('2026-07-15T10:00:00Z'),
          recurrenceRule: { frequency: 'DAILY', interval: 1, endDate: '2026-07-16T00:00:00Z' },
          createdBy: 1,
        })
        .returning();

      const ctx = makeCtx();
      const result = await CampaignService.dispatchRecurringOccurrence(ctx, definition!.id);
      expect(result.seriesEnded).toBe(true);

      const [reloadedDefinition] = await db
        .select()
        .from(campaigns)
        .where(eq(campaigns.id, definition!.id));
      expect(reloadedDefinition?.status).toBe('CANCELLED');
    });

    it('throws ValidationError for a campaign with no recurrence rule', async () => {
      const [campaign] = await db
        .insert(campaigns)
        .values({
          tenantId: TEST_TENANT,
          name: 'Not Recurring',
          customerIds: [optedInCustomerId],
          channel: 'IN_APP',
          messageTemplate: 'Hi',
          status: 'SCHEDULED',
          scheduledAt: new Date(Date.now() + 60_000),
          createdBy: 1,
        })
        .returning();
      const ctx = makeCtx();
      await expect(CampaignService.dispatchRecurringOccurrence(ctx, campaign!.id)).rejects.toThrow(
        'Campaign has no recurrence rule'
      );
    });
  });

  describe('fireAutomationRule (CP-5, MH-11)', () => {
    afterAll(async () => {
      // Scoped cleanup — mirrors the frequency-capping block's isolation pattern; a customer's
      // dateOfBirth mutated here must not leak into later describe blocks in this file.
      await db
        .update(customers)
        .set({ dateOfBirth: null })
        .where(eq(customers.id, optedInCustomerId));
    });

    it('fires a BIRTHDAY rule for a customer whose birthday is today, creating and sending a campaign', async () => {
      const todayMonthDay = new Date().toISOString().slice(5, 10); // "MM-DD"
      await db
        .update(customers)
        .set({ dateOfBirth: `1990-${todayMonthDay}` })
        .where(eq(customers.id, optedInCustomerId));

      const [rule] = await db
        .insert(campaignAutomationRules)
        .values({
          tenantId: TEST_TENANT,
          triggerType: 'BIRTHDAY',
          enabled: true,
          channel: 'IN_APP',
          messageTemplate: 'Happy Birthday {{customerName}}!',
          createdBy: 1,
        })
        .returning();

      const ctx = makeCtx();
      const result = await CampaignService.fireAutomationRule(ctx, rule!.id);
      expect(result).not.toBeNull();
      expect(result!.recipientCount).toBeGreaterThanOrEqual(1);

      const [campaign] = await db
        .select()
        .from(campaigns)
        .where(eq(campaigns.id, result!.campaignId));
      expect(campaign?.campaignType).toBe('BIRTHDAY');
      expect(campaign?.status).toBe('SENT');

      const [reloadedRule] = await db
        .select()
        .from(campaignAutomationRules)
        .where(eq(campaignAutomationRules.id, rule!.id));
      expect(reloadedRule?.lastFiredAt).not.toBeNull();
    });

    it('returns null and does not re-fire the same rule twice in one day', async () => {
      const todayMonthDay = new Date().toISOString().slice(5, 10);
      await db
        .update(customers)
        .set({ dateOfBirth: `1990-${todayMonthDay}` })
        .where(eq(customers.id, optedInCustomerId));

      const [rule] = await db
        .insert(campaignAutomationRules)
        .values({
          tenantId: TEST_TENANT,
          triggerType: 'BIRTHDAY',
          enabled: true,
          channel: 'IN_APP',
          messageTemplate: 'Happy Birthday {{customerName}}!',
          lastFiredAt: new Date(),
          createdBy: 1,
        })
        .returning();

      const ctx = makeCtx();
      const result = await CampaignService.fireAutomationRule(ctx, rule!.id);
      expect(result).toBeNull();
    });

    it('returns null when nobody currently matches the trigger, but still records lastFiredAt', async () => {
      await db
        .update(customers)
        .set({ dateOfBirth: '1990-01-01' })
        .where(eq(customers.id, optedInCustomerId));

      const [rule] = await db
        .insert(campaignAutomationRules)
        .values({
          tenantId: TEST_TENANT,
          triggerType: 'BIRTHDAY',
          enabled: true,
          channel: 'IN_APP',
          messageTemplate: 'Happy Birthday {{customerName}}!',
          createdBy: 1,
        })
        .returning();

      const ctx = makeCtx();
      const result = await CampaignService.fireAutomationRule(ctx, rule!.id);
      expect(result).toBeNull();

      const [reloadedRule] = await db
        .select()
        .from(campaignAutomationRules)
        .where(eq(campaignAutomationRules.id, rule!.id));
      expect(reloadedRule?.lastFiredAt).not.toBeNull();
    });

    it('throws BusinessError for a disabled rule', async () => {
      const [rule] = await db
        .insert(campaignAutomationRules)
        .values({
          tenantId: TEST_TENANT,
          triggerType: 'INACTIVITY',
          enabled: false,
          channel: 'IN_APP',
          createdBy: 1,
        })
        .returning();
      const ctx = makeCtx();
      await expect(CampaignService.fireAutomationRule(ctx, rule!.id)).rejects.toThrow(
        'Automation rule is disabled'
      );
    });

    it('throws NotFoundError for a nonexistent rule', async () => {
      const ctx = makeCtx();
      await expect(CampaignService.fireAutomationRule(ctx, 999_999_999)).rejects.toThrow();
    });
  });

  describe('getStats / listRecipients', () => {
    it('aggregates recipient statuses correctly', async () => {
      const [campaign] = await db
        .insert(campaigns)
        .values({
          tenantId: TEST_TENANT,
          name: `Stats Test ${Date.now()}`,
          customerIds: [optedInCustomerId],
          channel: 'EMAIL',
          messageTemplate: 'Hi',
          status: 'SENT',
          createdBy: 1,
        })
        .returning();

      await db.insert(campaignRecipients).values([
        {
          tenantId: TEST_TENANT,
          campaignId: campaign!.id,
          customerId: optedInCustomerId,
          status: 'SENT',
        },
        {
          tenantId: TEST_TENANT,
          campaignId: campaign!.id,
          customerId: optedOutSmsCustomerId,
          status: 'FAILED',
        },
      ]);

      const ctx = makeCtx();
      const stats = await CampaignService.getStats(ctx, campaign!.id);
      expect(stats.total).toBe(2);
      expect(stats.sent).toBe(1);
      expect(stats.failed).toBe(1);
      expect(stats.pending).toBe(0);

      const recipients = await CampaignService.listRecipients(ctx, campaign!.id);
      expect(recipients).toHaveLength(2);
    });
  });

  describe('approval workflow (CP-7, MH-12)', () => {
    // Scoped, like the frequency-capping block above: this is the only other place in the file
    // that writes tenantCommunicationSettings, so it must leave the row absent for any block
    // that (re-)runs after it — currently none, since this is the last describe block, but kept
    // for safety if a later phase appends more tests below.
    afterAll(async () => {
      await db
        .delete(tenantCommunicationSettings)
        .where(eq(tenantCommunicationSettings.tenantId, TEST_TENANT));
    });

    async function setApprovalRequired(required: boolean) {
      await db
        .delete(tenantCommunicationSettings)
        .where(eq(tenantCommunicationSettings.tenantId, TEST_TENANT));
      if (required) {
        await db
          .insert(tenantCommunicationSettings)
          .values({ tenantId: TEST_TENANT, approvalRequired: true });
      }
    }

    async function createCampaign(status: 'DRAFT' = 'DRAFT') {
      const [campaign] = await db
        .insert(campaigns)
        .values({
          tenantId: TEST_TENANT,
          name: `Approval Test ${status} ${Date.now()}-${Math.random()}`,
          customerIds: [optedInCustomerId],
          channel: 'EMAIL',
          messageTemplate: 'Hi {{customerName}}',
          status,
          createdBy: 1,
        })
        .returning();
      return campaign!;
    }

    it('tenantRequiresApproval() defaults to false when no settings row exists', async () => {
      await setApprovalRequired(false);
      const ctx = makeCtx();
      expect(await CampaignService.tenantRequiresApproval(ctx)).toBe(false);
    });

    it('tenantRequiresApproval() reflects an explicit true row', async () => {
      await setApprovalRequired(true);
      const ctx = makeCtx();
      expect(await CampaignService.tenantRequiresApproval(ctx)).toBe(true);
    });

    it('submitForApproval() auto-approves when the tenant does not require approval', async () => {
      await setApprovalRequired(false);
      const campaign = await createCampaign();
      const ctx = makeCtx();
      const updated = await CampaignService.submitForApproval(ctx, campaign.id);
      expect(updated.approvalStatus).toBe('APPROVED');
      expect(updated.approvedBy).toBe(1);
      expect(updated.approvedAt).not.toBeNull();

      const history = await CampaignService.listHistory(ctx, campaign.id);
      expect(history[0]?.action).toBe('AUTO_APPROVE');
    });

    it('submitForApproval() moves to PENDING_APPROVAL when the tenant requires approval', async () => {
      await setApprovalRequired(true);
      const campaign = await createCampaign();
      const ctx = makeCtx();
      const updated = await CampaignService.submitForApproval(ctx, campaign.id);
      expect(updated.approvalStatus).toBe('PENDING_APPROVAL');
      expect(updated.approvedBy).toBeNull();

      const history = await CampaignService.listHistory(ctx, campaign.id);
      expect(history[0]?.action).toBe('SUBMIT_FOR_APPROVAL');
    });

    it('submitForApproval() rejects a non-DRAFT campaign', async () => {
      await setApprovalRequired(false);
      const [sent] = await db
        .insert(campaigns)
        .values({
          tenantId: TEST_TENANT,
          name: `Approval Test SENT ${Date.now()}`,
          customerIds: [optedInCustomerId],
          channel: 'EMAIL',
          messageTemplate: 'Hi',
          status: 'SENT',
          createdBy: 1,
        })
        .returning();
      const ctx = makeCtx();
      await expect(CampaignService.submitForApproval(ctx, sent!.id)).rejects.toThrow(
        /Cannot submit campaign in status SENT/
      );
    });

    it('approve() transitions PENDING_APPROVAL to APPROVED', async () => {
      await setApprovalRequired(true);
      const campaign = await createCampaign();
      const ctx = makeCtx();
      await CampaignService.submitForApproval(ctx, campaign.id);
      const approved = await CampaignService.approve(ctx, campaign.id);
      expect(approved.approvalStatus).toBe('APPROVED');
      expect(approved.approvedBy).toBe(1);

      const history = await CampaignService.listHistory(ctx, campaign.id);
      expect(history[0]?.action).toBe('APPROVE');
    });

    it('approve() rejects a campaign that is not PENDING_APPROVAL', async () => {
      await setApprovalRequired(false);
      const campaign = await createCampaign();
      const ctx = makeCtx();
      await expect(CampaignService.approve(ctx, campaign.id)).rejects.toThrow(
        /Cannot approve a campaign with approvalStatus null/
      );
    });

    it('reject() transitions PENDING_APPROVAL to REJECTED with a reason', async () => {
      await setApprovalRequired(true);
      const campaign = await createCampaign();
      const ctx = makeCtx();
      await CampaignService.submitForApproval(ctx, campaign.id);
      const rejected = await CampaignService.reject(ctx, campaign.id, 'Wrong discount amount');
      expect(rejected.approvalStatus).toBe('REJECTED');
      expect(rejected.rejectionReason).toBe('Wrong discount amount');

      const history = await CampaignService.listHistory(ctx, campaign.id);
      expect(history[0]?.action).toBe('REJECT');
    });

    it('reject() rejects a campaign that is not PENDING_APPROVAL', async () => {
      await setApprovalRequired(false);
      const campaign = await createCampaign();
      const ctx = makeCtx();
      await expect(CampaignService.reject(ctx, campaign.id, 'x')).rejects.toThrow(
        /Cannot reject a campaign with approvalStatus null/
      );
    });

    it('send() is blocked by APPROVAL_REQUIRED when the tenant requires approval and the campaign is not APPROVED', async () => {
      await setApprovalRequired(true);
      const campaign = await createCampaign();
      const ctx = makeCtx();
      await expect(CampaignService.send(ctx, campaign.id)).rejects.toThrow(
        'Campaign must be approved before it can be sent'
      );
    });

    it('send() succeeds once the campaign is APPROVED, even when the tenant requires approval', async () => {
      await setApprovalRequired(true);
      const campaign = await createCampaign();
      const ctx = makeCtx();
      await CampaignService.submitForApproval(ctx, campaign.id);
      await CampaignService.approve(ctx, campaign.id);
      const sent = await CampaignService.send(ctx, campaign.id);
      expect(sent.status).toBe('SENT');
    });

    it('schedule() is blocked by APPROVAL_REQUIRED when the tenant requires approval and the campaign is not APPROVED', async () => {
      await setApprovalRequired(true);
      const campaign = await createCampaign();
      const ctx = makeCtx();
      await expect(
        CampaignService.schedule(ctx, campaign.id, new Date(Date.now() + 60_000))
      ).rejects.toThrow('Campaign must be approved before it can be scheduled');
    });

    it('does not require approval when the tenant has no settings row (backward compatibility)', async () => {
      await setApprovalRequired(false);
      const campaign = await createCampaign();
      const ctx = makeCtx();
      const sent = await CampaignService.send(ctx, campaign.id);
      expect(sent.status).toBe('SENT');
    });

    it('update() resets approvalStatus back to null on an APPROVED campaign', async () => {
      await setApprovalRequired(false);
      const campaign = await createCampaign();
      const ctx = makeCtx();
      const approved = await CampaignService.submitForApproval(ctx, campaign.id);
      expect(approved.approvalStatus).toBe('APPROVED');

      const updated = await CampaignService.update(ctx, campaign.id, approved.version, {
        name: 'Edited after approval',
      });
      expect(updated.approvalStatus).toBeNull();
      expect(updated.approvedBy).toBeNull();
    });
  });

  describe('branch scoping (CP-8, FR-M1)', () => {
    it('resolveRecipients targets everyone tenant-wide when branchId is unset (backward compatibility)', async () => {
      const ctx = makeCtx();
      const rows = await CampaignService.resolveRecipients(ctx, {
        segmentId: null,
        customerIds: [optedInCustomerId, branch2CustomerId],
        channel: 'EMAIL',
      });
      expect(rows.map((r) => r.id).sort()).toEqual([optedInCustomerId, branch2CustomerId].sort());
    });

    it('resolveRecipients excludes customers outside the campaign branchId when set', async () => {
      const ctx = makeCtx();
      const rows = await CampaignService.resolveRecipients(ctx, {
        segmentId: null,
        customerIds: [optedInCustomerId, branch2CustomerId],
        channel: 'EMAIL',
        branchId,
      });
      expect(rows.map((r) => r.id)).toEqual([optedInCustomerId]);
    });

    it("dispatchRecurringOccurrence() inherits the parent recurring definition's branchId", async () => {
      const [definition] = await db
        .insert(campaigns)
        .values({
          tenantId: TEST_TENANT,
          name: `Branch Recurring ${Date.now()}`,
          customerIds: [optedInCustomerId],
          channel: 'EMAIL',
          messageTemplate: 'Hi',
          status: 'SCHEDULED',
          branchId,
          scheduledAt: new Date(Date.now() + 60_000),
          recurrenceRule: { frequency: 'DAILY', interval: 1 },
          createdBy: 1,
        })
        .returning();

      const ctx = makeCtx();
      const { occurrenceId } = await CampaignService.dispatchRecurringOccurrence(
        ctx,
        definition!.id
      );
      const [occurrence] = await db.select().from(campaigns).where(eq(campaigns.id, occurrenceId));
      expect(occurrence!.branchId).toBe(branchId);
    });
  });

  describe('granular consent enforcement (CP-7 follow-up, applyGranularConsentFilter)', () => {
    afterAll(async () => {
      await db
        .delete(customerCommunicationPreferences)
        .where(eq(customerCommunicationPreferences.tenantId, TEST_TENANT));
    });

    it('excludes a customer with an explicit PROMOTIONAL consented=false row for the send channel', async () => {
      await db.insert(customerCommunicationPreferences).values({
        tenantId: TEST_TENANT,
        customerId: optedInCustomerId,
        channel: 'EMAIL',
        category: 'PROMOTIONAL',
        consented: false,
      });

      const ctx = makeCtx();
      const rows = await CampaignService.resolveRecipients(ctx, {
        segmentId: null,
        customerIds: [optedInCustomerId, branch2CustomerId],
        channel: 'EMAIL',
      });
      expect(rows.map((r) => r.id)).toEqual([branch2CustomerId]);
    });

    it('does not exclude a customer whose consented=false row is for a different channel', async () => {
      // The row inserted above is for EMAIL — resolving for SMS must not be affected by it.
      const ctx = makeCtx();
      const rows = await CampaignService.resolveRecipients(ctx, {
        segmentId: null,
        customerIds: [branch2CustomerId],
        channel: 'SMS',
      });
      expect(rows.map((r) => r.id)).toEqual([branch2CustomerId]);
    });

    it('treats a customer with no preference row as consented (backward compatibility)', async () => {
      const ctx = makeCtx();
      const rows = await CampaignService.resolveRecipients(ctx, {
        segmentId: null,
        customerIds: [branch2CustomerId],
        channel: 'EMAIL',
      });
      expect(rows.map((r) => r.id)).toEqual([branch2CustomerId]);
    });

    // CRM-ROADMAP Phase 3, Feature 2 (Self-Service Customer Portal) — proves the portal's own
    // PUT /portal/preferences write (consentSource: 'CUSTOMER_PORTAL') is honored by the next
    // campaign send exactly like a staff-recorded one: applyGranularConsentFilter's query never
    // references consentSource at all, only channel/category/consented, so no extra wiring was
    // needed for this to already work. Uses WHATSAPP specifically to avoid any interference with
    // the EMAIL-channel row the first test in this describe block already inserted.
    it('excludes a customer whose opt-out was recorded via the customer portal, same as a staff-recorded one', async () => {
      await db.insert(customerCommunicationPreferences).values({
        tenantId: TEST_TENANT,
        customerId: optedInCustomerId,
        channel: 'WHATSAPP',
        category: 'PROMOTIONAL',
        consented: false,
        consentSource: 'CUSTOMER_PORTAL',
      });

      const ctx = makeCtx();
      const rows = await CampaignService.resolveRecipients(ctx, {
        segmentId: null,
        customerIds: [optedInCustomerId, branch2CustomerId],
        channel: 'WHATSAPP',
      });
      expect(rows.map((r) => r.id)).toEqual([branch2CustomerId]);
    });
  });

  // CRM-ROADMAP Phase 2, Feature 6 — Campaign Studio — Engagement Tracking Activation.
  describe('engagement tracking', () => {
    async function createCampaign(overrides: Record<string, unknown> = {}) {
      const [campaign] = await db
        .insert(campaigns)
        .values({
          tenantId: TEST_TENANT,
          name: `Engagement Test ${Date.now()}-${Math.random()}`,
          customerIds: [optedInCustomerId],
          channel: 'EMAIL',
          messageTemplate: 'Hi {{customerName}}, click: {{link}}',
          status: 'DRAFT',
          createdBy: 1,
          ...overrides,
        })
        .returning();
      return campaign!;
    }

    describe('link wrapping', () => {
      it("creates one crm_link_clicks row per recipient with the campaign's linkUrl as destinationUrl", async () => {
        const campaign = await createCampaign({ linkUrl: 'https://example.com/sale' });
        await CampaignService.send(makeCtx(), campaign.id);

        const [recipient] = await db
          .select()
          .from(campaignRecipients)
          .where(
            and(
              eq(campaignRecipients.campaignId, campaign.id),
              eq(campaignRecipients.customerId, optedInCustomerId)
            )
          );
        expect(recipient).toBeDefined();

        const [linkClick] = await db
          .select()
          .from(crmLinkClicks)
          .where(eq(crmLinkClicks.campaignRecipientId, recipient!.id));
        expect(linkClick).toBeDefined();
        expect(linkClick!.destinationUrl).toBe('https://example.com/sale');
        expect(linkClick!.trackingToken).toBeTruthy();
        expect(linkClick!.clickCount).toBe(0);
      });

      it('creates no crm_link_clicks row for a channel/campaign needing neither click nor open tracking (unchanged behavior)', async () => {
        const campaign = await createCampaign({
          channel: 'WHATSAPP',
          linkUrl: null,
          messageTemplate: 'Hi {{customerName}}',
        });
        await CampaignService.send(makeCtx(), campaign.id);

        const [recipient] = await db
          .select()
          .from(campaignRecipients)
          .where(
            and(
              eq(campaignRecipients.campaignId, campaign.id),
              eq(campaignRecipients.customerId, optedInCustomerId)
            )
          );
        const linkClicks = await db
          .select()
          .from(crmLinkClicks)
          .where(eq(crmLinkClicks.campaignRecipientId, recipient!.id));
        expect(linkClicks).toHaveLength(0);
      });
    });

    describe('A/B variants', () => {
      it('assigns every recipient a variantId when the campaign has variants configured', async () => {
        const campaign = await createCampaign({
          customerIds: [optedInCustomerId, branch2CustomerId],
          messageTemplate: 'BASE {{customerName}}',
        });
        await db.insert(crmCampaignVariants).values([
          {
            tenantId: TEST_TENANT,
            campaignId: campaign.id,
            label: 'A',
            messageTemplate: 'VARIANT-A {{customerName}}',
            weight: 50,
          },
          {
            tenantId: TEST_TENANT,
            campaignId: campaign.id,
            label: 'B',
            messageTemplate: 'VARIANT-B {{customerName}}',
            weight: 50,
          },
        ]);
        await CampaignService.send(makeCtx(), campaign.id);

        const recipients = await db
          .select()
          .from(campaignRecipients)
          .where(eq(campaignRecipients.campaignId, campaign.id));
        expect(recipients).toHaveLength(2);
        expect(recipients.every((r) => r.variantId !== null)).toBe(true);
      });

      it('leaves variantId null when the campaign has no variants (unchanged behavior)', async () => {
        const campaign = await createCampaign();
        await CampaignService.send(makeCtx(), campaign.id);
        const [recipient] = await db
          .select()
          .from(campaignRecipients)
          .where(
            and(
              eq(campaignRecipients.campaignId, campaign.id),
              eq(campaignRecipients.customerId, optedInCustomerId)
            )
          );
        expect(recipient!.variantId).toBeNull();
      });
    });

    describe('getStats — engagement metrics', () => {
      it('computes opened/clicked/converted counts and rates from campaignRecipients', async () => {
        const campaign = await createCampaign();
        await CampaignService.send(makeCtx(), campaign.id);
        const [recipient] = await db
          .select()
          .from(campaignRecipients)
          .where(
            and(
              eq(campaignRecipients.campaignId, campaign.id),
              eq(campaignRecipients.customerId, optedInCustomerId)
            )
          );
        await db
          .update(campaignRecipients)
          .set({ openedAt: new Date(), clickedAt: new Date(), convertedAt: new Date() })
          .where(eq(campaignRecipients.id, recipient!.id));

        const stats = await CampaignService.getStats(makeCtx(), campaign.id);
        expect(stats.opened).toBe(1);
        expect(stats.clicked).toBe(1);
        expect(stats.converted).toBe(1);
        expect(stats.openRate).toBe(100);
        expect(stats.clickRate).toBe(100);
        expect(stats.conversionRate).toBe(100);
      });

      it('returns a variant breakdown when the campaign has variants, empty otherwise', async () => {
        const campaign = await createCampaign({
          customerIds: [optedInCustomerId, branch2CustomerId],
        });
        await db.insert(crmCampaignVariants).values({
          tenantId: TEST_TENANT,
          campaignId: campaign.id,
          label: 'A',
          messageTemplate: 'A',
          weight: 100,
        });
        await CampaignService.send(makeCtx(), campaign.id);

        const stats = await CampaignService.getStats(makeCtx(), campaign.id);
        expect(stats.variants).toHaveLength(1);
        expect(stats.variants[0]!.label).toBe('A');
        expect(stats.variants[0]!.sent).toBe(2);

        const noVariantCampaign = await createCampaign();
        await CampaignService.send(makeCtx(), noVariantCampaign.id);
        const statsNoVariants = await CampaignService.getStats(makeCtx(), noVariantCampaign.id);
        expect(statsNoVariants.variants).toEqual([]);
      });
    });

    describe('attributeConversions', () => {
      afterEach(async () => {
        await db.delete(invoices).where(eq(invoices.tenantId, TEST_TENANT));
      });

      it('sets convertedAt when the customer purchases after the send, within the window', async () => {
        const campaign = await createCampaign({ customerIds: [optedInCustomerId] });
        await CampaignService.send(makeCtx(), campaign.id);
        const [recipient] = await db
          .select()
          .from(campaignRecipients)
          .where(
            and(
              eq(campaignRecipients.campaignId, campaign.id),
              eq(campaignRecipients.customerId, optedInCustomerId)
            )
          );
        const sentAt = new Date(Date.now() - 60_000);
        await db
          .update(campaignRecipients)
          .set({ sentAt })
          .where(eq(campaignRecipients.id, recipient!.id));

        await db.insert(invoices).values({
          tenantId: TEST_TENANT,
          branchId,
          warehouseId: branchId,
          customerId: optedInCustomerId,
          invoiceNumber: `CONV-POS-${Date.now()}`,
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

        await CampaignService.attributeConversions(db, TEST_TENANT, 30);
        const [reloaded] = await db
          .select()
          .from(campaignRecipients)
          .where(eq(campaignRecipients.id, recipient!.id));
        expect(reloaded!.convertedAt).not.toBeNull();
      });

      it('does not set convertedAt when the only purchase predates the send', async () => {
        const campaign = await createCampaign({ customerIds: [branch2CustomerId] });
        await CampaignService.send(makeCtx(), campaign.id);
        const [recipient] = await db
          .select()
          .from(campaignRecipients)
          .where(
            and(
              eq(campaignRecipients.campaignId, campaign.id),
              eq(campaignRecipients.customerId, branch2CustomerId)
            )
          );
        const sentAt = new Date();
        await db
          .update(campaignRecipients)
          .set({ sentAt })
          .where(eq(campaignRecipients.id, recipient!.id));

        await db.insert(invoices).values({
          tenantId: TEST_TENANT,
          branchId: branchId2,
          warehouseId: branchId2,
          customerId: branch2CustomerId,
          invoiceNumber: `CONV-NEG-${Date.now()}`,
          placeOfSupply: '27',
          invoiceDate: new Date(Date.now() - 60 * 86_400_000),
          dueDate: new Date(Date.now() + 30 * 86_400_000),
          status: 'CONFIRMED',
          subtotal: '100',
          taxableAmount: '100',
          grandTotal: '100',
          paidAmount: '0',
          createdBy: 1,
        } as unknown as typeof invoices.$inferInsert);

        await CampaignService.attributeConversions(db, TEST_TENANT, 30);
        const [reloaded] = await db
          .select()
          .from(campaignRecipients)
          .where(eq(campaignRecipients.id, recipient!.id));
        expect(reloaded!.convertedAt).toBeNull();
      });

      // CRM-ROADMAP Phase 3, Feature 3 — snapshots the invoice + its revenue on attribution.
      it('snapshots convertedInvoiceId and convertedAmount, not just a timestamp', async () => {
        const campaign = await createCampaign({ customerIds: [optedInCustomerId] });
        await CampaignService.send(makeCtx(), campaign.id);
        const [recipient] = await db
          .select()
          .from(campaignRecipients)
          .where(
            and(
              eq(campaignRecipients.campaignId, campaign.id),
              eq(campaignRecipients.customerId, optedInCustomerId)
            )
          );
        await db
          .update(campaignRecipients)
          .set({ sentAt: new Date(Date.now() - 60_000) })
          .where(eq(campaignRecipients.id, recipient!.id));

        const [invoice] = await db
          .insert(invoices)
          .values({
            tenantId: TEST_TENANT,
            branchId,
            warehouseId: branchId,
            customerId: optedInCustomerId,
            invoiceNumber: `CONV-SNAP-${Date.now()}`,
            placeOfSupply: '27',
            invoiceDate: new Date(),
            dueDate: new Date(Date.now() + 30 * 86_400_000),
            status: 'CONFIRMED',
            subtotal: '250',
            taxableAmount: '250',
            grandTotal: '250',
            paidAmount: '0',
            createdBy: 1,
          } as unknown as typeof invoices.$inferInsert)
          .returning();

        await CampaignService.attributeConversions(db, TEST_TENANT, 30);
        const [reloaded] = await db
          .select()
          .from(campaignRecipients)
          .where(eq(campaignRecipients.id, recipient!.id));
        expect(reloaded!.convertedInvoiceId).toBe(invoice!.id);
        expect(parseFloat(reloaded!.convertedAmount ?? '0')).toBe(250);
      });

      // CRM-ROADMAP Phase 3, Feature 3 — the roadmap's own explicit boundary-condition example.
      it('does not attribute a purchase that falls outside the attribution window, even though it is after the send', async () => {
        const campaign = await createCampaign({ customerIds: [branch2CustomerId] });
        await CampaignService.send(makeCtx(), campaign.id);
        const [recipient] = await db
          .select()
          .from(campaignRecipients)
          .where(
            and(
              eq(campaignRecipients.campaignId, campaign.id),
              eq(campaignRecipients.customerId, branch2CustomerId)
            )
          );
        // Sent 35 days ago; the purchase below is 5 days ago — 30 days after the send, 5 days
        // past a 30-day window (>, not >=, is the boundary — 30 days exactly still attributes).
        const sentAt = new Date(Date.now() - 35 * 86_400_000);
        await db
          .update(campaignRecipients)
          .set({ sentAt })
          .where(eq(campaignRecipients.id, recipient!.id));

        await db.insert(invoices).values({
          tenantId: TEST_TENANT,
          branchId: branchId2,
          warehouseId: branchId2,
          customerId: branch2CustomerId,
          invoiceNumber: `CONV-OUTWINDOW-${Date.now()}`,
          placeOfSupply: '27',
          invoiceDate: new Date(Date.now() - 5 * 86_400_000),
          dueDate: new Date(Date.now() + 30 * 86_400_000),
          status: 'CONFIRMED',
          subtotal: '100',
          taxableAmount: '100',
          grandTotal: '100',
          paidAmount: '0',
          createdBy: 1,
        } as unknown as typeof invoices.$inferInsert);

        await CampaignService.attributeConversions(db, TEST_TENANT, 30);
        const [reloaded] = await db
          .select()
          .from(campaignRecipients)
          .where(eq(campaignRecipients.id, recipient!.id));
        expect(reloaded!.convertedAt).toBeNull();
      });

      // CRM-ROADMAP Phase 3, Feature 3 — last-click-wins tie-break: a customer engaging with two
      // campaigns before purchasing must credit only the one they engaged with LAST, not both.
      it('credits only the most-recently-clicked campaign when two campaigns are both eligible', async () => {
        const campaignA = await createCampaign({ customerIds: [optedInCustomerId] });
        const campaignB = await createCampaign({ customerIds: [optedInCustomerId] });
        await CampaignService.send(makeCtx(), campaignA.id);
        await CampaignService.send(makeCtx(), campaignB.id);

        const [recipientA] = await db
          .select()
          .from(campaignRecipients)
          .where(
            and(
              eq(campaignRecipients.campaignId, campaignA.id),
              eq(campaignRecipients.customerId, optedInCustomerId)
            )
          );
        const [recipientB] = await db
          .select()
          .from(campaignRecipients)
          .where(
            and(
              eq(campaignRecipients.campaignId, campaignB.id),
              eq(campaignRecipients.customerId, optedInCustomerId)
            )
          );

        // Other tests in this file also target optedInCustomerId and leave behind unconverted
        // (pending) campaignRecipients rows with recent sentAt values, since only `invoices` is
        // cleaned between tests — those would otherwise out-compete A/B in the last-click-wins
        // comparison below and win by virtue of being more recent, not by design.
        await db
          .delete(campaignRecipients)
          .where(
            and(
              eq(campaignRecipients.tenantId, TEST_TENANT),
              eq(campaignRecipients.customerId, optedInCustomerId),
              isNull(campaignRecipients.convertedAt),
              notInArray(campaignRecipients.id, [recipientA!.id, recipientB!.id])
            )
          );

        // A: sent 5 days ago, clicked 4 days ago. B: sent 3 days ago, clicked 1 day ago (later).
        await db
          .update(campaignRecipients)
          .set({
            sentAt: new Date(Date.now() - 5 * 86_400_000),
            clickedAt: new Date(Date.now() - 4 * 86_400_000),
          })
          .where(eq(campaignRecipients.id, recipientA!.id));
        await db
          .update(campaignRecipients)
          .set({
            sentAt: new Date(Date.now() - 3 * 86_400_000),
            clickedAt: new Date(Date.now() - 1 * 86_400_000),
          })
          .where(eq(campaignRecipients.id, recipientB!.id));

        await db.insert(invoices).values({
          tenantId: TEST_TENANT,
          branchId,
          warehouseId: branchId,
          customerId: optedInCustomerId,
          invoiceNumber: `CONV-LASTCLICK-${Date.now()}`,
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

        await CampaignService.attributeConversions(db, TEST_TENANT, 30);

        const [reloadedA] = await db
          .select()
          .from(campaignRecipients)
          .where(eq(campaignRecipients.id, recipientA!.id));
        const [reloadedB] = await db
          .select()
          .from(campaignRecipients)
          .where(eq(campaignRecipients.id, recipientB!.id));
        expect(reloadedA!.convertedAt).toBeNull();
        expect(reloadedB!.convertedAt).not.toBeNull();
      });

      // CRM-ROADMAP Phase 3, Feature 3 — the roadmap's own explicit "must reverse, not leave
      // stale revenue counted" edge case.
      it('reverses a previously-attributed conversion when its invoice is later cancelled', async () => {
        const campaign = await createCampaign({ customerIds: [optedInCustomerId] });
        await CampaignService.send(makeCtx(), campaign.id);
        const [recipient] = await db
          .select()
          .from(campaignRecipients)
          .where(
            and(
              eq(campaignRecipients.campaignId, campaign.id),
              eq(campaignRecipients.customerId, optedInCustomerId)
            )
          );
        await db
          .update(campaignRecipients)
          .set({ sentAt: new Date(Date.now() - 60_000) })
          .where(eq(campaignRecipients.id, recipient!.id));

        const [invoice] = await db
          .insert(invoices)
          .values({
            tenantId: TEST_TENANT,
            branchId,
            warehouseId: branchId,
            customerId: optedInCustomerId,
            invoiceNumber: `CONV-REVERSE-${Date.now()}`,
            placeOfSupply: '27',
            invoiceDate: new Date(),
            dueDate: new Date(Date.now() + 30 * 86_400_000),
            status: 'CONFIRMED',
            subtotal: '100',
            taxableAmount: '100',
            grandTotal: '100',
            paidAmount: '0',
            createdBy: 1,
          } as unknown as typeof invoices.$inferInsert)
          .returning();

        await CampaignService.attributeConversions(db, TEST_TENANT, 30);
        const [attributed] = await db
          .select()
          .from(campaignRecipients)
          .where(eq(campaignRecipients.id, recipient!.id));
        expect(attributed!.convertedAt).not.toBeNull();

        await db.update(invoices).set({ status: 'CANCELLED' }).where(eq(invoices.id, invoice!.id));
        await CampaignService.attributeConversions(db, TEST_TENANT, 30);

        const [reversed] = await db
          .select()
          .from(campaignRecipients)
          .where(eq(campaignRecipients.id, recipient!.id));
        expect(reversed!.convertedAt).toBeNull();
        expect(reversed!.convertedInvoiceId).toBeNull();
        expect(reversed!.convertedAmount).toBeNull();
      });
    });

    describe('getRoiReport', () => {
      afterEach(async () => {
        await db.delete(invoices).where(eq(invoices.tenantId, TEST_TENANT));
        await db
          .delete(tenantCommunicationSettings)
          .where(eq(tenantCommunicationSettings.tenantId, TEST_TENANT));
      });

      it('computes revenue, cost, and roi correctly for a campaign with a configured per-message rate', async () => {
        await db.insert(tenantCommunicationSettings).values({
          tenantId: TEST_TENANT,
          costPerMessage: { EMAIL: 2 },
        });

        const campaign = await createCampaign({ customerIds: [optedInCustomerId] });
        await CampaignService.send(makeCtx(), campaign.id);
        const [recipient] = await db
          .select()
          .from(campaignRecipients)
          .where(
            and(
              eq(campaignRecipients.campaignId, campaign.id),
              eq(campaignRecipients.customerId, optedInCustomerId)
            )
          );
        await db
          .update(campaignRecipients)
          .set({ sentAt: new Date(Date.now() - 60_000) })
          .where(eq(campaignRecipients.id, recipient!.id));
        // send()'s HTTP call to notification-service isn't reachable in this test environment,
        // so campaigns.sentCount (only incremented on a successful queue confirmation) stays 0;
        // set it directly so the cost/roi math under test is exercised deterministically.
        await db.update(campaigns).set({ sentCount: 1 }).where(eq(campaigns.id, campaign.id));

        await db.insert(invoices).values({
          tenantId: TEST_TENANT,
          branchId,
          warehouseId: branchId,
          customerId: optedInCustomerId,
          invoiceNumber: `ROI-${Date.now()}`,
          placeOfSupply: '27',
          invoiceDate: new Date(),
          dueDate: new Date(Date.now() + 30 * 86_400_000),
          status: 'CONFIRMED',
          subtotal: '300',
          taxableAmount: '300',
          grandTotal: '300',
          paidAmount: '0',
          createdBy: 1,
        } as unknown as typeof invoices.$inferInsert);
        await CampaignService.attributeConversions(db, TEST_TENANT, 30);

        const report = await CampaignService.getRoiReport(makeCtx());
        const row = report.find((r) => r.campaignId === campaign.id);
        expect(row).toBeDefined();
        expect(row!.revenue).toBe(300);
        // sentCount is 1 (single recipient), rate is 2 per message -> cost 2.
        expect(row!.cost).toBe(2);
        expect(row!.roi).toBe((300 - 2) / 2);
      });

      it('reports a null roi (not a divide-by-zero) when no cost rate is configured for the channel', async () => {
        const campaign = await createCampaign({ customerIds: [optedInCustomerId] });
        await CampaignService.send(makeCtx(), campaign.id);
        // No tenantCommunicationSettings row exists in this test — proves the "no rate
        // configured" path specifically, regardless of how many messages were actually sent.
        await db.update(campaigns).set({ sentCount: 1 }).where(eq(campaigns.id, campaign.id));

        const report = await CampaignService.getRoiReport(makeCtx());
        const row = report.find((r) => r.campaignId === campaign.id);
        expect(row).toBeDefined();
        expect(row!.cost).toBe(0);
        expect(row!.roi).toBeNull();
      });
    });

    describe('send() — multi-language translations (CRM-ROADMAP Phase 3, Feature 5)', () => {
      let hindiCustomerId: number;
      let noLangCustomerId: number;

      beforeAll(async () => {
        const [hindiCustomer] = await db
          .insert(customers)
          .values({
            tenantId: TEST_TENANT,
            branchId,
            displayName: 'Hindi Preference Customer',
            phone: '9800000001',
            creditLimit: '0',
            openingBalance: '0',
            preferredLanguage: 'hi',
            createdBy: 1,
          })
          .returning();
        hindiCustomerId = hindiCustomer!.id;

        const [noLangCustomer] = await db
          .insert(customers)
          .values({
            tenantId: TEST_TENANT,
            branchId,
            displayName: 'No Language Preference Customer',
            phone: '9800000002',
            creditLimit: '0',
            openingBalance: '0',
            createdBy: 1,
          })
          .returning();
        noLangCustomerId = noLangCustomer!.id;
      });

      afterAll(async () => {
        await db.delete(customers).where(eq(customers.id, hindiCustomerId));
        await db.delete(customers).where(eq(customers.id, noLangCustomerId));
      });

      it('sends the matching-language translation to a recipient with that preference, bypassing A/B variant assignment even when variants are configured', async () => {
        const campaign = await createCampaign({
          customerIds: [hindiCustomerId, noLangCustomerId],
        });
        await db.insert(crmCampaignVariants).values([
          {
            tenantId: TEST_TENANT,
            campaignId: campaign.id,
            label: 'A',
            messageTemplate: 'VARIANT-A {{customerName}}',
            weight: 50,
          },
          {
            tenantId: TEST_TENANT,
            campaignId: campaign.id,
            label: 'B',
            messageTemplate: 'VARIANT-B {{customerName}}',
            weight: 50,
          },
        ]);
        await db.insert(crmCampaignMessageTranslations).values({
          tenantId: TEST_TENANT,
          campaignId: campaign.id,
          language: 'hi',
          messageTemplate: 'Hindi message for {{customerName}}',
        });

        await CampaignService.send(makeCtx(), campaign.id);

        const [hindiRecipient] = await db
          .select()
          .from(campaignRecipients)
          .where(
            and(
              eq(campaignRecipients.campaignId, campaign.id),
              eq(campaignRecipients.customerId, hindiCustomerId)
            )
          );
        const [noLangRecipient] = await db
          .select()
          .from(campaignRecipients)
          .where(
            and(
              eq(campaignRecipients.campaignId, campaign.id),
              eq(campaignRecipients.customerId, noLangCustomerId)
            )
          );

        // A matched-language recipient never enters A/B variant assignment — no variantId set.
        expect(hindiRecipient!.variantId).toBeNull();
        // A recipient with no matching translation still falls through to normal A/B assignment.
        expect(noLangRecipient!.variantId).not.toBeNull();
      });
    });
  });
});
