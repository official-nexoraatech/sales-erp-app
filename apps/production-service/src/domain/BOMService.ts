import { and, eq, isNull } from 'drizzle-orm';
import { boms, bomLines, items } from '@erp/db';
import type { ErpDatabase } from '@erp/db';
import { BusinessError, NotFoundError } from '@erp/types';

export interface BomLineInput {
  componentItemId: number;
  componentVariantId?: number | undefined;
  quantityPerOutput: number;
  scrapPercent?: number | undefined;
}

export interface CreateBomParams {
  tenantId: number;
  name: string;
  finishedItemId: number;
  finishedVariantId?: number | undefined;
  outputQty?: number | undefined;
  lines: BomLineInput[];
  createdBy: number;
}

export interface ExplodedLine {
  componentItemId: number;
  componentVariantId?: number | undefined;
  requiredQty: number;
}

export interface BomTreeNode {
  componentItemId: number;
  componentVariantId?: number | undefined;
  requiredQty: number;
  // Present only when this component is itself a sub-assembly (has its own active BOM) —
  // absent for a leaf/raw-material component, so a UI can tell "expandable" from "terminal"
  // without a second lookup.
  subBomId?: number;
  children?: BomTreeNode[];
}

// Manufacturing vertical: a BOM's component lines always reference a real `items` row, but as of
// the multi-level extension (2026-08-22) that item MAY itself have its own active BOM, making it
// a sub-assembly rather than a raw/purchasable material — this is the standard "indented BOM"
// pattern, and required no schema change since bom_lines.componentItemId was always just an item
// reference. explode() now recurses through sub-assemblies down to leaf (no-further-BOM)
// components; explodeTree() returns the nested structure for display. Cycle prevention happens
// at create() time (a component can't transitively require the BOM's own finished item), with a
// depth guard in explode()/explodeTree() as defense-in-depth.
const MAX_BOM_DEPTH = 20;

export class BOMService {
  constructor(private db: ErpDatabase) {}

  // Walks DOWN from `componentItemId`'s own active BOM (if any) looking for `finishedItemId`
  // among its transitive components — used before adding a line to a BOM for `finishedItemId`,
  // to reject a line that would close a cycle (X uses Y, Y (transitively) uses X).
  private async wouldCreateCycle(
    tenantId: number,
    finishedItemId: number,
    componentItemId: number,
    depth = 0
  ): Promise<boolean> {
    if (componentItemId === finishedItemId) return true;
    if (depth >= MAX_BOM_DEPTH) {
      throw new BusinessError(
        'BOM_TOO_DEEP',
        `BOM nesting exceeds ${MAX_BOM_DEPTH} levels while validating — likely a pre-existing cycle`
      );
    }

    const [subBom] = await this.db
      .select({ id: boms.id })
      .from(boms)
      .where(
        and(
          eq(boms.tenantId, tenantId),
          eq(boms.finishedItemId, componentItemId),
          eq(boms.isActive, true)
        )
      );
    if (!subBom) return false;

    const subLines = await this.db
      .select({ componentItemId: bomLines.componentItemId })
      .from(bomLines)
      .where(eq(bomLines.bomId, subBom.id));

    for (const line of subLines) {
      if (await this.wouldCreateCycle(tenantId, finishedItemId, line.componentItemId, depth + 1)) {
        return true;
      }
    }
    return false;
  }

