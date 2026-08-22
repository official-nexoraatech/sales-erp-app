// CRM-ROADMAP Phase 4, Feature 8 — Public CRM API & BI/Data-Warehouse Export.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createDatabaseClient } from '@erp/db';
import { crmApiKeys } from '@erp/db';
import { eq } from 'drizzle-orm';
import { NotFoundError, ValidationError } from '@erp/types';
import { ApiKeyService } from '../domain/ApiKeyService.js';

const DB_URL = process.env['DATABASE_URL'];

describe.skipIf(!DB_URL)('ApiKeyService', () => {
  let db: ReturnType<typeof createDatabaseClient>;
  const TEST_TENANT = 908_501 + Math.floor(Math.random() * 1000);
  const OTHER_TENANT = TEST_TENANT + 1;

  beforeAll(() => {
    db = createDatabaseClient({ url: DB_URL! });
  });

  afterAll(async () => {
    await db.delete(crmApiKeys).where(eq(crmApiKeys.tenantId, TEST_TENANT));
    await db.delete(crmApiKeys).where(eq(crmApiKeys.tenantId, OTHER_TENANT));
  });

  it('creates a key, returns the plaintext exactly once, and never stores it', async () => {
    const { apiKey, plaintextKey } = await ApiKeyService.create(db, TEST_TENANT, 1, {
      name: 'BI Tool',
      scopes: ['leads:read'],
    });
    expect(plaintextKey).toMatch(/^crm_live_[0-9a-f]{64}$/);
    expect(apiKey.keyPrefix).toBe(plaintextKey.slice(0, 17));
    expect((apiKey as unknown as { keyHash?: string }).keyHash).toBeUndefined();

    const [row] = await db.select().from(crmApiKeys).where(eq(crmApiKeys.id, apiKey.id));
    expect(row!.keyHash).not.toBe(plaintextKey);
  });

  it('rejects an unknown scope', async () => {
    await expect(
      ApiKeyService.create(db, TEST_TENANT, 1, { name: 'Bad', scopes: ['invoices:write'] })
    ).rejects.toThrow(ValidationError);
  });

  it('rejects zero scopes', async () => {
    await expect(
      ApiKeyService.create(db, TEST_TENANT, 1, { name: 'Bad', scopes: [] })
    ).rejects.toThrow(ValidationError);
  });

  it('authenticate() validates a real key and returns its tenant/scopes', async () => {
    const { plaintextKey } = await ApiKeyService.create(db, TEST_TENANT, 1, {
      name: 'Auth Test Key',
      scopes: ['opportunities:read', 'accounts:read'],
    });
    const auth = await ApiKeyService.authenticate(db, plaintextKey);
    expect(auth).toEqual({
      tenantId: TEST_TENANT,
      apiKeyId: expect.any(Number),
      scopes: ['opportunities:read', 'accounts:read'],
    });
  });

  it('authenticate() returns null for an unknown key', async () => {
    const auth = await ApiKeyService.authenticate(db, 'crm_live_' + 'a'.repeat(64));
    expect(auth).toBeNull();
  });

  it('authenticate() returns null for a malformed key (wrong prefix)', async () => {
    const auth = await ApiKeyService.authenticate(db, 'not-a-real-key');
    expect(auth).toBeNull();
  });

  it('authenticate() returns null after revocation', async () => {
    const { apiKey, plaintextKey } = await ApiKeyService.create(db, TEST_TENANT, 1, {
      name: 'Revoke Test Key',
      scopes: ['leads:read'],
    });
    await ApiKeyService.revoke(db, TEST_TENANT, 1, apiKey.id);
    const auth = await ApiKeyService.authenticate(db, plaintextKey);
    expect(auth).toBeNull();
  });

  it('revoke() throws NotFoundError for a key belonging to a different tenant', async () => {
    const { apiKey } = await ApiKeyService.create(db, OTHER_TENANT, 1, {
      name: 'Other Tenant Key',
      scopes: ['leads:read'],
    });
    await expect(ApiKeyService.revoke(db, TEST_TENANT, 1, apiKey.id)).rejects.toThrow(
      NotFoundError
    );
  });

  it("list() never includes keyHash and only returns the caller tenant's keys", async () => {
    const rows = await ApiKeyService.list(db, TEST_TENANT);
    expect(rows.every((r) => r.tenantId === TEST_TENANT)).toBe(true);
    expect(rows.every((r) => !('keyHash' in r))).toBe(true);
  });
});
