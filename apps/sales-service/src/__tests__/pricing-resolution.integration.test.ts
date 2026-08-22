// Distribution vertical, Phase B — real-Postgres proof that price-list resolution is
// server-authoritative: a matching tier always wins over whatever unitPrice the caller submits
// (confirmed decision: "resolved tier price should be authoritative and predictable"). Mirrors
// the describe.skipIf(!DB_URL) real-DB pattern established by inventory-service's
// fefo-consumption-flows.integration.test.ts.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createDatabaseClient, type ErpDatabase } from '@erp/db';
import { items, priceLists, priceListItems, customers, branches, invoiceLines } from '@erp/db';
import { eq, and } from 'drizzle-orm';
import { PricingResolutionService } from '../domain/PricingResolutionService.js';
import { InvoiceService } from '../domain/InvoiceService.js';

const DB_URL = process.env['DATABASE_URL'];

describe.skipIf(!DB_URL)('PricingResolutionService — real Postgres', () => {
  let db: ErpDatabase;
  const TENANT = 900_201 + Math.floor(Math.random() * 1000);
  let branchId: number;
  let priceListId: number;
  let itemNoTierId: number;
  let itemTieredId: number;

  beforeAll(async () => {
    db = createDatabaseClient({ url: DB_URL! });

    const [branch] = await db
      .insert(branches)
      .values({
        tenantId: TENANT,
        name: 'Test HO',
        code: 'HO',
        isHeadOffice: true,
        isActive: true,
        createdBy: 1,
      })
      .returning();
    branchId = branch!.id;

    const [list] = await db
      .insert(priceLists)
      .values({ tenantId: TENANT, name: 'Wholesale', code: `WS-${TENANT}`, createdBy: 1 })
      .returning();
    priceListId = list!.id;

    const baseItem = {
      tenantId: TENANT,
      unitId: 1,
      hsnCode: '1234',
      gstRate: '18.00',
      purchasePrice: '50.00',
      createdBy: 1,
    };
    const [noTier] = await db
      .insert(items)
      .values({ ...baseItem, name: 'No Tier Item', itemCode: `NT-${TENANT}`, salePrice: '100.00' })
      .returning();
    itemNoTierId = noTier!.id;

    const [tiered] = await db
      .insert(items)
      .values({ ...baseItem, name: 'Tiered Item', itemCode: `TR-${TENANT}`, salePrice: '100.00' })
      .returning();
    itemTieredId = tiered!.id;

    // Two tiers for the same item: minQty=0 -> 90, minQty=10 -> 80 (bulk discount).
    await db.insert(priceListItems).values([
      {
        tenantId: TENANT,
        priceListId,
        itemId: itemTieredId,
        salePrice: '90.00',
        minQty: '0',
        createdBy: 1,
      },
      {
        tenantId: TENANT,
        priceListId,
        itemId: itemTieredId,
        salePrice: '80.00',
        minQty: '10',
        createdBy: 1,
      },
    ]);
  });

  afterAll(async () => {
    await db.delete(priceListItems).where(eq(priceListItems.tenantId, TENANT));
    await db.delete(priceLists).where(eq(priceLists.tenantId, TENANT));
    await db.delete(invoiceLines).where(eq(invoiceLines.tenantId, TENANT));
    await db.delete(customers).where(eq(customers.tenantId, TENANT));
    await db.delete(items).where(eq(items.tenantId, TENANT));
    await db.delete(branches).where(eq(branches.tenantId, TENANT));
  });

  it('exact-tier match: overrides a client-submitted unitPrice with the matching tier price', async () => {
    const resolved = await PricingResolutionService.resolveLines(db, TENANT, priceListId, [
      { itemId: itemTieredId, quantity: 5, unitPrice: 999 },
    ]);
    expect(resolved[0]!.unitPrice).toBe(90);
  });

  it('multi-tier: picks the highest qualifying minQty tier, not just the first match', async () => {
    const resolved = await PricingResolutionService.resolveLines(db, TENANT, priceListId, [
      { itemId: itemTieredId, quantity: 15, unitPrice: 999 },
    ]);
    expect(resolved[0]!.unitPrice).toBe(80);
  });

  it('no price list assigned (priceListId null): keeps the caller-submitted unitPrice', async () => {
    const resolved = await PricingResolutionService.resolveLines(db, TENANT, null, [
      { itemId: itemTieredId, quantity: 5, unitPrice: 123 },
    ]);
    expect(resolved[0]!.unitPrice).toBe(123);
  });

  it('price list assigned but no matching price_list_items row: keeps the caller-submitted unitPrice', async () => {
    const resolved = await PricingResolutionService.resolveLines(db, TENANT, priceListId, [
      { itemId: itemNoTierId, quantity: 5, unitPrice: 111 },
    ]);
    expect(resolved[0]!.unitPrice).toBe(111);
  });

  it('no price-list match and no caller-submitted unitPrice: falls back to items.salePrice', async () => {
    const resolved = await PricingResolutionService.resolveLines(db, TENANT, priceListId, [
      { itemId: itemNoTierId, quantity: 5 },
    ]);
    expect(resolved[0]!.unitPrice).toBe(100);
  });

  it('InvoiceService.create() end-to-end: persisted line reflects the tier price, not the submitted one', async () => {
    const [customer] = await db
      .insert(customers)
      .values({
        tenantId: TENANT,
        branchId,
        displayName: 'Tiered Test Customer',
        phone: '9999999999',
        priceListId,
        createdBy: 1,
      } as never)
      .returning();

    const invoiceId = await new InvoiceService(db).create({
      tenantId: TENANT,
      branchId,
      warehouseId: 1,
      customerId: customer!.id,
      placeOfSupply: 'MH',
      sellerStateCode: 'MH',
      invoiceDate: new Date(),
      dueDate: new Date(),
      lines: [{ itemId: itemTieredId, quantity: 15, unitPrice: 999, gstRate: 18 }],
      createdBy: 1,
      overridePriceFloor: true,
    });

    const [line] = await db
      .select({ unitPrice: invoiceLines.unitPrice })
      .from(invoiceLines)
      .where(and(eq(invoiceLines.invoiceId, invoiceId), eq(invoiceLines.tenantId, TENANT)));

    expect(parseFloat(String(line!.unitPrice))).toBe(80);
  });
});
