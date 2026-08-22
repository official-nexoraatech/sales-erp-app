// CRM-ROADMAP Phase 3, Feature 5 (Multi-language Communication) — route-level coverage for the
// translation CRUD endpoints and the template→campaign snapshot-copy behavior. The core
// send()-time resolution logic (which template a recipient actually gets) is covered separately
// in campaign-service.test.ts's resolveRecipientTemplate + multi-language describe blocks; this
// file covers the CRUD/validation/snapshot logic that lives in campaign.routes.ts itself
// (moved here from sales-service's crm.routes.ts, CRM/O2C split migration 7).
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { generateKeyPairSync } from 'node:crypto';
import { SignJWT, importPKCS8, type KeyLike } from 'jose';
import { createDatabaseClient } from '@erp/db';
import {
  campaigns,
  campaignTemplates,
  crmCampaignTemplateTranslations,
  crmCampaignMessageTranslations,
} from '@erp/db';
import { eq } from 'drizzle-orm';
import type { PlatformContextFactory } from '@erp/sdk';
import { PERMISSIONS } from '@erp/types';
import { campaignRoutes } from '../api/campaign.routes.js';

const DB_URL = process.env['DATABASE_URL'];
const TEST_ISSUER = process.env['JWT_ISSUER'] ?? 'erp-auth-service';

