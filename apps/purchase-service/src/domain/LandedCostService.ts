import { and, eq, sql } from 'drizzle-orm';
import { landedCosts, grnLines, grns } from '@erp/db';
import type { ErpDatabase } from '@erp/db';
import { BusinessError, NotFoundError } from '@erp/types';

export interface AddLandedCostParams {
  tenantId: number;
  grnId: number;
  costType: 'CUSTOMS_DUTY' | 'FREIGHT' | 'INSURANCE' | 'HANDLING' | 'OTHER';
  description?: string | undefined;
  amount: number;
  allocationMethod: 'BY_VALUE' | 'BY_QUANTITY' | 'BY_WEIGHT';
  createdBy: number;
}

export class LandedCostService {
  constructor(private db: ErpDatabase) {}

  async addCost(params: AddLandedCostParams): Promise<number> {
    const [grn] = await this.db
      .select()
      .from(grns)
      .where(and(eq(grns.id, params.grnId), eq(grns.tenantId, params.tenantId)));
    if (!grn) throw new NotFoundError('GRN', params.grnId);

    const [row] = await this.db
      .insert(landedCosts)
      .values({
        tenantId: params.tenantId,
        grnId: params.grnId,
        costType: params.costType,
        description: params.description,
        amount: String(params.amount),
        allocationMethod: params.allocationMethod,
        isAllocated: false,
        createdBy: params.createdBy,
      })
      .returning({ id: landedCosts.id });

    if (!row) throw new BusinessError('LANDED_COST_CREATE_FAILED', 'Failed to add landed cost');
    return row.id;
  }

  async allocate(grnId: number, tenantId: number): Promise<void> {
    const [grn] = await this.db
      .select()
      .from(grns)
      .where(and(eq(grns.id, grnId), eq(grns.tenantId, tenantId)));
    if (!grn) throw new NotFoundError('GRN', grnId);

    const costs = await this.db
      .select()
      .from(landedCosts)
      .where(and(eq(landedCosts.grnId, grnId), eq(landedCosts.tenantId, tenantId)));

    if (costs.length === 0) return;

    const lines = await this.db.select().from(grnLines).where(eq(grnLines.grnId, grnId));
    if (lines.length === 0) return;

    await this.db.transaction(async (trx) => {
      for (const cost of costs) {
        const totalAmount = parseFloat(String(cost.amount));
        let totalBase = 0;

        // Compute allocation base
        if (cost.allocationMethod === 'BY_VALUE') {
          totalBase = lines.reduce((s, l) => s + parseFloat(String(l.lineTotal)), 0);
        } else if (cost.allocationMethod === 'BY_QUANTITY') {
          totalBase = lines.reduce((s, l) => s + parseFloat(String(l.receivedQty)), 0);
        } else {
          // BY_WEIGHT — fallback to BY_QUANTITY when weight not tracked
          totalBase = lines.reduce((s, l) => s + parseFloat(String(l.receivedQty)), 0);
        }

        if (totalBase === 0) continue;

        // Distribute cost to each line
        for (const line of lines) {
          let lineBase = 0;
          if (cost.allocationMethod === 'BY_VALUE') {
            lineBase = parseFloat(String(line.lineTotal));
          } else {
            lineBase = parseFloat(String(line.receivedQty));
          }

          const lineAllocation = Math.round((totalAmount * lineBase / totalBase) * 100) / 100;
          const receivedQty = parseFloat(String(line.receivedQty));
          const existingLanded = parseFloat(String(line.allocatedLandedCost ?? 0));
          const grnRate = parseFloat(String(line.grnRate));

          const newAllocatedLanded = existingLanded + lineAllocation;
          const newEffectiveUnitCost = receivedQty > 0
            ? Math.round(((grnRate * receivedQty + newAllocatedLanded) / receivedQty) * 10000) / 10000
            : grnRate;

          await trx
            .update(grnLines)
            .set({
              allocatedLandedCost: String(newAllocatedLanded),
              effectiveUnitCost: String(newEffectiveUnitCost),
            })
            .where(eq(grnLines.id, line.id));
        }

        await trx
          .update(landedCosts)
          .set({ isAllocated: true })
          .where(eq(landedCosts.id, cost.id));
      }

      // Update GRN landed cost total and effective cost total
      const totalLandedCost = costs.reduce((s, c) => s + parseFloat(String(c.amount)), 0);
      const grnTotal = parseFloat(String(grn.grandTotal));
      await trx
        .update(grns)
        .set({
          landedCostTotal: sql`${grns.landedCostTotal} + ${totalLandedCost}`,
          effectiveCostTotal: String(grnTotal + totalLandedCost),
          updatedAt: new Date(),
        })
        .where(and(eq(grns.id, grnId), eq(grns.tenantId, tenantId)));
    });
  }

  async getForGrn(grnId: number, tenantId: number) {
    return this.db
      .select()
      .from(landedCosts)
      .where(and(eq(landedCosts.grnId, grnId), eq(landedCosts.tenantId, tenantId)));
  }
}
