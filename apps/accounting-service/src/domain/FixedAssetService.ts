import { eq, and } from 'drizzle-orm';
import { fixedAssets, assetDepreciationSchedule } from '@erp/db';
import type { TenantScopedDatabase } from '@erp/sdk';
import { BusinessError, NotFoundError } from '@erp/types';
import { createLogger } from '@erp/logger';
import { JournalEngine } from './JournalEngine.js';

const logger = createLogger({ serviceName: 'accounting-service' });

type DepreciationMethod = 'SLM' | 'WDV';

export interface CreateFixedAssetInput {
  assetCode: string;
  assetName: string;
  assetCategory: string;
  purchaseDate: string;
  purchaseCost: number;
  salvageValue: number;
  usefulLifeMonths: number;
  depreciationMethod: DepreciationMethod;
  wdvRate?: number;
  assetAccountId: number;
  depreciationExpenseAccountId: number;
  accumulatedDepreciationAccountId: number;
  notes?: string;
}

export class FixedAssetService {
  static async create(
    db: TenantScopedDatabase,
    tenantId: number,
    userId: number,
    input: CreateFixedAssetInput
  ): Promise<typeof fixedAssets.$inferSelect> {
    const [created] = await db.raw
      .insert(fixedAssets)
      .values({
        tenantId,
        assetCode: input.assetCode,
        name: input.assetName,
        category: input.assetCategory,
        purchaseDate: input.purchaseDate,
        purchaseCost: String(input.purchaseCost),
        salvageValue: String(input.salvageValue),
        currentValue: String(input.purchaseCost),
        usefulLifeMonths: input.usefulLifeMonths,
        depreciationMethod: input.depreciationMethod,
        wdvRate: input.wdvRate != null ? String(input.wdvRate) : null,
        accountId: input.assetAccountId,
        depreciationExpenseAccountId: input.depreciationExpenseAccountId,
        accumulatedDepreciationAccountId: input.accumulatedDepreciationAccountId,
        notes: input.notes,
        status: 'ACTIVE',
        createdBy: userId,
      } as typeof fixedAssets.$inferInsert)
      .returning();
    if (!created) throw new Error('Fixed asset insert failed');
    return created;
  }

  static async getById(
    db: TenantScopedDatabase,
    tenantId: number,
    id: number
  ): Promise<typeof fixedAssets.$inferSelect> {
    const [asset] = await db.raw
      .select()
      .from(fixedAssets)
      .where(and(eq(fixedAssets.id, id), eq(fixedAssets.tenantId, tenantId)));
    if (!asset) throw new NotFoundError('FixedAsset', id);
    return asset;
  }

  static async list(
    db: TenantScopedDatabase,
    tenantId: number
  ): Promise<typeof fixedAssets.$inferSelect[]> {
    return db.raw.select().from(fixedAssets).where(eq(fixedAssets.tenantId, tenantId));
  }

  static async update(
    db: TenantScopedDatabase,
    tenantId: number,
    id: number,
    data: { assetName?: string; notes?: string }
  ): Promise<typeof fixedAssets.$inferSelect> {
    const [updated] = await db.raw
      .update(fixedAssets)
      .set({
        ...(data.assetName !== undefined ? { name: data.assetName } : {}),
        ...(data.notes !== undefined ? { notes: data.notes } : {}),
        updatedAt: new Date(),
      })
      .where(and(eq(fixedAssets.id, id), eq(fixedAssets.tenantId, tenantId)))
      .returning();
    if (!updated) throw new NotFoundError('FixedAsset', id);
    return updated;
  }

  static async getDepreciationSchedule(
    db: TenantScopedDatabase,
    tenantId: number,
    assetId: number
  ): Promise<typeof assetDepreciationSchedule.$inferSelect[]> {
    return db.raw
      .select()
      .from(assetDepreciationSchedule)
      .where(and(
        eq(assetDepreciationSchedule.tenantId, tenantId),
        eq(assetDepreciationSchedule.assetId, assetId)
      ));
  }

  static computeMonthlyDepreciation(asset: typeof fixedAssets.$inferSelect): number {
    const purchaseCost = Number(asset.purchaseCost);
    const salvageValue = Number(asset.salvageValue);
    const currentValue = Number(asset.currentValue);
    const status = asset.status as string;

    if (status !== 'ACTIVE') return 0;
    if (currentValue <= salvageValue) return 0;

    if (asset.depreciationMethod === 'SLM') {
      const monthlyDep = (purchaseCost - salvageValue) / asset.usefulLifeMonths;
      const remaining = currentValue - salvageValue;
      return Math.min(monthlyDep, remaining);
    }

    const annualRate = Number(asset.wdvRate ?? 0);
    if (annualRate <= 0) return 0;
    const monthlyDep = currentValue * (annualRate / 12 / 100);
    const remaining = currentValue - salvageValue;
    return Math.min(monthlyDep, remaining);
  }

