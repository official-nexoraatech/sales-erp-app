import { describe, it, expect, vi } from 'vitest';
import { BusinessError, NotFoundError } from '@erp/types';
import { CostCenterService } from '../domain/CostCenterService.js';

// Unit tests against a mocked db.raw (no live Postgres needed) — mirrors the
// mocking style used elsewhere in this suite (see financial-year.test.ts).

function makeDb(opts: {
  selectResults: unknown[][]; // consumed in call order by successive .select() calls
  insertReturning?: unknown;
  updateReturning?: unknown;
}) {
  let selectCallIndex = 0;
  const capturedUpdateSets: Record<string, unknown>[] = [];

  return {
    db: {
      raw: {
        select: vi.fn().mockImplementation(() => ({
          from: vi.fn().mockReturnValue({
            where: vi
              .fn()
              .mockImplementation(() =>
                Promise.resolve(opts.selectResults[selectCallIndex++] ?? [])
              ),
          }),
        })),
        insert: vi.fn().mockReturnValue({
          values: vi
            .fn()
            .mockReturnValue({ returning: vi.fn().mockResolvedValue([opts.insertReturning]) }),
        }),
        update: vi.fn().mockReturnValue({
          set: vi.fn().mockImplementation((set: Record<string, unknown>) => {
            capturedUpdateSets.push(set);
            return {
              where: vi
                .fn()
                .mockResolvedValue(
                  opts.updateReturning !== undefined ? [opts.updateReturning] : []
                ),
            };
          }),
        }),
      },
    } as never,
    capturedUpdateSets,
  };
}

describe('CostCenterService', () => {
  it('creates a cost center scoped to the tenant', async () => {
    const { db } = makeDb({
      selectResults: [[]],
      insertReturning: { id: 1, tenantId: 1, code: 'TAIL', name: 'Tailoring' },
    });

    const created = await CostCenterService.create(db, 1, 5, { code: 'TAIL', name: 'Tailoring' });

    expect(created).toEqual({ id: 1, tenantId: 1, code: 'TAIL', name: 'Tailoring' });
  });

  it('rejects a duplicate code within the same tenant with COST_CENTER_CODE_DUPLICATE', async () => {
    const { db } = makeDb({ selectResults: [[{ id: 99 }]] });

    await expect(
      CostCenterService.create(db, 1, 5, { code: 'TAIL', name: 'Tailoring' })
    ).rejects.toThrow(BusinessError);
  });

  it('rejects creating a child under a non-existent parent (tenant isolation: cross-tenant parent looks non-existent)', async () => {
    const { db } = makeDb({ selectResults: [[]] }); // getById(parentId) finds nothing

    await expect(
      CostCenterService.create(db, 1, 5, { code: 'STORE', name: 'Store', parentId: 999 })
    ).rejects.toThrow(NotFoundError);
  });

  it('rejects a cost center being set as its own parent', async () => {
    const { db } = makeDb({ selectResults: [[{ id: 3, tenantId: 1, code: 'A', name: 'A' }]] }); // getById(3) for existence check

    await expect(CostCenterService.update(db, 1, 3, { parentId: 3 })).rejects.toThrow(
      BusinessError
    );
  });

  it('soft-deletes via isActive rather than a hard delete', async () => {
    const { db, capturedUpdateSets } = makeDb({
      selectResults: [[{ id: 4, tenantId: 1, code: 'B', name: 'B', isActive: true }]],
    });

    await CostCenterService.softDelete(db, 1, 4);

    expect(capturedUpdateSets[0]).toMatchObject({ isActive: false });
  });

  it('throws NotFoundError when the cost center does not exist for this tenant', async () => {
    const { db } = makeDb({ selectResults: [[]] });

    await expect(CostCenterService.getById(db, 1, 123)).rejects.toThrow(NotFoundError);
  });
});
