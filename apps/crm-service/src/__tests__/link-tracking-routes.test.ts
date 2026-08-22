// CRM-ROADMAP Phase 2, Feature 6 — Campaign Studio — Engagement Tracking Activation.
// Route-level (real HTTP, real DB) coverage for the two public tracking endpoints — this is
// the roadmap's own "highest regression risk" / security-sensitive feature in Phase 2, so the
// actual route logic is exercised here directly (fastify.inject), not just the underlying
// service-layer writes. Explicitly covers the DoD's "open-redirect vulnerability must be
// explicitly tested and closed" requirement and the "clicked exactly once" semantic.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { createDatabaseClient } from '@erp/db';
import { branches, customers, campaigns, campaignRecipients, crmLinkClicks } from '@erp/db';
import { eq } from 'drizzle-orm';
import { linkTrackingRoutes } from '../api/link-tracking.routes.js';

const DB_URL = process.env['DATABASE_URL'];

describe.skipIf(!DB_URL)('link-tracking.routes — integration', () => {
  let db: ReturnType<typeof createDatabaseClient>;
  const TEST_TENANT = 901_001 + Math.floor(Math.random() * 1000);
  let campaignId: number;
  let recipientId: number;
  let app: FastifyInstance;

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
    const [customer] = await db
      .insert(customers)
      .values({
        tenantId: TEST_TENANT,
        branchId: branch!.id,
        displayName: 'Tracking Test Customer',
        phone: '9700001111',
        creditLimit: '0',
        openingBalance: '0',
        createdBy: 1,
      })
      .returning();
    const [campaign] = await db
      .insert(campaigns)
      .values({
        tenantId: TEST_TENANT,
        name: 'Tracking Test Campaign',
        customerIds: [customer!.id],
        channel: 'EMAIL',
        messageTemplate: 'Hi {{customerName}}',
        status: 'SENT',
        createdBy: 1,
      })
      .returning();
    campaignId = campaign!.id;
    const [recipient] = await db
      .insert(campaignRecipients)
      .values({ tenantId: TEST_TENANT, campaignId, customerId: customer!.id, status: 'SENT' })
      .returning();
    recipientId = recipient!.id;

    app = Fastify({ logger: false });
    await linkTrackingRoutes(app, {} as never);
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
    await db.delete(crmLinkClicks).where(eq(crmLinkClicks.tenantId, TEST_TENANT));
    await db.delete(campaignRecipients).where(eq(campaignRecipients.tenantId, TEST_TENANT));
    await db.delete(campaigns).where(eq(campaigns.tenantId, TEST_TENANT));
    await db.delete(customers).where(eq(customers.tenantId, TEST_TENANT));
    await db.delete(branches).where(eq(branches.tenantId, TEST_TENANT));
  });

  describe('GET /c/:trackingToken', () => {
    it('redirects to the exact destinationUrl stored for the token, ignoring any query string on the request (open-redirect closed)', async () => {
      const [row] = await db
        .insert(crmLinkClicks)
        .values({
          tenantId: TEST_TENANT,
          campaignId,
          campaignRecipientId: recipientId,
          trackingToken: 'tok-redirect-test',
          destinationUrl: 'https://real-tenant-destination.example/sale',
        })
        .returning();

      // An attacker appending ?redirect=https://evil.example must have zero effect — the
      // route never reads anything from the request beyond the path token itself.
      const res = await app.inject({
        method: 'GET',
        url: '/c/tok-redirect-test?redirect=https://evil.example/phish',
      });

      expect(res.statusCode).toBe(302);
      expect(res.headers.location).toBe('https://real-tenant-destination.example/sale');

      const [updated] = await db.select().from(crmLinkClicks).where(eq(crmLinkClicks.id, row!.id));
      expect(updated!.clickCount).toBe(1);
      expect(updated!.firstClickedAt).not.toBeNull();

      const [recipientRow] = await db
        .select()
        .from(campaignRecipients)
        .where(eq(campaignRecipients.id, recipientId));
      expect(recipientRow!.clickedAt).not.toBeNull();
    });

    it('records a second click (incrementing clickCount) without overwriting the first-click timestamp ("exactly once" semantic)', async () => {
      const [before] = await db
        .select()
        .from(crmLinkClicks)
        .where(eq(crmLinkClicks.trackingToken, 'tok-redirect-test'));
      const firstClickedAt = before!.firstClickedAt;
      const clickedAtBefore = (
        await db.select().from(campaignRecipients).where(eq(campaignRecipients.id, recipientId))
      )[0]!.clickedAt;

      await new Promise((resolve) => setTimeout(resolve, 10));
      const res = await app.inject({ method: 'GET', url: '/c/tok-redirect-test' });
      expect(res.statusCode).toBe(302);

      const [after] = await db
        .select()
        .from(crmLinkClicks)
        .where(eq(crmLinkClicks.trackingToken, 'tok-redirect-test'));
      expect(after!.clickCount).toBe(2);
      expect(after!.firstClickedAt?.getTime()).toBe(firstClickedAt?.getTime());

      const [recipientAfter] = await db
        .select()
        .from(campaignRecipients)
        .where(eq(campaignRecipients.id, recipientId));
      expect(recipientAfter!.clickedAt?.getTime()).toBe(clickedAtBefore?.getTime());
    });

    it('404s for an unknown token (no redirect happens)', async () => {
      const res = await app.inject({ method: 'GET', url: '/c/this-token-does-not-exist' });
      expect(res.statusCode).toBe(404);
    });

    it('404s for a token with no destinationUrl (open-pixel-only, nothing to redirect to)', async () => {
      await db.insert(crmLinkClicks).values({
        tenantId: TEST_TENANT,
        campaignId,
        campaignRecipientId: recipientId,
        trackingToken: 'tok-open-only',
        destinationUrl: null,
      });
      const res = await app.inject({ method: 'GET', url: '/c/tok-open-only' });
      expect(res.statusCode).toBe(404);
    });
  });

  describe('GET /o/:trackingToken', () => {
    it('returns a PNG pixel and sets openedAt exactly once across repeated loads', async () => {
      const res1 = await app.inject({ method: 'GET', url: '/o/tok-open-only' });
      expect(res1.statusCode).toBe(200);
      expect(res1.headers['content-type']).toBe('image/png');
      expect(res1.rawPayload.length).toBeGreaterThan(0);

      const [recipientAfterFirst] = await db
        .select()
        .from(campaignRecipients)
        .where(eq(campaignRecipients.id, recipientId));
      const firstOpenedAt = recipientAfterFirst!.openedAt;
      expect(firstOpenedAt).not.toBeNull();

      await new Promise((resolve) => setTimeout(resolve, 10));
      const res2 = await app.inject({ method: 'GET', url: '/o/tok-open-only' });
      expect(res2.statusCode).toBe(200);

      const [recipientAfterSecond] = await db
        .select()
        .from(campaignRecipients)
        .where(eq(campaignRecipients.id, recipientId));
      expect(recipientAfterSecond!.openedAt?.getTime()).toBe(firstOpenedAt?.getTime());

      const [linkClick] = await db
        .select()
        .from(crmLinkClicks)
        .where(eq(crmLinkClicks.trackingToken, 'tok-open-only'));
      expect(linkClick!.openCount).toBe(2);
    });

    it('still returns a valid pixel for an unknown token (never breaks email rendering)', async () => {
      const res = await app.inject({ method: 'GET', url: '/o/unknown-token-entirely' });
      expect(res.statusCode).toBe(200);
      expect(res.headers['content-type']).toBe('image/png');
    });
  });
});
