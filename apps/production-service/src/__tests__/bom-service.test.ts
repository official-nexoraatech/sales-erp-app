// Manufacturing vertical, Phase A — BOMService tests against a real Postgres DB, mirroring
// job-work-order-valuation.integration.test.ts's own real-DB/tenant/item-provisioning pattern
// (this session's established, more-robust alternative to mocking the DB layer for domain logic).
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createDatabaseClient } from '@erp/db';
import { items, boms, bomLines } from '@erp/db';
import { eq } from 'drizzle-orm';
import { BusinessError, NotFoundError } from '@erp/types';
import { BOMService } from '../domain/BOMService.js';

const DB_URL = process.env['DATABASE_URL'];

describe.skipIf(!DB_URL)('BOMService — real Postgres', () => {
  let db: ReturnType<typeof createDatabaseClient>;
  const TEST_TENANT = 904_001 + Math.floor(Math.random() * 1000);
  let finishedItemId: number;
  let componentItemId: number;
  let otherComponentItemId: number;
  let subAssemblyItemId: number;

  beforeAll(async () => {
    db = createDatabaseClient({ url: DB_URL! });

    const [finished] = await db
      .insert(items)
      .values({
        tenantId: TEST_TENANT,
        name: 'Finished Widget',
        itemCode: `FW-${Date.now()}`,
        salePrice: '500.00',
        purchasePrice: '0',
        gstRate: '18.00',
        unitId: 1,
        hsnCode: '8501',
        availableQty: '0',
        createdBy: 1,
      })
      .returning();
    finishedItemId = finished!.id;

    const [component] = await db
      .insert(items)
      .values({
        tenantId: TEST_TENANT,
        name: 'Steel Bracket',
        itemCode: `SB-${Date.now()}`,
        salePrice: '0',
        purchasePrice: '10.00',
        gstRate: '18.00',
        unitId: 1,
        hsnCode: '7326',
        availableQty: '0',
        createdBy: 1,
      })
      .returning();
    componentItemId = component!.id;

    const [otherComponent] = await db
      .insert(items)
      .values({
        tenantId: TEST_TENANT,
        name: 'Rubber Gasket',
        itemCode: `RG-${Date.now()}`,
        salePrice: '0',
        purchasePrice: '2.50',
        gstRate: '18.00',
        unitId: 1,
        hsnCode: '4016',
        availableQty: '0',
        createdBy: 1,
      })
      .returning();
    otherComponentItemId = otherComponent!.id;

    const [subAssembly] = await db
      .insert(items)
      .values({
        tenantId: TEST_TENANT,
        name: 'Handle Sub-Assembly',
        itemCode: `HSA-${Date.now()}`,
        salePrice: '0',
        purchasePrice: '0',
        gstRate: '18.00',
        unitId: 1,
        hsnCode: '8302',
        availableQty: '0',
        createdBy: 1,
      })
      .returning();
    subAssemblyItemId = subAssembly!.id;
  });

  afterAll(async () => {
    await db.delete(bomLines).where(eq(bomLines.tenantId, TEST_TENANT));
    await db.delete(boms).where(eq(boms.tenantId, TEST_TENANT));
    await db.delete(items).where(eq(items.tenantId, TEST_TENANT));
  });

  it('create() rejects an empty line list', async () => {
    const svc = new BOMService(db);
    await expect(
      svc.create({
        tenantId: TEST_TENANT,
        name: 'Empty BOM',
        finishedItemId,
        lines: [],
        createdBy: 1,
      })
    ).rejects.toThrow(BusinessError);
  });

  it('create() rejects a finishedItemId that does not belong to this tenant', async () => {
    const svc = new BOMService(db);
    await expect(
      svc.create({
        tenantId: TEST_TENANT,
        name: 'Bad BOM',
        finishedItemId: 999_999_999,
        lines: [{ componentItemId, quantityPerOutput: 1 }],
        createdBy: 1,
      })
    ).rejects.toThrow(NotFoundError);
  });

  it('create() persists the BOM and its lines, retrievable via getById()', async () => {
    const svc = new BOMService(db);
    const bomId = await svc.create({
      tenantId: TEST_TENANT,
      name: 'Widget BOM v1',
      finishedItemId,
      outputQty: 1,
      lines: [
        { componentItemId, quantityPerOutput: 2, scrapPercent: 5 },
        { componentItemId: otherComponentItemId, quantityPerOutput: 4 },
      ],
      createdBy: 1,
    });

    const result = await svc.getById(bomId, TEST_TENANT);
    expect(result).not.toBeNull();
    expect(result!.bom.isActive).toBe(true);
    expect(result!.lines).toHaveLength(2);
  });

  it('create() deactivates the previous active BOM for the same finished item (only one active at a time)', async () => {
    const svc = new BOMService(db);
    const firstBomId = await svc.create({
      tenantId: TEST_TENANT,
      name: 'Guard Test BOM v1',
      finishedItemId,
      lines: [{ componentItemId, quantityPerOutput: 1 }],
      createdBy: 1,
    });

    const secondBomId = await svc.create({
      tenantId: TEST_TENANT,
      name: 'Guard Test BOM v2',
      finishedItemId,
      lines: [{ componentItemId, quantityPerOutput: 2 }],
      createdBy: 1,
    });

    const first = await svc.getById(firstBomId, TEST_TENANT);
    const second = await svc.getById(secondBomId, TEST_TENANT);
    expect(first!.bom.isActive).toBe(false);
    expect(second!.bom.isActive).toBe(true);
  });

  it('explode() scales required quantities by outputQty and applies scrapPercent', async () => {
    const svc = new BOMService(db);
    const bomId = await svc.create({
      tenantId: TEST_TENANT,
      name: 'Explode Test BOM',
      finishedItemId,
      outputQty: 2, // this recipe yields 2 finished units
      lines: [
        { componentItemId, quantityPerOutput: 4, scrapPercent: 10 },
        { componentItemId: otherComponentItemId, quantityPerOutput: 1 },
      ],
      createdBy: 1,
    });

    // Ordering 10 finished units → scale factor 10/2 = 5.
    // Line 1: 4 * 5 * 1.10 = 22. Line 2: 1 * 5 * 1.0 = 5.
    const exploded = await svc.explode(bomId, TEST_TENANT, 10);
    const byItem = new Map(exploded.map((l) => [l.componentItemId, l.requiredQty]));
    expect(byItem.get(componentItemId)).toBe(22);
    expect(byItem.get(otherComponentItemId)).toBe(5);
  });

  it('explode() rejects an inactive BOM', async () => {
    const svc = new BOMService(db);
    const firstBomId = await svc.create({
      tenantId: TEST_TENANT,
      name: 'Inactive Guard BOM v1',
      finishedItemId,
      lines: [{ componentItemId, quantityPerOutput: 1 }],
      createdBy: 1,
    });
    // Creating a second BOM for the same finished item deactivates the first.
    await svc.create({
      tenantId: TEST_TENANT,
      name: 'Inactive Guard BOM v2',
      finishedItemId,
      lines: [{ componentItemId, quantityPerOutput: 1 }],
      createdBy: 1,
    });

    await expect(svc.explode(firstBomId, TEST_TENANT, 1)).rejects.toThrow(BusinessError);
  });

  it('explode() rejects an unknown bomId', async () => {
    const svc = new BOMService(db);
    await expect(svc.explode(999_999_999, TEST_TENANT, 1)).rejects.toThrow(NotFoundError);
  });

  // ── Multi-level BOM (2026-08-22) ──────────────────────────────────────────
  describe('multi-level BOM', () => {
    let multiLevelTopBomId: number;

    it('explode() recursively resolves a sub-assembly component down to leaf raw materials, aggregating the same raw material reached via two different paths', async () => {
      const svc = new BOMService(db);
      // Sub-assembly: 1 Handle Sub-Assembly needs 3 Steel Brackets.
      await svc.create({
        tenantId: TEST_TENANT,
        name: 'Handle Sub-Assembly BOM',
        finishedItemId: subAssemblyItemId,
        outputQty: 1,
        lines: [{ componentItemId, quantityPerOutput: 3 }],
        createdBy: 1,
      });

      // Finished item: needs 2 sub-assemblies AND 1 Steel Bracket directly.
      multiLevelTopBomId = await svc.create({
        tenantId: TEST_TENANT,
        name: 'Multi-level Finished Widget BOM',
        finishedItemId,
        outputQty: 1,
        lines: [
          { componentItemId: subAssemblyItemId, quantityPerOutput: 2 },
          { componentItemId, quantityPerOutput: 1 },
        ],
        createdBy: 1,
      });

      // Ordering 5 finished units: sub-assembly need = 2*5=10 → 10*3=30 Steel Brackets via the
      // sub-assembly path, plus 1*5=5 Steel Brackets directly = 35 total. The sub-assembly item
      // itself must NOT appear in the flat result — only true leaves do.
      const exploded = await svc.explode(multiLevelTopBomId, TEST_TENANT, 5);
      const byItem = new Map(exploded.map((l) => [l.componentItemId, l.requiredQty]));
      expect(byItem.get(componentItemId)).toBe(35);
      expect(byItem.has(subAssemblyItemId)).toBe(false);
      expect(exploded).toHaveLength(1);
    });

    it('explodeTree() returns the nested structure with subBomId/children on the sub-assembly node and nothing on the leaf node', async () => {
      const svc = new BOMService(db);
      const tree = await svc.explodeTree(multiLevelTopBomId, TEST_TENANT, 5);
      const subAssemblyNode = tree.find((n) => n.componentItemId === subAssemblyItemId);
      const directLeafNode = tree.find((n) => n.componentItemId === componentItemId);

      expect(subAssemblyNode?.subBomId).toBeDefined();
      expect(subAssemblyNode?.requiredQty).toBe(10); // 2 * 5
      expect(subAssemblyNode?.children).toHaveLength(1);
      expect(subAssemblyNode?.children?.[0]).toMatchObject({ componentItemId, requiredQty: 30 }); // 3 * 10

      expect(directLeafNode?.subBomId).toBeUndefined();
      expect(directLeafNode?.children).toBeUndefined();
      expect(directLeafNode?.requiredQty).toBe(5); // 1 * 5
    });

    it("create() rejects a component that would transitively require the BOM's own finished item (cycle)", async () => {
      const svc = new BOMService(db);
      // subAssemblyItemId's active BOM (from the earlier test) already requires componentItemId
      // (Steel Bracket). Creating a BOM FOR componentItemId that uses subAssemblyItemId as a
      // component would close the cycle: Steel Bracket -> Handle Sub-Assembly -> Steel Bracket.
      await expect(
        svc.create({
          tenantId: TEST_TENANT,
          name: 'Cyclic BOM',
          finishedItemId: componentItemId,
          lines: [{ componentItemId: subAssemblyItemId, quantityPerOutput: 1 }],
          createdBy: 1,
        })
      ).rejects.toThrow(BusinessError);
    });

    it('create() still rejects a direct self-reference (item requiring itself)', async () => {
      const svc = new BOMService(db);
      await expect(
        svc.create({
          tenantId: TEST_TENANT,
          name: 'Self-Referencing BOM',
          finishedItemId: otherComponentItemId,
          lines: [{ componentItemId: otherComponentItemId, quantityPerOutput: 1 }],
          createdBy: 1,
        })
      ).rejects.toThrow(BusinessError);
    });
  });

  describe('delete()', () => {
    // Dedicated items, never referenced by any BOM in the describe blocks above — those blocks
    // cross-reference componentItemId/otherComponentItemId/subAssemblyItemId into each other
    // over the course of the file, so reusing them here risks colliding with an
    // already-established cycle from an earlier test.
    let deleteTestFinishedId: number;
    let deleteTestComponentId: number;

    beforeAll(async () => {
      const [finished] = await db
        .insert(items)
        .values({
          tenantId: TEST_TENANT,
          name: 'Delete-Test Finished Item',
          itemCode: `DTF-${Date.now()}`,
          salePrice: '100.00',
          purchasePrice: '0',
          gstRate: '18.00',
          unitId: 1,
          hsnCode: '8501',
          availableQty: '0',
          createdBy: 1,
        })
        .returning();
      deleteTestFinishedId = finished!.id;

      const [component] = await db
        .insert(items)
        .values({
          tenantId: TEST_TENANT,
          name: 'Delete-Test Component',
          itemCode: `DTC-${Date.now()}`,
          salePrice: '0',
          purchasePrice: '5.00',
          gstRate: '18.00',
          unitId: 1,
          hsnCode: '7326',
          availableQty: '0',
          createdBy: 1,
        })
        .returning();
      deleteTestComponentId = component!.id;
    });

    it('rejects deleting the currently active BOM', async () => {
      const svc = new BOMService(db);
      const id = await svc.create({
        tenantId: TEST_TENANT,
        name: 'Active BOM',
        finishedItemId: deleteTestFinishedId,
        lines: [{ componentItemId: deleteTestComponentId, quantityPerOutput: 1 }],
        createdBy: 1,
      });
      await expect(svc.delete(id, TEST_TENANT)).rejects.toThrow(BusinessError);
    });

    it('deletes a deactivated (non-active) BOM, and its lines, once a replacement supersedes it', async () => {
      const svc = new BOMService(db);
      const firstId = await svc.create({
        tenantId: TEST_TENANT,
        name: 'Guard Delete v1',
        finishedItemId: deleteTestFinishedId,
        lines: [{ componentItemId: deleteTestComponentId, quantityPerOutput: 1 }],
        createdBy: 1,
      });
      // A second create() for the same finished item deactivates firstId (BOMService.create()'s
      // own versioning behavior), making it eligible for deletion.
      await svc.create({
        tenantId: TEST_TENANT,
        name: 'Guard Delete v2',
        finishedItemId: deleteTestFinishedId,
        lines: [{ componentItemId: deleteTestComponentId, quantityPerOutput: 2 }],
        createdBy: 1,
      });

      await svc.delete(firstId, TEST_TENANT);

      expect(await svc.getById(firstId, TEST_TENANT)).toBeNull();
      const remainingLines = await db.select().from(bomLines).where(eq(bomLines.bomId, firstId));
      expect(remainingLines).toHaveLength(0);
    });

    it('rejects deleting a BOM that does not exist', async () => {
      const svc = new BOMService(db);
      await expect(svc.delete(999_999_999, TEST_TENANT)).rejects.toThrow(NotFoundError);
    });
  });
});
