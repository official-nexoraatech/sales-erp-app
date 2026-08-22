import { and, eq, inArray, sql } from 'drizzle-orm';
import {
  crmTerritories,
  crmTerritoryBranches,
  crmTerritoryUsers,
  branches,
  users,
  crmLeads,
  crmOpportunities,
} from '@erp/db';
import type { ErpDatabase, CrmTerritory } from '@erp/db';
import { NotFoundError, OptimisticLockError, ValidationError } from '@erp/types';

export interface TerritoryCoverage {
  branches: Array<{ id: number; name: string }>;
  users: Array<{ id: number; firstName: string; lastName: string }>;
  leadCount: number;
  opportunityCount: number;
}

/**
 * CRM-ROADMAP Phase 4, Feature 4 — Territory Management.
 *
 * A territory groups one or more branches into a named region for rep/quota assignment, layered
 * on top of (never replacing) the existing single-dimension branch scoping (AR-6). A rep's
 * effective territory scope is the UNION of every territory they belong to — computed as a set
 * via getTerritoryScope, never "which territory wins" — since overlapping territory membership
 * is an explicit, supported case per this feature's own acceptance criteria, not a conflict.
 */
export class TerritoryService {
  static async list(db: ErpDatabase, tenantId: number): Promise<CrmTerritory[]> {
    return db
      .select()
      .from(crmTerritories)
      .where(eq(crmTerritories.tenantId, tenantId))
      .orderBy(crmTerritories.name);
  }

  static async create(
    db: ErpDatabase,
    tenantId: number,
    userId: number,
    params: { name: string; description?: string | undefined }
  ): Promise<CrmTerritory> {
    const [created] = await db
      .insert(crmTerritories)
      .values({
        tenantId,
        name: params.name,
        description: params.description ?? null,
        createdBy: userId,
      })
      .returning();
    if (!created) throw new Error('Territory creation failed unexpectedly');
    return created;
  }

  static async update(
    db: ErpDatabase,
    tenantId: number,
    territoryId: number,
    patch: {
      name?: string | undefined;
      description?: string | null | undefined;
      isActive?: boolean | undefined;
      version: number;
    }
  ): Promise<CrmTerritory> {
    const [updated] = await db
      .update(crmTerritories)
      .set({
        ...(patch.name !== undefined ? { name: patch.name } : {}),
        ...(patch.description !== undefined ? { description: patch.description } : {}),
        ...(patch.isActive !== undefined ? { isActive: patch.isActive } : {}),
        updatedAt: new Date(),
        version: sql`${crmTerritories.version} + 1`,
      })
      .where(
        and(
          eq(crmTerritories.id, territoryId),
          eq(crmTerritories.tenantId, tenantId),
          eq(crmTerritories.version, patch.version)
        )
      )
      .returning();
    if (!updated) {
      const [existing] = await db
        .select({ id: crmTerritories.id })
        .from(crmTerritories)
        .where(and(eq(crmTerritories.id, territoryId), eq(crmTerritories.tenantId, tenantId)));
      throw existing
        ? new OptimisticLockError('Territory')
        : new NotFoundError('Territory', territoryId);
    }
    return updated;
  }

  /** Replace-all: the caller sends the complete desired branch set, not an incremental diff. */
  static async setBranches(
    db: ErpDatabase,
    tenantId: number,
    territoryId: number,
    branchIds: number[]
  ): Promise<void> {
    const [territory] = await db
      .select({ id: crmTerritories.id })
      .from(crmTerritories)
      .where(and(eq(crmTerritories.id, territoryId), eq(crmTerritories.tenantId, tenantId)));
    if (!territory) throw new NotFoundError('Territory', territoryId);

    if (branchIds.length > 0) {
      const validBranches = await db
        .select({ id: branches.id })
        .from(branches)
        .where(and(inArray(branches.id, branchIds), eq(branches.tenantId, tenantId)));
      if (validBranches.length !== new Set(branchIds).size) {
        throw new ValidationError('One or more branchIds do not belong to this tenant');
      }
    }

    await db.transaction(async (trx) => {
      await trx
        .delete(crmTerritoryBranches)
        .where(eq(crmTerritoryBranches.territoryId, territoryId));
      if (branchIds.length > 0) {
        await trx
          .insert(crmTerritoryBranches)
          .values(branchIds.map((branchId) => ({ tenantId, territoryId, branchId })));
      }
    });
  }

