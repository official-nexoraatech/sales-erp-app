import { createHash, randomBytes } from 'crypto';
import { and, eq } from 'drizzle-orm';
import { crmApiKeys } from '@erp/db';
import type { ErpDatabase, CrmApiKey } from '@erp/db';
import { NotFoundError, ValidationError } from '@erp/types';

// The public API is read-only by design (roadmap's own spec: "read-mostly CRM data") — this
// pass ships no write scopes at all.
export const PUBLIC_API_SCOPES = [
  'leads:read',
  'opportunities:read',
  'accounts:read',
  'contacts:read',
] as const;
export type PublicApiScope = (typeof PUBLIC_API_SCOPES)[number];

const KEY_PREFIX = 'crm_live_';

function sha256Hex(input: string): string {
  return createHash('sha256').update(input).digest('hex');
}

export interface CreatedApiKey {
  apiKey: Omit<CrmApiKey, 'keyHash'>;
  plaintextKey: string;
}

export interface ApiKeyAuthResult {
  tenantId: number;
  apiKeyId: number;
  scopes: string[];
}

/**
 * CRM-ROADMAP Phase 4, Feature 8 — Public CRM API & BI/Data-Warehouse Export.
 *
 * A third auth mechanism alongside staff JWTs and the CUSTOMER-role portal JWT (Phase 3,
 * Feature 2): a per-tenant, per-key credential for external tools reading read-mostly CRM data.
 * Same storage discipline as password hashing — only sha256(rawKey) is ever persisted; the raw
 * key is generated here and returned exactly once, at creation time.
 */
export class ApiKeyService {
  static async list(db: ErpDatabase, tenantId: number): Promise<Array<Omit<CrmApiKey, 'keyHash'>>> {
    const rows = await db
      .select({
        id: crmApiKeys.id,
        tenantId: crmApiKeys.tenantId,
        name: crmApiKeys.name,
        keyPrefix: crmApiKeys.keyPrefix,
        scopes: crmApiKeys.scopes,
        isActive: crmApiKeys.isActive,
        lastUsedAt: crmApiKeys.lastUsedAt,
        expiresAt: crmApiKeys.expiresAt,
        revokedAt: crmApiKeys.revokedAt,
        revokedBy: crmApiKeys.revokedBy,
        createdBy: crmApiKeys.createdBy,
        createdAt: crmApiKeys.createdAt,
      })
      .from(crmApiKeys)
      .where(eq(crmApiKeys.tenantId, tenantId))
      .orderBy(crmApiKeys.createdAt);
    return rows;
  }

  static async create(
    db: ErpDatabase,
    tenantId: number,
    userId: number,
    params: { name: string; scopes: string[]; expiresAt?: Date | undefined }
  ): Promise<CreatedApiKey> {
    const invalidScopes = params.scopes.filter(
      (s) => !(PUBLIC_API_SCOPES as readonly string[]).includes(s)
    );
    if (invalidScopes.length > 0) {
      throw new ValidationError(`Unknown scope(s): ${invalidScopes.join(', ')}`);
    }
    if (params.scopes.length === 0) {
      throw new ValidationError('At least one scope is required');
    }

    const rawKey = `${KEY_PREFIX}${randomBytes(32).toString('hex')}`;
    const keyHash = sha256Hex(rawKey);
    const keyPrefix = rawKey.slice(0, 17); // 'crm_live_' + 8 hex chars — enough to identify, not to guess.

    const [created] = await db
      .insert(crmApiKeys)
      .values({
        tenantId,
        name: params.name,
        keyPrefix,
        keyHash,
        scopes: params.scopes,
        createdBy: userId,
        ...(params.expiresAt ? { expiresAt: params.expiresAt } : {}),
      })
      .returning();
    if (!created) throw new Error('API key creation failed unexpectedly');

    const apiKey: Omit<CrmApiKey, 'keyHash'> = {
      id: created.id,
      tenantId: created.tenantId,
      name: created.name,
      keyPrefix: created.keyPrefix,
      scopes: created.scopes,
      isActive: created.isActive,
      lastUsedAt: created.lastUsedAt,
      expiresAt: created.expiresAt,
      revokedAt: created.revokedAt,
      revokedBy: created.revokedBy,
      createdBy: created.createdBy,
      createdAt: created.createdAt,
    };
    return { apiKey, plaintextKey: rawKey };
  }

  static async revoke(
    db: ErpDatabase,
    tenantId: number,
    userId: number,
    keyId: number
  ): Promise<void> {
    const [updated] = await db
      .update(crmApiKeys)
      .set({ isActive: false, revokedAt: new Date(), revokedBy: userId })
      .where(and(eq(crmApiKeys.id, keyId), eq(crmApiKeys.tenantId, tenantId)))
      .returning({ id: crmApiKeys.id });
    if (!updated) throw new NotFoundError('ApiKey', keyId);
  }

  /**
   * Validates a raw key presented by a caller and returns its tenant/scopes, or null if the key
   * is unknown, inactive, revoked, or expired. Never throws on an invalid key — an invalid API
   * key is an expected, routine input from the public API's own perspective, not an exceptional
   * one.
   */
  static async authenticate(db: ErpDatabase, rawKey: string): Promise<ApiKeyAuthResult | null> {
    if (!rawKey.startsWith(KEY_PREFIX)) return null;
    const keyHash = sha256Hex(rawKey);
    const [row] = await db.select().from(crmApiKeys).where(eq(crmApiKeys.keyHash, keyHash));
    if (!row) return null;
    if (!row.isActive || row.revokedAt) return null;
    if (row.expiresAt && row.expiresAt < new Date()) return null;

    // Best-effort — a failed lastUsedAt bump must never block the actual request it's tracking.
    void db
      .update(crmApiKeys)
      .set({ lastUsedAt: new Date() })
      .where(eq(crmApiKeys.id, row.id))
      .catch(() => {});

    return { tenantId: row.tenantId, apiKeyId: row.id, scopes: row.scopes as string[] };
  }
}