describe.skipIf(!DB_URL)('CRM multi-language translation routes', () => {
  let db: ReturnType<typeof createDatabaseClient>;
  let app: FastifyInstance;
  let privateKey: KeyLike;
  const TEST_TENANT = 900_601 + Math.floor(Math.random() * 1000);
  let templateId: number;

  async function makeToken(permissions: string[]): Promise<string> {
    const nowSec = Math.floor(Date.now() / 1000);
    return new SignJWT({
      tenantId: TEST_TENANT,
      email: 'test@erp.local',
      roles: [],
      permissions,
      branchIds: [],
    })
      .setProtectedHeader({ alg: 'RS256' })
      .setSubject('1')
      .setIssuer(TEST_ISSUER)
      .setIssuedAt(nowSec)
      .setExpirationTime(nowSec + 900)
      .sign(privateKey);
  }

  beforeAll(async () => {
    db = createDatabaseClient({ url: DB_URL! });
    const { privateKey: privPem, publicKey: pubPem } = generateKeyPairSync('rsa', {
      modulusLength: 2048,
      publicKeyEncoding: { type: 'spki', format: 'pem' },
      privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
    });
    privateKey = await importPKCS8(privPem, 'RS256');
    process.env['JWT_PUBLIC_KEY'] = pubPem;

    const [template] = await db
      .insert(campaignTemplates)
      .values({
        tenantId: TEST_TENANT,
        name: 'Diwali Sale',
        channel: 'SMS',
        messageTemplate: 'Diwali Sale! Flat 20% off.',
        createdBy: 1,
      })
      .returning();
    templateId = template!.id;

    const ctxFactory = {
      create: (tenant: { tenantId: number; userId: number }) => ({
        db: {
          raw: db,
          transaction: async (fn: (trx: { raw: typeof db }) => Promise<unknown>) =>
            db.transaction(async (trx) => fn({ raw: trx })),
        },
        tenant,
        events: { publish: async () => undefined },
        audit: { log: async () => undefined },
      }),
    } as unknown as PlatformContextFactory;

    app = Fastify({ logger: false });
    await campaignRoutes(app, ctxFactory);
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
    await db
      .delete(crmCampaignMessageTranslations)
      .where(eq(crmCampaignMessageTranslations.tenantId, TEST_TENANT));
    await db.delete(campaigns).where(eq(campaigns.tenantId, TEST_TENANT));
    await db
      .delete(crmCampaignTemplateTranslations)
      .where(eq(crmCampaignTemplateTranslations.tenantId, TEST_TENANT));
    await db.delete(campaignTemplates).where(eq(campaignTemplates.tenantId, TEST_TENANT));
  });

  describe('PUT /crm/campaign-templates/:id/translations', () => {
    it('rejects a duplicate language in the same request', async () => {
      const token = await makeToken([PERMISSIONS.CRM_CAMPAIGN_CREATE]);
      const res = await app.inject({
        method: 'PUT',
        url: `/crm/campaign-templates/${templateId}/translations`,
        headers: { Authorization: `Bearer ${token}` },
        payload: {
          translations: [
            { language: 'hi', messageTemplate: 'A' },
            { language: 'hi', messageTemplate: 'B' },
          ],
        },
      });
      expect(res.statusCode).toBe(422);
    });

    it('saves a translation set and GET reflects it', async () => {
      const token = await makeToken([PERMISSIONS.CRM_CAMPAIGN_CREATE, PERMISSIONS.CRM_VIEW]);
      const putRes = await app.inject({
        method: 'PUT',
        url: `/crm/campaign-templates/${templateId}/translations`,
        headers: { Authorization: `Bearer ${token}` },
        payload: { translations: [{ language: 'hi', messageTemplate: 'दिवाली सेल! 20% छूट।' }] },
      });
      expect(putRes.statusCode).toBe(200);

      const getRes = await app.inject({
        method: 'GET',
        url: `/crm/campaign-templates/${templateId}/translations`,
        headers: { Authorization: `Bearer ${token}` },
      });
      const body = getRes.json();
      expect(body.data.totalElements).toBe(1);
      expect(body.data.content[0].language).toBe('hi');
    });

    it('replaces the whole set on a second call, not merging with the first', async () => {
      const token = await makeToken([PERMISSIONS.CRM_CAMPAIGN_CREATE, PERMISSIONS.CRM_VIEW]);
      await app.inject({
        method: 'PUT',
        url: `/crm/campaign-templates/${templateId}/translations`,
        headers: { Authorization: `Bearer ${token}` },
        payload: { translations: [{ language: 'ta', messageTemplate: 'Tamil only' }] },
      });

      const getRes = await app.inject({
        method: 'GET',
        url: `/crm/campaign-templates/${templateId}/translations`,
        headers: { Authorization: `Bearer ${token}` },
      });
      const body = getRes.json();
      expect(body.data.totalElements).toBe(1);
      expect(body.data.content[0].language).toBe('ta');
    });
  });

  describe('POST /crm/campaigns — snapshot-copies template translations', () => {
    it('a campaign created from a template with translations gets its own copy of them', async () => {
      const token = await makeToken([PERMISSIONS.CRM_CAMPAIGN_CREATE, PERMISSIONS.CRM_VIEW]);
      await app.inject({
        method: 'PUT',
        url: `/crm/campaign-templates/${templateId}/translations`,
        headers: { Authorization: `Bearer ${token}` },
        payload: { translations: [{ language: 'hi', messageTemplate: 'Hindi from template' }] },
      });

      const createRes = await app.inject({
        method: 'POST',
        url: '/crm/campaigns',
        headers: { Authorization: `Bearer ${token}` },
        payload: {
          name: 'From Template Campaign',
          customerIds: [1],
          // EMAIL, not SMS — sidesteps the unrelated DLT-compliance gate (Phase 1, Feature 6),
          // which isn't what this test is about.
          channel: 'EMAIL',
          messageTemplate: 'Diwali Sale! Flat 20% off.',
          templateId,
        },
      });
      expect(createRes.statusCode).toBe(201);
      const campaignId = createRes.json().data.id;

      const translationsRes = await app.inject({
        method: 'GET',
        url: `/crm/campaigns/${campaignId}/translations`,
        headers: { Authorization: `Bearer ${token}` },
      });
      const body = translationsRes.json();
      expect(body.data.totalElements).toBe(1);
      expect(body.data.content[0].language).toBe('hi');
      expect(body.data.content[0].messageTemplate).toBe('Hindi from template');
    });
  });

  describe('PUT /crm/campaigns/:id/translations', () => {
    it('is blocked once the campaign has left DRAFT/SCHEDULED', async () => {
      const token = await makeToken([PERMISSIONS.CRM_CAMPAIGN_CREATE]);
      const [sentCampaign] = await db
        .insert(campaigns)
        .values({
          tenantId: TEST_TENANT,
          name: 'Already Sent',
          customerIds: [1],
          channel: 'SMS',
          messageTemplate: 'Hi',
          status: 'SENT',
          createdBy: 1,
        })
        .returning();

      const res = await app.inject({
        method: 'PUT',
        url: `/crm/campaigns/${sentCampaign!.id}/translations`,
        headers: { Authorization: `Bearer ${token}` },
        payload: { translations: [{ language: 'hi', messageTemplate: 'Too late' }] },
      });
      expect(res.statusCode).toBe(422);
    });
  });
});
