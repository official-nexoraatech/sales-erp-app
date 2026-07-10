/**
 * ES-11 — NIC e-Invoice (IRN) integration
 * Covers: buildNicPayload correctness, intra/inter-state GST split, retry-with-backoff
 * behavior, and the FAILED_IRN transition after retries are exhausted.
 *
 * Tests 4/5 from the ES-11 prompt ("NIC sandbox authenticate/generateIRN returns real
 * data") are integration tests against NIC's live sandbox and are skipped here — no
 * network access to the NIC sandbox is available in this environment, consistent with
 * this codebase's existing precedent of skipping DB/network-dependent tests where infra
 * isn't available (see sales-service/accounting-service "skipped — no DATABASE_URL").
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { fetchWithRetry } from '../domain/nicRetry.js';

// ── buildNicPayload (Tests 1, 2, 3) — pure function, no mocking needed ─────────────
import { buildNicPayload, type BuildNicPayloadInput } from '../domain/EInvoiceService.js';

function baseInput(overrides: Partial<BuildNicPayloadInput> = {}): BuildNicPayloadInput {
  return {
    invoiceNumber: 'INV-2026-001',
    invoiceDate: '2026-07-01T00:00:00.000Z',
    seller: {
      gstin: '27AAAAA0000A1Z5',
      legalName: 'Acme Textiles Pvt Ltd',
      address1: 'Plot 12, Industrial Estate',
      location: 'Mumbai',
      pincode: 400001,
      stateCode: '27',
    },
    buyer: {
      gstin: '27BBBBB0000B1Z6',
      legalName: 'Retail Buyer Pvt Ltd',
      placeOfSupply: '27',
      address1: '45 MG Road',
      location: 'Mumbai',
      pincode: 400002,
      stateCode: '27',
    },
    lines: [
      {
        description: 'Cotton Shirt',
        hsnCode: '6205',
        quantity: 10,
        unit: 'PCS',
        unitPrice: 500,
        taxableAmount: 5000,
        gstRate: 18,
        cgstAmount: 450,
        sgstAmount: 450,
        igstAmount: 0,
        cessRate: 0,
        cessAmount: 0,
        lineTotal: 5900,
        discountAmount: 0,
      },
    ],
    taxableAmount: 5000,
    cgstAmount: 450,
    sgstAmount: 450,
    igstAmount: 0,
    cessAmount: 0,
    grandTotal: 5900,
    ...overrides,
  };
}

describe('buildNicPayload', () => {
  it('1. returns correct NIC JSON structure — amounts in rupees (this schema stores decimal rupees, not paise)', () => {
    const payload = buildNicPayload(baseInput());
    expect(payload.Version).toBe('1.1');
    expect(payload.DocDtls).toEqual({ Typ: 'INV', No: 'INV-2026-001', Dt: '01/07/2026' });
    expect(payload.ItemList).toHaveLength(1);
    expect(payload.ItemList[0]).toMatchObject({
      HsnCd: '6205',
      Qty: 10,
      UnitPrice: 500,
      AssAmt: 5000,
      TotItemVal: 5900,
    });
    expect(payload.ValDtls.TotInvVal).toBe(5900);
  });

  it('2. intra-state invoice → CGST + SGST present, IGST = 0', () => {
    const payload = buildNicPayload(baseInput());
    expect(payload.ValDtls.CgstVal).toBe(450);
    expect(payload.ValDtls.SgstVal).toBe(450);
    expect(payload.ValDtls.IgstVal).toBe(0);
    expect(payload.ItemList[0].CgstAmt).toBe(450);
    expect(payload.ItemList[0].SgstAmt).toBe(450);
    expect(payload.ItemList[0].IgstAmt).toBe(0);
  });

  it('3. inter-state invoice → IGST present, CGST = SGST = 0', () => {
    const payload = buildNicPayload(
      baseInput({
        igstAmount: 900,
        cgstAmount: 0,
        sgstAmount: 0,
        lines: [
          {
            description: 'Cotton Shirt',
            hsnCode: '6205',
            quantity: 10,
            unit: 'PCS',
            unitPrice: 500,
            taxableAmount: 5000,
            gstRate: 18,
            cgstAmount: 0,
            sgstAmount: 0,
            igstAmount: 900,
            cessRate: 0,
            cessAmount: 0,
            lineTotal: 5900,
            discountAmount: 0,
          },
        ],
      })
    );
    expect(payload.ValDtls.IgstVal).toBe(900);
    expect(payload.ValDtls.CgstVal).toBe(0);
    expect(payload.ValDtls.SgstVal).toBe(0);
    expect(payload.ItemList[0].IgstAmt).toBe(900);
    expect(payload.ItemList[0].CgstAmt).toBe(0);
    expect(payload.ItemList[0].SgstAmt).toBe(0);
  });

  it.skip('4. (Integration) NIC sandbox authenticate → returns session token — requires live NIC sandbox network access', () => {});
  it.skip('5. (Integration) NIC sandbox generate IRN → returns IRN/AckNo/SignedQRCode — requires live NIC sandbox network access', () => {});
});

// ── Retry-with-backoff (Tests 6, 7) ─────────────────────────────────────────────────
function mockResponse(status: number, body: Record<string, unknown>): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: String(status),
    json: async () => body,
  } as unknown as Response;
}

describe('fetchWithRetry', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('6. NIC API returns 429 → client retries up to 3× and succeeds once NIC recovers', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(mockResponse(429, {}))
      .mockResolvedValueOnce(mockResponse(429, {}))
      .mockResolvedValueOnce(mockResponse(200, { data: { Irn: 'abc' } }));
    vi.stubGlobal('fetch', fetchMock);

    const promise = fetchWithRetry('https://nic.example/IRP/generateIRN', { method: 'POST' });
    await vi.runAllTimersAsync();
    const response = await promise;

    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(response.ok).toBe(true);
  });

  it('7. NIC API returns 500 on every attempt → fails after 3 retries', async () => {
    const fetchMock = vi.fn().mockResolvedValue(mockResponse(500, { ErrorMessage: 'Internal error' }));
    vi.stubGlobal('fetch', fetchMock);

    const promise = fetchWithRetry('https://nic.example/IRP/generateIRN', { method: 'POST' });
    await vi.runAllTimersAsync();
    const response = await promise;

    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(response.ok).toBe(false);
    expect(response.status).toBe(500);
  });
});

// ── EInvoiceService.generateIrn → FAILED_IRN after exhausted retries ───────────────
type Cond = { type: 'and'; args: Cond[] } | { type: 'eq'; col: string; val: unknown };

vi.mock('drizzle-orm', () => ({
  and: (...args: Cond[]) => ({ type: 'and', args }),
  eq: (col: string, val: unknown) => ({ type: 'eq', col, val }),
  lt: () => ({ type: 'eq', col: '__unused__', val: undefined }),
  lte: () => ({ type: 'eq', col: '__unused__', val: undefined }),
  sql: (strings: TemplateStringsArray) => strings.join(''),
}));

vi.mock('@erp/db', () => ({
  einvoiceData: {
    tenantId: 'tenantId',
    invoiceId: 'invoiceId',
    irnStatus: 'irnStatus',
  },
  createDatabaseClient: () => ({}),
}));

function evalCond(cond: Cond, row: Record<string, unknown>): boolean {
  if (cond.type === 'and') return cond.args.every((c) => evalCond(c, row));
  if (cond.type === 'eq') return row[cond.col] === cond.val;
  return true;
}

function makeFakeDb(seed: Record<string, unknown>[] = []) {
  const rows = [...seed];
  return {
    raw: {
      select: () => ({
        from: () => ({
          where: (cond: Cond) => Promise.resolve(rows.filter((r) => evalCond(cond, r))),
        }),
      }),
      insert: () => ({
        values: (v: Record<string, unknown>) => {
          rows.push({ id: rows.length + 1, ...v });
          return Promise.resolve();
        },
      }),
      update: () => ({
        set: (patch: Record<string, unknown>) => ({
          where: (cond: Cond) => {
            rows.forEach((r, i) => {
              if (evalCond(cond, r)) rows[i] = { ...r, ...patch };
            });
            return Promise.resolve();
          },
        }),
      }),
    },
    rows,
  };
}

describe('EInvoiceService.generateIrn', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    process.env['NIC_API_KEY'] = 'test-key';
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  it('7. NIC API returns 500 on every attempt → fails after 3 retries; irnStatus = FAILED_IRN', async () => {
    const fetchMock = vi.fn().mockResolvedValue(mockResponse(500, { ErrorMessage: 'Internal error' }));
    vi.stubGlobal('fetch', fetchMock);

    const { EInvoiceService } = await import('../domain/EInvoiceService.js');
    const db = makeFakeDb();

    // .then(onFulfilled, onRejected) attaches a handler synchronously, before any
    // `await` — unlike `expect(promise).rejects`, this can't race with fake-timer
    // advancement and leave the rejection unhandled for a tick.
    const settled = EInvoiceService.generateIrn(
      db as never,
      1,
      1,
      101,
      buildNicPayload(baseInput())
    ).then(
      () => ({ threw: false }),
      () => ({ threw: true })
    );
    await vi.runAllTimersAsync();

    expect((await settled).threw).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(3);
    const record = db.rows.find((r) => r['invoiceId'] === 101);
    expect(record?.['irnStatus']).toBe('FAILED_IRN');
  });
});
