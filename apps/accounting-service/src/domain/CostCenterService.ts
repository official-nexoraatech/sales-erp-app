import { eq, and } from 'drizzle-orm';
import { costCenters, type CostCenter } from '@erp/db';
import type { TenantScopedDatabase } from '@erp/sdk';
import { BusinessError, NotFoundError } from '@erp/types';

export interface CostCenterInput {
  code: string;
  name: string;
  parentId?: number | undefined;
}

export interface CostCenterUpdateInput {
  name?: string | undefined;
  parentId?: number | undefined;
  isActive?: boolean | undefined;
}

export class CostCenterService {
  static async list(db: TenantScopedDatabase, tenantId: number): Promise<CostCenter[]> {
    return db.raw.select().from(costCenters).where(eq(costCenters.tenantId, tenantId));
  }

  static async getById(
    db: TenantScopedDatabase,
    tenantId: number,
    id: number
  ): Promise<CostCenter> {
    const [row] = await db.raw
      .select()
      .from(costCenters)
      .where(and(eq(costCenters.id, id), eq(costCenters.tenantId, tenantId)));
    if (!row) throw new NotFoundError('CostCenter', id);
    return row;
  }

  static async create(
    db: TenantScopedDatabase,
    tenantId: number,
    userId: number,
    input: CostCenterInput
  ): Promise<CostCenter> {
    if (input.parentId) {
      await CostCenterService.getById(db, tenantId, input.parentId);
    }
    const [existing] = await db.raw
      .select({ id: costCenters.id })
      .from(costCenters)
      .where(and(eq(costCenters.tenantId, tenantId), eq(costCenters.code, input.code)));
    if (existing) {
      throw new BusinessError(
        'COST_CENTER_CODE_DUPLICATE',
        `Cost center code ${input.code} already exists`
      );
    }

    const [row] = await db.raw
      .insert(costCenters)
      .values({
        tenantId,
        code: input.code,
        name: input.name,
        ...(input.parentId !== undefined ? { parentId: input.parentId } : {}),
        createdBy: userId,
      } as typeof costCenters.$inferInsert)
      .returning();
    if (!row) throw new Error('Cost center insert failed unexpectedly');
    return row;
  }

  static async update(
    db: TenantScopedDatabase,
    tenantId: number,
    id: number,
    input: CostCenterUpdateInput
  ): Promise<CostCenter> {
    await CostCenterService.getById(db, tenantId, id);
    if (input.parentId !== undefined) {
      if (input.parentId === id) {
        throw new BusinessError(
          'COST_CENTER_INVALID_PARENT',
          'A cost center cannot be its own parent'
        );
      }
      await CostCenterService.getById(db, tenantId, input.parentId);
    }

    const [row] = await db.raw
      .update(costCenters)
      .set({ ...input, updatedAt: new Date() } as Partial<typeof costCenters.$inferInsert>)
      .where(and(eq(costCenters.id, id), eq(costCenters.tenantId, tenantId)))
      .returning();
    if (!row) throw new NotFoundError('CostCenter', id);
    return row;
  }

  // Soft-delete via isActive, matching the accounts table's convention.
  static async softDelete(db: TenantScopedDatabase, tenantId: number, id: number): Promise<void> {
    await CostCenterService.getById(db, tenantId, id);
    await db.raw
      .update(costCenters)
      .set({ isActive: false, updatedAt: new Date() })
      .where(and(eq(costCenters.id, id), eq(costCenters.tenantId, tenantId)));
  }
}
