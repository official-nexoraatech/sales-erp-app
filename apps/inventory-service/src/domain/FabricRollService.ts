import { eq, and, sql, asc } from 'drizzle-orm';
import { fabricRolls, fabricCuts } from '@erp/db';
import { ERPError } from '@erp/types';
import type { ErpDatabase } from '@erp/db';

export class FabricRollService {
  constructor(private readonly db: ErpDatabase) {}

  async receiveRoll(params: {
    tenantId: number;
    rollNumber: string;
    itemId: number;
    warehouseId: number;
    meters: number;
    width?: number;
    grnReference?: string;
    notes?: string;
    createdBy: number;
  }) {
    const [roll] = await this.db
      .insert(fabricRolls)
      .values({
        tenantId: params.tenantId,
        rollNumber: params.rollNumber,
        itemId: params.itemId,
        warehouseId: params.warehouseId,
        originalMeters: String(params.meters),
        remainingMeters: String(params.meters),
        width: params.width ? String(params.width) : undefined,
        grnReference: params.grnReference,
        status: 'AVAILABLE',
        notes: params.notes,
        createdBy: params.createdBy,
      })
      .returning();
    return roll!;
  }

  async cut(params: {
    tenantId: number;
    rollId: number;
    meters: number;
    purpose?: string;
    referenceType?: string;
    referenceId?: number;
    notes?: string;
    createdBy: number;
  }) {
    return this.db.transaction(async (trx) => {
      const db = trx as unknown as ErpDatabase;

      const [roll] = await db
        .select()
        .from(fabricRolls)
        .where(
          and(eq(fabricRolls.id, params.rollId), eq(fabricRolls.tenantId, params.tenantId))
        );

      if (!roll) throw new ERPError('ROLL_NOT_FOUND', 'Fabric roll not found', 404);
      if (roll.status === 'FULLY_CUT' || roll.status === 'DAMAGED') {
        throw new ERPError('ROLL_NOT_AVAILABLE', `Roll is ${roll.status}`, 409);
      }

      const remaining = parseFloat(roll.remainingMeters);
      if (params.meters > remaining) {
        throw new ERPError(
          'INSUFFICIENT_METERS',
          `Cannot cut ${params.meters}m — only ${remaining}m remaining`,
          409
        );
      }

      const afterCut = remaining - params.meters;
      const newStatus = afterCut === 0 ? 'FULLY_CUT' : 'PARTIALLY_CUT';

      const [cut] = await db
        .insert(fabricCuts)
        .values({
          tenantId: params.tenantId,
          rollId: params.rollId,
          meters: String(params.meters),
          metersBeforeCut: String(remaining),
          metersAfterCut: String(afterCut),
          purpose: params.purpose,
          referenceType: params.referenceType,
          referenceId: params.referenceId,
          notes: params.notes,
          createdBy: params.createdBy,
        })
        .returning();

      await db
        .update(fabricRolls)
        .set({
          remainingMeters: String(afterCut),
          status: newStatus,
          version: sql`${fabricRolls.version} + 1`,
          updatedAt: new Date(),
        })
        .where(eq(fabricRolls.id, params.rollId));

      return { cut: cut!, remainingMeters: afterCut };
    });
  }

  // Returns available rolls for an item sorted FIFO by receivedAt
  async getAvailableRolls(itemId: number, tenantId: number) {
    return this.db
      .select()
      .from(fabricRolls)
      .where(
        and(
          eq(fabricRolls.itemId, itemId),
          eq(fabricRolls.tenantId, tenantId),
          sql`${fabricRolls.status} IN ('AVAILABLE', 'PARTIALLY_CUT')`
        )
      )
      .orderBy(asc(fabricRolls.receivedAt));
  }

  async getCutHistory(rollId: number, tenantId: number) {
    const [roll] = await this.db
      .select()
      .from(fabricRolls)
      .where(and(eq(fabricRolls.id, rollId), eq(fabricRolls.tenantId, tenantId)));

    if (!roll) throw new ERPError('ROLL_NOT_FOUND', 'Fabric roll not found', 404);

    const cuts = await this.db
      .select()
      .from(fabricCuts)
      .where(eq(fabricCuts.rollId, rollId));

    return { roll, cuts };
  }
}