  /** Replace-all: same reasoning as setBranches. */
  static async setUsers(
    db: ErpDatabase,
    tenantId: number,
    territoryId: number,
    userIds: number[]
  ): Promise<void> {
    const [territory] = await db
      .select({ id: crmTerritories.id })
      .from(crmTerritories)
      .where(and(eq(crmTerritories.id, territoryId), eq(crmTerritories.tenantId, tenantId)));
    if (!territory) throw new NotFoundError('Territory', territoryId);

    if (userIds.length > 0) {
      const validUsers = await db
        .select({ id: users.id })
        .from(users)
        .where(and(inArray(users.id, userIds), eq(users.tenantId, tenantId)));
      if (validUsers.length !== new Set(userIds).size) {
        throw new ValidationError('One or more userIds do not belong to this tenant');
      }
    }

    await db.transaction(async (trx) => {
      await trx.delete(crmTerritoryUsers).where(eq(crmTerritoryUsers.territoryId, territoryId));
      if (userIds.length > 0) {
        await trx
          .insert(crmTerritoryUsers)
          .values(userIds.map((userId) => ({ tenantId, territoryId, userId })));
      }
    });
  }

  static async getCoverage(
    db: ErpDatabase,
    tenantId: number,
    territoryId: number
  ): Promise<TerritoryCoverage> {
    const [territory] = await db
      .select({ id: crmTerritories.id })
      .from(crmTerritories)
      .where(and(eq(crmTerritories.id, territoryId), eq(crmTerritories.tenantId, tenantId)));
    if (!territory) throw new NotFoundError('Territory', territoryId);

    const branchRows = await db
      .select({ id: branches.id, name: branches.name })
      .from(crmTerritoryBranches)
      .innerJoin(branches, eq(branches.id, crmTerritoryBranches.branchId))
      .where(eq(crmTerritoryBranches.territoryId, territoryId));

    const userRows = await db
      .select({ id: users.id, firstName: users.firstName, lastName: users.lastName })
      .from(crmTerritoryUsers)
      .innerJoin(users, eq(users.id, crmTerritoryUsers.userId))
      .where(eq(crmTerritoryUsers.territoryId, territoryId));

    const branchIds = branchRows.map((b) => b.id);
    let leadCount = 0;
    let opportunityCount = 0;
    if (branchIds.length > 0) {
      const [leadRow] = await db
        .select({ count: sql<number>`count(*)::int` })
        .from(crmLeads)
        .where(and(eq(crmLeads.tenantId, tenantId), inArray(crmLeads.branchId, branchIds)));
      leadCount = leadRow?.count ?? 0;

      const [oppRow] = await db
        .select({ count: sql<number>`count(*)::int` })
        .from(crmOpportunities)
        .where(
          and(
            eq(crmOpportunities.tenantId, tenantId),
            inArray(crmOpportunities.branchId, branchIds)
          )
        );
      opportunityCount = oppRow?.count ?? 0;
    }

    return { branches: branchRows, users: userRows, leadCount, opportunityCount };
  }

  /**
   * A rep's effective territory-derived branch scope — the UNION of every branch belonging to
   * every territory this user is a member of. Returns an empty array when the user belongs to
   * no territory at all, which callers should treat as "not territory-scoped" (fall back to the
   * existing branchIds-based getBranchScope from @erp/sdk), not as "scoped to nothing" — those
   * are different things and this method's empty return must not be confused with a deliberate
   * zero-branch territory assignment.
   */
  static async getTerritoryScope(
    db: ErpDatabase,
    tenantId: number,
    userId: number
  ): Promise<number[]> {
    const rows = await db
      .selectDistinct({ branchId: crmTerritoryBranches.branchId })
      .from(crmTerritoryUsers)
      .innerJoin(
        crmTerritoryBranches,
        eq(crmTerritoryBranches.territoryId, crmTerritoryUsers.territoryId)
      )
      .where(and(eq(crmTerritoryUsers.userId, userId), eq(crmTerritoryUsers.tenantId, tenantId)));
    return rows.map((r) => r.branchId);
  }
}
