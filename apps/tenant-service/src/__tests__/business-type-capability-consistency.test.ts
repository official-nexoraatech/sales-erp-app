// Phase 12 expansion-framework review (2026-08-20, see ERP-PLANNING/multi-industry-platform/
// 22-phase12-expansion-framework-review.md): business_types.defaultCapabilityKeys (display-only
// metadata) and what a tenant actually gets at provisioning time must independently agree that
// "these are the capabilities this business type has by default" — nothing previously checked
// that, and all 3 existing rows had already silently drifted (missing HR_PAYROLL/POS entirely).
//
// This provisions one real tenant per vertical (mirrors tenant.integration.test.ts's exact real-
// DB/fake-storage/real-ES pattern) and reads its ACTUAL resulting feature_flags — rather than
// statically re-deriving "the expected set" from VERTICAL_DEFAULTS alone, which would have missed
// a real, separate wrinkle this test caught while being written: inventory.batch.enabled has no
// tenant-scoped row from TenantProvisioner's own baseFlags for CLOTH_RETAIL/GROCERY at all — its
// true effective value for those two verticals comes entirely from a GLOBAL feature_flags default
// row (migration 0169), a third, easy-to-miss source alongside baseFlags and VERTICAL_DEFAULTS.
// Provisioning a real tenant and reading its real, fully-resolved flags sidesteps needing to
// mirror all three sources correctly by hand.
import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import { createDatabaseClient, type ErpDatabase } from '@erp/db';
import {
  tenants,
  roles,
  users,
  branches,
  organizationSettings,
  featureFlags,
  businessTypes,
} from '@erp/db';
import { eq, and, isNull, or } from 'drizzle-orm';
import type { StorageClient } from '@erp/sdk';
import { CAPABILITY_REGISTRY } from '@erp/types';
import { TenantProvisioner } from '../domain/TenantProvisioner.js';
import type { TenantVertical } from '../rbac/vertical-defaults.js';

const DB_URL = process.env['DATABASE_URL'];

function makeFakeStorageClient(): StorageClient {
  return {
    bucketExists: vi.fn().mockResolvedValue(true),
    uploadFile: vi.fn().mockResolvedValue('tenant/1/provisioning/1-.tenant-init'),
    getSignedUrl: vi.fn().mockResolvedValue('https://minio.local/signed-url'),
    deleteFile: vi.fn().mockResolvedValue(undefined),
  } as unknown as StorageClient;
}

describe.skipIf(!DB_URL)(
  'business_types.defaultCapabilityKeys vs real provisioning — real Postgres',
  () => {
    let db: ErpDatabase;
    const provisionedTenantIds: number[] = [];

    beforeAll(async () => {
      db = createDatabaseClient({ url: DB_URL! });
    });

    afterAll(async () => {
      for (const id of provisionedTenantIds) {
        await db.execute(`DELETE FROM user_roles WHERE tenant_id = ${id}`);
        await db.execute(`DELETE FROM user_branches WHERE tenant_id = ${id}`);
        await db.execute(`DELETE FROM role_permissions WHERE tenant_id = ${id}`);
        await db.delete(organizationSettings).where(eq(organizationSettings.tenantId, id));
        await db.delete(featureFlags).where(eq(featureFlags.tenantId, id));
        await db.delete(users).where(eq(users.tenantId, id));
        await db.delete(roles).where(eq(roles.tenantId, id));
        await db.delete(branches).where(eq(branches.tenantId, id));
        await db.delete(tenants).where(eq(tenants.id, id));
      }
    });

    it.each(['CLOTH_RETAIL', 'GROCERY', 'DISTRIBUTION', 'MANUFACTURING'] as TenantVertical[])(
      "a freshly-provisioned %s tenant's effective capabilities match its business_types row",
      async (vertical) => {
        const provisioner = new TenantProvisioner(
          db,
          'http://localhost:9200',
          makeFakeStorageClient()
        );
        const slug = `capability-consistency-${vertical.toLowerCase()}-${Date.now()}`;
        const result = await provisioner.provision({
          name: `Capability Consistency Test ${vertical}`,
          slug,
          contactEmail: `capability-consistency-${Date.now()}@test.example`,
          adminFirstName: 'Test',
          adminLastName: 'Admin',
          adminPassword: 'Test@12345',
          plan: 'STARTER',
          vertical,
        });
        provisionedTenantIds.push(result.tenantId);

        // Effective flag value: tenant-scoped row wins if present, else the global (tenant_id IS
        // NULL) default — same precedence PlatformFeatureFlags itself already documents/implements.
        const relevantFlagKeys = Object.values(CAPABILITY_REGISTRY).map((cap) => cap.flagKey);
        const flagRows = await db
          .select()
          .from(featureFlags)
          .where(
            and(
              or(eq(featureFlags.tenantId, result.tenantId), isNull(featureFlags.tenantId)),
              or(...relevantFlagKeys.map((k) => eq(featureFlags.flagKey, k)))
            )
          );

        const effective = new Map<string, boolean>();
        for (const row of flagRows) {
          // Tenant-scoped rows are processed after global ones so they always win, regardless of
          // row order returned by the query.
          if (row.tenantId === null && !effective.has(row.flagKey))
            effective.set(row.flagKey, row.enabled);
        }
        for (const row of flagRows) {
          if (row.tenantId === result.tenantId) effective.set(row.flagKey, row.enabled);
        }

        const actualCapabilityKeys = Object.values(CAPABILITY_REGISTRY)
          .filter((cap) => effective.get(cap.flagKey) === true)
          .map((cap) => cap.key)
          .sort();

        const [businessTypeRow] = await db
          .select()
          .from(businessTypes)
          .where(eq(businessTypes.code, vertical));
        const seededCapabilityKeys = [...(businessTypeRow?.defaultCapabilityKeys ?? [])].sort();

        expect(seededCapabilityKeys).toEqual(actualCapabilityKeys);
      },
      20_000
    );
  }
);
