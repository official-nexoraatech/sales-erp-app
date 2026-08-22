import { and, eq, inArray } from 'drizzle-orm';
import { items, priceListItems } from '@erp/db';
import type { ErpDatabase } from '@erp/db';

export interface PriceResolvableLine {
  itemId: number;
  quantity: number;
  unitPrice?: number;
}

// Distribution vertical, Phase B: server-authoritative price-list resolution. Whenever the
// customer has a price list and a matching tier exists for the item/quantity, that price wins —
// overriding whatever unitPrice the caller submitted (confirmed decision: "resolved tier price
// should be authoritative and predictable", the same principle already applied to
// discountPercent not stacking). Only when no price-list match exists does the caller-submitted
// unitPrice survive; if that's also absent, falls back to the item's own standard salePrice.
//
// Batch-fetches candidates for the whole line set rather than querying per line, mirroring
// PromotionEngine's existing fetch-all-then-match-in-memory shape in this same service.
export class PricingResolutionService {
  static async resolveLines<L extends PriceResolvableLine>(
    db: ErpDatabase,
    tenantId: number,
    priceListId: number | null,
    lines: L[]
  ): Promise<(L & { unitPrice: number })[]> {
    const itemIds = [...new Set(lines.map((l) => l.itemId))];
    if (itemIds.length === 0) return lines as (L & { unitPrice: number })[];

    const tiersByItem = new Map<number, { minQty: number; salePrice: number }[]>();
    if (priceListId) {
      const rows = await db
        .select({
          itemId: priceListItems.itemId,
          minQty: priceListItems.minQty,
          salePrice: priceListItems.salePrice,
        })
        .from(priceListItems)
        .where(
          and(
            eq(priceListItems.tenantId, tenantId),
            eq(priceListItems.priceListId, priceListId),
            inArray(priceListItems.itemId, itemIds)
          )
        );
      for (const row of rows) {
        const tiers = tiersByItem.get(row.itemId) ?? [];
        tiers.push({
          minQty: parseFloat(String(row.minQty ?? 0)),
          salePrice: parseFloat(String(row.salePrice)),
        });
        tiersByItem.set(row.itemId, tiers);
      }
    }

    // Only fetch items.salePrice for lines that might actually need the final fallback
    // (no price-list match AND no caller-submitted unitPrice) — resolved lazily below.
    let standardPriceByItem: Map<number, number> | undefined;
    const loadStandardPrices = async (): Promise<Map<number, number>> => {
      if (!standardPriceByItem) {
        const rows = await db
          .select({ id: items.id, salePrice: items.salePrice })
          .from(items)
          .where(and(eq(items.tenantId, tenantId), inArray(items.id, itemIds)));
        standardPriceByItem = new Map(
          rows.map((r) => [r.id, r.salePrice ? parseFloat(String(r.salePrice)) : 0])
        );
      }
      return standardPriceByItem;
    };

    const resolved: (L & { unitPrice: number })[] = [];
    for (const line of lines) {
      const tiers = tiersByItem.get(line.itemId);
      const matchingTier = tiers
        ?.filter((t) => t.minQty <= line.quantity)
        .sort((a, b) => b.minQty - a.minQty)[0];

      if (matchingTier) {
        resolved.push({ ...line, unitPrice: matchingTier.salePrice });
      } else if (line.unitPrice !== undefined) {
        resolved.push({ ...line, unitPrice: line.unitPrice });
      } else {
        const standardPrices = await loadStandardPrices();
        resolved.push({ ...line, unitPrice: standardPrices.get(line.itemId) ?? 0 });
      }
    }
    return resolved;
  }
}
