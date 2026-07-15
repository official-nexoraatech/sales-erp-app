// CP-1 (Campaign Management Platform initiative — see ERP-PLANNING/Campaign-Planning/) baseline
// regression tests for CampaignService's CURRENT behavior, written before any later phase (CP-2+)
// changes this file. Pure-function tests always run; DB-backed tests are skipped without
// DATABASE_URL, matching the convention in es18-crm-gaps.test.ts / customer.integration.test.ts.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createDatabaseClient } from '@erp/db';
import { branches, campaigns, campaignRecipients, customers, customerSegments } from '@erp/db';
import { eq } from 'drizzle-orm';
import type { PlatformContext } from '@erp/sdk';
import {
  checkChannelLimits,
  renderCampaignMessage,
  optOutCondition,
  mediaTypeFromMime,
  validateMediaForChannel,
  detectFallbackTokens,
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

const DB_URL = process.env['DATABASE_URL'];

describe.skipIf(!DB_URL)('CampaignService — integration (CP-1 baseline)', () => {
  let db: ReturnType<typeof createDatabaseClient>;
  const TEST_TENANT = 900_301 + Math.floor(Math.random() * 1000);
  let branchId: number;
  let optedInCustomerId: number;
  let optedOutSmsCustomerId: number;

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
  });

  afterAll(async () => {
    await db.delete(campaignRecipients).where(eq(campaignRecipients.tenantId, TEST_TENANT));
    await db.delete(campaigns).where(eq(campaigns.tenantId, TEST_TENANT));
    await db.delete(customerSegments).where(eq(customerSegments.tenantId, TEST_TENANT));
    await db.delete(customers).where(eq(customers.tenantId, TEST_TENANT));
    await db.delete(branches).where(eq(branches.tenantId, TEST_TENANT));
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
});
