import { and, eq, desc } from 'drizzle-orm';
import { barcodeBatches, barcodes, items, itemVariants } from '@erp/db';
import type { ErpDatabase } from '@erp/db';
import { BusinessError, NotFoundError } from '@erp/types';
import type { TenantScopedCache } from '@erp/sdk';

const BARCODE_CACHE_TTL_SECONDS = 300; // 5 minutes

export interface GenerateBarcodesParams {
  tenantId: number;
  itemId: number;
  variantId?: number | undefined;
  quantity: number;
  format: 'EAN13' | 'CODE128' | 'QR';
  printFormat: 'A4_SHEET' | 'LABEL_40x25' | 'LABEL_60x40' | 'LABEL_50x25' | 'LABEL_100x50';
  createdBy: number;
  baseUrl: string;
}

export function generateBarcodeValue(format: 'EAN13' | 'CODE128' | 'QR', itemId: number, seq: number): string {
  const pad = (n: number, len: number): string => String(n).padStart(len, '0');
  if (format === 'EAN13') {
    const raw = `${pad(itemId, 6)}${pad(seq, 5)}`;
    const checkDigit = computeEan13Check(raw);
    return `${raw}${checkDigit}`;
  }
  if (format === 'CODE128') {
    return `ERP-${pad(itemId, 6)}-${pad(seq, 5)}`;
  }
  return `QR-${pad(itemId, 6)}-${pad(seq, 5)}-${Date.now()}`;
}

export function computeEan13Check(digits11: string): number {
  let sum = 0;
  for (let i = 0; i < 11; i++) {
    const d = parseInt(digits11[i] ?? '0', 10);
    sum += i % 2 === 0 ? d : d * 3;
  }
  return (10 - (sum % 10)) % 10;
}

export class BarcodeService {
  constructor(
    private db: ErpDatabase,
    private cache: TenantScopedCache
  ) {}

  async generate(params: GenerateBarcodesParams): Promise<{ batchId: number; barcodeIds: number[]; printUrl: string }> {
    return this.db.transaction(async (trx) => {
      const [item] = await trx
        .select({ id: items.id, name: items.name, mrp: items.mrp })
        .from(items)
        .where(and(eq(items.id, params.itemId), eq(items.tenantId, params.tenantId)));
      if (!item) throw new NotFoundError('Item', params.itemId);

      // Create batch
      const [batch] = await trx
        .insert(barcodeBatches)
        .values({
          tenantId: params.tenantId,
          itemId: params.itemId,
          variantId: params.variantId,
          quantity: params.quantity,
          format: params.format,
          printFormat: params.printFormat,
          createdBy: params.createdBy,
        })
        .returning({ id: barcodeBatches.id });

      if (!batch) throw new BusinessError('BARCODE_BATCH_FAILED', 'Failed to create barcode batch');
      const batchId = batch.id;

      // Generate individual barcode records
      const barcodeValues: Array<{
        tenantId: number;
        batchId: number;
        itemId: number;
        variantId: number | undefined;
        barcodeValue: string;
        format: 'EAN13' | 'CODE128' | 'QR';
      }> = [];

      for (let i = 1; i <= params.quantity; i++) {
        const value = generateBarcodeValue(params.format, params.itemId, batchId * 1000 + i);
        barcodeValues.push({
          tenantId: params.tenantId,
          batchId,
          itemId: params.itemId,
          variantId: params.variantId,
          barcodeValue: value,
          format: params.format,
        });
      }

      const inserted = await trx.insert(barcodes).values(barcodeValues).returning({ id: barcodes.id });
      const barcodeIds = inserted.map((r) => r.id);

      const printUrl = `${params.baseUrl}/api/v2/barcodes/print/${batchId}`;

      await trx
        .update(barcodeBatches)
        .set({ printUrl })
        .where(eq(barcodeBatches.id, batchId));

      return { batchId, barcodeIds, printUrl };
    });
  }

  async getPrintData(batchId: number, tenantId: number): Promise<unknown> {
    const [batch] = await this.db
      .select()
      .from(barcodeBatches)
      .where(and(eq(barcodeBatches.id, batchId), eq(barcodeBatches.tenantId, tenantId)));
    if (!batch) throw new NotFoundError('BarcodeBatch', batchId);

    const [item] = await this.db
      .select({ name: items.name, mrp: items.mrp, brandId: items.brandId })
      .from(items)
      .where(eq(items.id, batch.itemId));

    let variantLabel: string | undefined;
    if (batch.variantId) {
      const [variant] = await this.db
        .select({ attributeCombination: itemVariants.attributeCombination })
        .from(itemVariants)
        .where(eq(itemVariants.id, batch.variantId));
      if (variant) {
        variantLabel = Object.values(variant.attributeCombination ?? {}).join(' / ');
      }
    }

    const barcodeList = await this.db
      .select()
      .from(barcodes)
      .where(and(eq(barcodes.batchId, batchId), eq(barcodes.isActive, true)));

    return {
      batch,
      item: { name: item?.name ?? 'Unknown', mrp: item?.mrp ?? '0', variantLabel },
      barcodes: barcodeList.map((b) => ({ id: b.id, value: b.barcodeValue, format: b.format })),
    };
  }

  async deactivate(id: number, tenantId: number, userId: number): Promise<void> {
    const [bc] = await this.db
      .select()
      .from(barcodes)
      .where(and(eq(barcodes.id, id), eq(barcodes.tenantId, tenantId)));
    if (!bc) throw new NotFoundError('Barcode', id);

    await this.db
      .update(barcodes)
      .set({ isActive: false, deactivatedAt: new Date(), deactivatedBy: userId })
      .where(and(eq(barcodes.id, id), eq(barcodes.tenantId, tenantId)));

    // Invalidate cache
    await this.cache.del(`barcode:${bc.barcodeValue}`);
  }

  async lookupByValue(value: string, tenantId: number): Promise<unknown> {
    const cacheKey = `barcode:${value}`;

    const cached = await this.cache.getJson<unknown>(cacheKey);
    if (cached) {
      return cached;
    }

    // Query barcodes table first (for generated barcodes)
    const [bc] = await this.db
      .select()
      .from(barcodes)
      .where(and(eq(barcodes.barcodeValue, value), eq(barcodes.tenantId, tenantId), eq(barcodes.isActive, true)));

    if (bc) {
      const [item] = await this.db
        .select()
        .from(items)
        .where(eq(items.id, bc.itemId));

      if (item) {
        const result = { item, variantId: bc.variantId, source: 'barcode_table' };
        await this.cache.setJson(cacheKey, result, BARCODE_CACHE_TTL_SECONDS);
        return result;
      }
    }

    // Fall back to items.barcode field
    const [item] = await this.db
      .select()
      .from(items)
      .where(and(eq(items.barcode, value), eq(items.tenantId, tenantId)));

    if (!item) throw new NotFoundError('Item', `barcode:${value}`);

    const result = { item, variantId: null, source: 'item_barcode' };
    await this.cache.setJson(cacheKey, result, BARCODE_CACHE_TTL_SECONDS);
    return result;
  }

  async listBatches(tenantId: number, itemId?: number): Promise<unknown[]> {
    const conditions = [eq(barcodeBatches.tenantId, tenantId)];
    if (itemId) conditions.push(eq(barcodeBatches.itemId, itemId));

    return this.db
      .select()
      .from(barcodeBatches)
      .where(and(...conditions))
      .orderBy(desc(barcodeBatches.createdAt))
      .limit(50);
  }
}