  async create(params: CreateBomParams): Promise<number> {
    if (params.lines.length === 0) {
      throw new BusinessError('BOM_EMPTY', 'A BOM must have at least one component line');
    }

    // Cycle check runs against the current active-BOM graph before opening the write
    // transaction below (it only reads) — a component that would transitively require this
    // BOM's own finished item is rejected outright.
    for (const line of params.lines) {
      if (
        await this.wouldCreateCycle(params.tenantId, params.finishedItemId, line.componentItemId)
      ) {
        throw new BusinessError(
          'BOM_CYCLE_DETECTED',
          `Component item ${line.componentItemId} transitively requires finished item ${params.finishedItemId} — this would create a circular BOM`
        );
      }
    }

    return this.db.transaction(async (trx) => {
      const [finishedItem] = await trx
        .select({ id: items.id })
        .from(items)
        .where(and(eq(items.id, params.finishedItemId), eq(items.tenantId, params.tenantId)));
      if (!finishedItem) throw new NotFoundError('Item', params.finishedItemId);

      // Only one active BOM per (tenant, finished item, variant) at a time — enforced here,
      // not a DB constraint, matching the isActive-flag convention already used elsewhere in
      // this codebase (e.g. branches, itemVariants) rather than a partial unique index.
      await trx
        .update(boms)
        .set({ isActive: false, updatedAt: new Date() })
        .where(
          and(
            eq(boms.tenantId, params.tenantId),
            eq(boms.finishedItemId, params.finishedItemId),
            params.finishedVariantId !== undefined
              ? eq(boms.finishedVariantId, params.finishedVariantId)
              : isNull(boms.finishedVariantId)
          )
        );

      const [row] = await trx
        .insert(boms)
        .values({
          tenantId: params.tenantId,
          name: params.name,
          finishedItemId: params.finishedItemId,
          finishedVariantId: params.finishedVariantId,
          outputQty: String(params.outputQty ?? 1),
          isActive: true,
          createdBy: params.createdBy,
        })
        .returning({ id: boms.id });

      if (!row) throw new BusinessError('BOM_CREATE_FAILED', 'Failed to create BOM');
      const bomId = row.id;

      await trx.insert(bomLines).values(
        params.lines.map((l) => ({
          bomId,
          tenantId: params.tenantId,
          componentItemId: l.componentItemId,
          componentVariantId: l.componentVariantId,
          quantityPerOutput: String(l.quantityPerOutput),
          scrapPercent: String(l.scrapPercent ?? 0),
        }))
      );

      return bomId;
    });
  }

  async getById(
    id: number,
    tenantId: number
  ): Promise<{ bom: typeof boms.$inferSelect; lines: (typeof bomLines.$inferSelect)[] } | null> {
    const [bom] = await this.db
      .select()
      .from(boms)
      .where(and(eq(boms.id, id), eq(boms.tenantId, tenantId)));
    if (!bom) return null;
    const lines = await this.db.select().from(bomLines).where(eq(bomLines.bomId, id));
    return { bom, lines };
  }

  async listForItem(itemId: number, tenantId: number): Promise<(typeof boms.$inferSelect)[]> {
    return this.db
      .select()
      .from(boms)
      .where(and(eq(boms.tenantId, tenantId), eq(boms.finishedItemId, itemId)));
  }

  // Hard delete, deliberately restricted to non-active BOMs — the active one is what live
  // explode()/MRP/order-material-population calls read, so deleting it out from under that
  // would silently break the next explosion for this finished item. bomId is never persisted
  // onto a production/job-work order row (it's only a transient create()-time param used to
  // call explode() once — see ProductionOrderService/JobWorkOrderService), so unlike Routing
  // there's no historical-reference check needed here.
  async delete(id: number, tenantId: number): Promise<void> {
    const [bom] = await this.db
      .select({ isActive: boms.isActive })
      .from(boms)
      .where(and(eq(boms.id, id), eq(boms.tenantId, tenantId)));
    if (!bom) throw new NotFoundError('Bom', id);
    if (bom.isActive) {
      throw new BusinessError(
        'BOM_ACTIVE',
        'Cannot delete the active BOM for a finished item — create a replacement first, which deactivates this one'
      );
    }

    await this.db.transaction(async (trx) => {
      await trx.delete(bomLines).where(eq(bomLines.bomId, id));
      await trx.delete(boms).where(and(eq(boms.id, id), eq(boms.tenantId, tenantId)));
    });
  }

  // requiredQty = quantityPerOutput * (outputQty / bom.outputQty) * (1 + scrapPercent / 100),
  // recursively descending into any component that is itself a sub-assembly (has its own active
  // BOM) until every returned line is a true leaf/raw-material requirement. The same raw item
  // reached via two different paths (used directly, and via a sub-assembly) is summed into one
  // line, matching standard MRP flat-explosion behavior. Single-level BOMs (no sub-assembly
  // components) behave byte-identically to before this change.
  async explode(bomId: number, tenantId: number, outputQty: number): Promise<ExplodedLine[]> {
    const leaves = new Map<string, ExplodedLine>();
    await this.explodeInto(bomId, tenantId, outputQty, leaves, 0);
    return Array.from(leaves.values());
  }

