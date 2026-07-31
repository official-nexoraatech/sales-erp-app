// M-6 fix: convertToInvoice() used to allow converting straight from DRAFT, silently skipping
// dispatch; and no cancel() method existed at all despite CANCELLED being a valid, referenced
// status. (Also partially closes M-18 — DeliveryChallanService had zero test coverage before.)

import { describe, it, expect, vi } from 'vitest';

vi.mock('@erp/db', () => ({
  deliveryChallans: {
    id: 'id',
    tenantId: 'tenant_id',
    status: 'status',
  },
  deliveryChallanLines: { challanId: 'challan_id' },
  invoices: {},
  customers: {},
  warehouses: {},
}));

vi.mock('drizzle-orm', () => ({
  and: (...args: unknown[]) => ({ type: 'and', args }),
  eq: (col: unknown, val: unknown) => ({ type: 'eq', col, val }),
  getTableColumns: (table: Record<string, unknown>) => ({ ...table }),
}));

import { DeliveryChallanService } from '../domain/DeliveryChallanService.js';
import { BusinessError, NotFoundError } from '@erp/types';

function makeDb(selectResults: unknown[][]) {
  let call = 0;
  const setMock = vi.fn(() => ({ where: () => Promise.resolve(undefined) }));
  return {
    db: {
      select: () => {
        const rows = selectResults[call] ?? [];
        call += 1;
        return { from: () => ({ where: () => Promise.resolve(rows) }) };
      },
      update: () => ({ set: setMock }),
    },
    setMock,
  };
}

describe('DeliveryChallanService.convertToInvoice — DISPATCHED required', () => {
  it('rejects converting a DRAFT challan (must dispatch first)', async () => {
    const { db } = makeDb([[{ id: 1, tenantId: 1, status: 'DRAFT' }]]);
    const svc = new DeliveryChallanService(db as never);

    await expect(svc.convertToInvoice(1, 1)).rejects.toBeInstanceOf(BusinessError);
  });

  it('allows converting a DISPATCHED challan', async () => {
    const { db } = makeDb([[{ id: 1, tenantId: 1, status: 'DISPATCHED' }], [{ id: 10 }]]);
    const svc = new DeliveryChallanService(db as never);

    const result = await svc.convertToInvoice(1, 1);
    expect(result.challanId).toBe(1);
  });

  it('rejects converting an already-CONVERTED challan', async () => {
    const { db } = makeDb([[{ id: 1, tenantId: 1, status: 'CONVERTED' }]]);
    const svc = new DeliveryChallanService(db as never);

    await expect(svc.convertToInvoice(1, 1)).rejects.toMatchObject({ code: 'ALREADY_CONVERTED' });
  });
});

describe('DeliveryChallanService.cancel', () => {
  it('cancels a DRAFT challan', async () => {
    const { db, setMock } = makeDb([[{ id: 1, tenantId: 1, status: 'DRAFT' }]]);
    const svc = new DeliveryChallanService(db as never);

    await svc.cancel(1, 1, 99, 'Customer changed their mind');

    expect(setMock).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'CANCELLED',
        cancellationReason: 'Customer changed their mind',
      })
    );
  });

  it('rejects cancelling a DISPATCHED challan (goods already left the warehouse)', async () => {
    const { db } = makeDb([[{ id: 1, tenantId: 1, status: 'DISPATCHED' }]]);
    const svc = new DeliveryChallanService(db as never);

    await expect(svc.cancel(1, 1, 99, 'test')).rejects.toBeInstanceOf(BusinessError);
  });

  it('throws NotFoundError when the challan does not exist', async () => {
    const { db } = makeDb([[]]);
    const svc = new DeliveryChallanService(db as never);

    await expect(svc.cancel(999, 1, 99, 'test')).rejects.toBeInstanceOf(NotFoundError);
  });
});
