/**
 * PG-006 — GST_COMPLIANCE_GENERATION saga wiring (gst-service side).
 * The step-list shape (with/without the e-Way Bill step) and compensation
 * semantics are already covered at the shared-factory level in
 * packages/platform-sdk/src/__tests__/sagas/gst-compliance.test.ts. This file
 * covers what's specific to gst-service: buildEwayBillPayload's derivation from
 * e-Invoice input, and createGstComplianceRealDeps' wiring into
 * EInvoiceService/EwayBillService.
 */
import { describe, it, expect, vi } from 'vitest';
import { BusinessError } from '@erp/types';
import type { BuildNicPayloadInput } from '../domain/EInvoiceService.js';

const einvoiceInput: BuildNicPayloadInput = {
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
  grandTotal: 75900,
};

describe('buildEwayBillPayload', () => {
  it('intra-state invoice → item cgstRate/sgstRate = gstRate/2, igstRate = 0', async () => {
    const { buildEwayBillPayload } = await import('../domain/GstComplianceSaga.js');
    const payload = buildEwayBillPayload(einvoiceInput);

    expect(payload.itemList[0]).toMatchObject({ cgstRate: 9, sgstRate: 9, igstRate: 0 });
    expect(payload.cgstValue).toBe(450);
    expect(payload.sgstValue).toBe(450);
    expect(payload.igstValue).toBe(0);
    expect(payload.transMode).toBe('1');
    expect(payload.docNo).toBe('INV-2026-001');
  });

  it('inter-state invoice → item igstRate = gstRate, cgstRate = sgstRate = 0', async () => {
    const { buildEwayBillPayload } = await import('../domain/GstComplianceSaga.js');
    const payload = buildEwayBillPayload({
      ...einvoiceInput,
      igstAmount: 900,
      cgstAmount: 0,
      sgstAmount: 0,
      lines: [{ ...einvoiceInput.lines[0]!, igstAmount: 900, cgstAmount: 0, sgstAmount: 0 }],
    });

    expect(payload.itemList[0]).toMatchObject({ cgstRate: 0, sgstRate: 0, igstRate: 18 });
    expect(payload.igstValue).toBe(900);
    expect(payload.cgstValue).toBe(0);
    expect(payload.sgstValue).toBe(0);
  });

  it('throws when e-Invoice input could not be built (e.g. invoice not found)', async () => {
    const { buildEwayBillPayload } = await import('../domain/GstComplianceSaga.js');
    expect(() => buildEwayBillPayload(null)).toThrow(BusinessError);
  });
});

describe('createGstComplianceRealDeps', () => {
  it('generateIrn builds the NIC payload from buildEinvoicePayloadInput and calls EInvoiceService.generateIrn', async () => {
    vi.resetModules();
    vi.doMock('../domain/EInvoiceService.js', () => ({
      EInvoiceService: { generateIrn: vi.fn().mockResolvedValue(undefined), cancelIrn: vi.fn() },
      buildEinvoicePayloadInput: vi.fn().mockResolvedValue(einvoiceInput),
      buildNicPayload: (input: BuildNicPayloadInput) => ({ DocDtls: { No: input.invoiceNumber } }),
      toNicDate: () => '01/07/2026',
    }));
    vi.doMock('../domain/EwayBillService.js', () => ({ EwayBillService: { generate: vi.fn() } }));

    const { createGstComplianceRealDeps } = await import('../domain/GstComplianceSaga.js');
    const { EInvoiceService } = await import('../domain/EInvoiceService.js');

    const deps = createGstComplianceRealDeps({} as never);
    await deps.generateIrn({ tenantId: 1, userId: 5, invoiceId: 101, correlationId: 'c1' });

    expect(EInvoiceService.generateIrn).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: 1 }),
      1,
      5,
      101,
      { DocDtls: { No: 'INV-2026-001' } },
      'c1'
    );
    vi.doUnmock('../domain/EInvoiceService.js');
    vi.doUnmock('../domain/EwayBillService.js');
  });

  it('generateIrn throws EINVOICE_NOT_APPLICABLE when input cannot be built', async () => {
    vi.resetModules();
    vi.doMock('../domain/EInvoiceService.js', () => ({
      EInvoiceService: { generateIrn: vi.fn(), cancelIrn: vi.fn() },
      buildEinvoicePayloadInput: vi.fn().mockResolvedValue(null),
      buildNicPayload: vi.fn(),
      toNicDate: vi.fn(),
    }));
    vi.doMock('../domain/EwayBillService.js', () => ({ EwayBillService: { generate: vi.fn() } }));

    const { createGstComplianceRealDeps } = await import('../domain/GstComplianceSaga.js');
    const deps = createGstComplianceRealDeps({} as never);

    await expect(
      deps.generateIrn({ tenantId: 1, userId: 5, invoiceId: 999, correlationId: 'c1' })
    ).rejects.toMatchObject({ code: 'EINVOICE_NOT_APPLICABLE' });

    vi.doUnmock('../domain/EInvoiceService.js');
    vi.doUnmock('../domain/EwayBillService.js');
  });

  it('cancelIrn delegates to EInvoiceService.cancelIrn with a saga-compensation reason', async () => {
    vi.resetModules();
    vi.doMock('../domain/EInvoiceService.js', () => ({
      EInvoiceService: { generateIrn: vi.fn(), cancelIrn: vi.fn().mockResolvedValue(undefined) },
      buildEinvoicePayloadInput: vi.fn(),
      buildNicPayload: vi.fn(),
      toNicDate: vi.fn(),
    }));
    vi.doMock('../domain/EwayBillService.js', () => ({ EwayBillService: { generate: vi.fn() } }));

    const { createGstComplianceRealDeps } = await import('../domain/GstComplianceSaga.js');
    const { EInvoiceService } = await import('../domain/EInvoiceService.js');
    const deps = createGstComplianceRealDeps({} as never);

    await deps.cancelIrn({ tenantId: 1, userId: 5, invoiceId: 101, correlationId: 'c1' });

    expect(EInvoiceService.cancelIrn).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: 1 }),
      1,
      101,
      'GST_COMPLIANCE_SAGA_COMPENSATION'
    );
    vi.doUnmock('../domain/EInvoiceService.js');
    vi.doUnmock('../domain/EwayBillService.js');
  });
});