  private async explodeInto(
    bomId: number,
    tenantId: number,
    outputQty: number,
    leaves: Map<string, ExplodedLine>,
    depth: number
  ): Promise<void> {
    if (depth >= MAX_BOM_DEPTH) {
      throw new BusinessError(
        'BOM_TOO_DEEP',
        `BOM nesting exceeds ${MAX_BOM_DEPTH} levels while exploding bomId ${bomId}`
      );
    }

    const [bom] = await this.db
      .select()
      .from(boms)
      .where(and(eq(boms.id, bomId), eq(boms.tenantId, tenantId)));
    if (!bom) throw new NotFoundError('Bom', bomId);
    if (!bom.isActive) throw new BusinessError('BOM_INACTIVE', 'Cannot explode an inactive BOM');

    const lines = await this.db.select().from(bomLines).where(eq(bomLines.bomId, bomId));
    const bomOutputQty = parseFloat(String(bom.outputQty));
    const scaleFactor = bomOutputQty > 0 ? outputQty / bomOutputQty : 0;

    for (const l of lines) {
      const quantityPerOutput = parseFloat(String(l.quantityPerOutput));
      const scrapPercent = parseFloat(String(l.scrapPercent ?? '0'));
      const requiredQty = quantityPerOutput * scaleFactor * (1 + scrapPercent / 100);

      const [subBom] = await this.db
        .select({ id: boms.id })
        .from(boms)
        .where(
          and(
            eq(boms.tenantId, tenantId),
            eq(boms.finishedItemId, l.componentItemId),
            eq(boms.isActive, true)
          )
        );

      if (subBom) {
        await this.explodeInto(subBom.id, tenantId, requiredQty, leaves, depth + 1);
        continue;
      }

      const key = `${l.componentItemId}:${l.componentVariantId ?? ''}`;
      const existing = leaves.get(key);
      const rounded = Math.round(requiredQty * 1000) / 1000;
      leaves.set(key, {
        componentItemId: l.componentItemId,
        ...(l.componentVariantId !== null ? { componentVariantId: l.componentVariantId } : {}),
        requiredQty: existing
          ? Math.round((existing.requiredQty + rounded) * 1000) / 1000
          : rounded,
      });
    }
  }

  // Nested (indented) view for display — unlike explode(), does NOT flatten/aggregate; every
  // component is returned once per occurrence in the tree, with `children` present when that
  // component is itself a sub-assembly. Same depth guard as explode().
  async explodeTree(bomId: number, tenantId: number, outputQty: number): Promise<BomTreeNode[]> {
    return this.buildTree(bomId, tenantId, outputQty, 0);
  }

  private async buildTree(
    bomId: number,
    tenantId: number,
    outputQty: number,
    depth: number
  ): Promise<BomTreeNode[]> {
    if (depth >= MAX_BOM_DEPTH) {
      throw new BusinessError(
        'BOM_TOO_DEEP',
        `BOM nesting exceeds ${MAX_BOM_DEPTH} levels while building tree for bomId ${bomId}`
      );
    }

    const [bom] = await this.db
      .select()
      .from(boms)
      .where(and(eq(boms.id, bomId), eq(boms.tenantId, tenantId)));
    if (!bom) throw new NotFoundError('Bom', bomId);
    if (!bom.isActive) throw new BusinessError('BOM_INACTIVE', 'Cannot explode an inactive BOM');

    const lines = await this.db.select().from(bomLines).where(eq(bomLines.bomId, bomId));
    const bomOutputQty = parseFloat(String(bom.outputQty));
    const scaleFactor = bomOutputQty > 0 ? outputQty / bomOutputQty : 0;

    const nodes: BomTreeNode[] = [];
    for (const l of lines) {
      const quantityPerOutput = parseFloat(String(l.quantityPerOutput));
      const scrapPercent = parseFloat(String(l.scrapPercent ?? '0'));
      const requiredQty = quantityPerOutput * scaleFactor * (1 + scrapPercent / 100);
      const rounded = Math.round(requiredQty * 1000) / 1000;

      const [subBom] = await this.db
        .select({ id: boms.id })
        .from(boms)
        .where(
          and(
            eq(boms.tenantId, tenantId),
            eq(boms.finishedItemId, l.componentItemId),
            eq(boms.isActive, true)
          )
        );

      const node: BomTreeNode = {
        componentItemId: l.componentItemId,
        ...(l.componentVariantId !== null ? { componentVariantId: l.componentVariantId } : {}),
        requiredQty: rounded,
      };
      if (subBom) {
        node.subBomId = subBom.id;
        node.children = await this.buildTree(subBom.id, tenantId, rounded, depth + 1);
      }
      nodes.push(node);
    }
    return nodes;
  }
}