  static async postMonthlyDepreciation(
    db: TenantScopedDatabase,
    tenantId: number,
    userId: number,
    assetId: number,
    periodMonth: number,
    periodYear: number
  ): Promise<{ journalId: string; depreciationAmount: number } | null> {
    const asset = await FixedAssetService.getById(db, tenantId, assetId);

    const [existing] = await db.raw
      .select()
      .from(assetDepreciationSchedule)
      .where(and(
        eq(assetDepreciationSchedule.tenantId, tenantId),
        eq(assetDepreciationSchedule.assetId, assetId),
        eq(assetDepreciationSchedule.periodMonth, periodMonth),
        eq(assetDepreciationSchedule.periodYear, periodYear)
      ));
    if (existing) {
      logger.warn({ assetId, periodMonth, periodYear }, 'Depreciation already posted for this period');
      return null;
    }

    const depreciationAmount = FixedAssetService.computeMonthlyDepreciation(asset);
    if (depreciationAmount <= 0.005) {
      logger.info({ assetId }, 'No depreciation to post (fully depreciated or disposed)');
      return null;
    }

    if (!asset.depreciationExpenseAccountId || !asset.accumulatedDepreciationAccountId) {
      throw new BusinessError('MISSING_DEP_ACCOUNTS', `Asset ${assetId} is missing depreciation account configuration`);
    }

    return db.transaction(async (trx) => {
      const newValue = Number(asset.currentValue) - depreciationAmount;

      const { journalId } = await JournalEngine.post(trx, tenantId, userId, {
        description: `Depreciation — ${asset.name} for ${periodYear}-${String(periodMonth).padStart(2, '0')}`,
        referenceType: 'FIXED_ASSET',
        referenceId: assetId,
        lines: [
          {
            accountId: asset.depreciationExpenseAccountId as number,
            debitAmount: depreciationAmount,
            creditAmount: 0,
            description: `Depreciation expense — ${asset.assetCode}`,
          },
          {
            accountId: asset.accumulatedDepreciationAccountId as number,
            debitAmount: 0,
            creditAmount: depreciationAmount,
            description: `Accumulated depreciation — ${asset.assetCode}`,
          },
        ],
      });

      await trx.raw.insert(assetDepreciationSchedule).values({
        tenantId,
        assetId,
        periodMonth,
        periodYear,
        openingValue: String(asset.currentValue),
        depreciationAmount: String(depreciationAmount),
        closingValue: String(newValue),
        journalId,
        postedAt: new Date(),
      } as typeof assetDepreciationSchedule.$inferInsert);

      await trx.raw
        .update(fixedAssets)
        .set({ currentValue: String(newValue), updatedAt: new Date() })
        .where(and(eq(fixedAssets.id, assetId), eq(fixedAssets.tenantId, tenantId)));

      return { journalId, depreciationAmount };
    });
  }

  static async runMonthlyDepreciationBatch(
    db: TenantScopedDatabase,
    tenantId: number,
    userId: number,
    periodMonth: number,
    periodYear: number
  ): Promise<{ processed: number; errors: number }> {
    const assets = await db.raw
      .select()
      .from(fixedAssets)
      .where(and(eq(fixedAssets.tenantId, tenantId), eq(fixedAssets.status, 'ACTIVE')));

    let processed = 0;
    let errors = 0;

    for (const asset of assets) {
      try {
        const result = await FixedAssetService.postMonthlyDepreciation(
          db, tenantId, userId, asset.id, periodMonth, periodYear
        );
        if (result) processed++;
      } catch (err) {
        errors++;
        logger.error({ err, assetId: asset.id, periodMonth, periodYear }, 'Failed to post depreciation for asset');
      }
    }

    logger.info({ processed, errors, periodMonth, periodYear }, 'Monthly depreciation batch complete');
    return { processed, errors };
  }

  static async dispose(
    db: TenantScopedDatabase,
    tenantId: number,
    userId: number,
    assetId: number,
    disposalDateStr: string,
    disposalProceeds: number,
    gainLossAccountId: number
  ): Promise<{ journalId: string; gainOrLoss: number }> {
    const asset = await FixedAssetService.getById(db, tenantId, assetId);
    if ((asset.status as string) !== 'ACTIVE') {
      throw new BusinessError('ASSET_NOT_ACTIVE', 'Only ACTIVE assets can be disposed');
    }

    const currentValue = Number(asset.currentValue);
    const gainOrLoss = disposalProceeds - currentValue;
    const totalDepreciation = Number(asset.purchaseCost) - currentValue;

    if (!asset.accountId || !asset.accumulatedDepreciationAccountId) {
      throw new BusinessError('MISSING_ACCOUNTS', `Asset ${assetId} missing account configuration`);
    }

    return db.transaction(async (trx) => {
      const lines: Array<{ accountId: number; debitAmount: number; creditAmount: number; description: string }> = [];

      lines.push({
        accountId: asset.accountId,
        debitAmount: 0,
        creditAmount: Number(asset.purchaseCost),
        description: `Disposal — asset cost ${asset.assetCode}`,
      });

      if (totalDepreciation > 0.01) {
        lines.push({
          accountId: asset.accumulatedDepreciationAccountId as number,
          debitAmount: totalDepreciation,
          creditAmount: 0,
          description: `Clear accumulated depreciation — ${asset.assetCode}`,
        });
      }

      if (disposalProceeds > 0.01) {
        lines.push({
          accountId: gainLossAccountId,
          debitAmount: disposalProceeds,
          creditAmount: 0,
          description: `Disposal proceeds — ${asset.assetCode}`,
        });
      }

      if (Math.abs(gainOrLoss) > 0.01) {
        lines.push({
          accountId: gainLossAccountId,
          debitAmount: gainOrLoss < 0 ? Math.abs(gainOrLoss) : 0,
          creditAmount: gainOrLoss > 0 ? gainOrLoss : 0,
          description: `${gainOrLoss >= 0 ? 'Gain' : 'Loss'} on disposal — ${asset.assetCode}`,
        });
      }

      const { journalId } = await JournalEngine.post(trx, tenantId, userId, {
        description: `Disposal of ${asset.name} on ${disposalDateStr}`,
        referenceType: 'FIXED_ASSET',
        referenceId: assetId,
        lines,
      });

      await trx.raw
        .update(fixedAssets)
        .set({
          status: 'DISPOSED',
          disposalDate: disposalDateStr,
          currentValue: '0',
          updatedAt: new Date(),
        })
        .where(and(eq(fixedAssets.id, assetId), eq(fixedAssets.tenantId, tenantId)));

      return { journalId, gainOrLoss };
    });
  }
}
