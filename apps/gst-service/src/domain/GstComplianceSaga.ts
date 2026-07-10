import type { ErpDatabase } from '@erp/db';
import { TenantScopedDatabase, SagaOrchestrator, GST_COMPLIANCE_SAGA_TYPE, createGstComplianceStepFactory } from '@erp/sdk';
import type { GstComplianceContext, GstComplianceActionDeps, SagaStepFactory, SagaResult } from '@erp/sdk';
import { BusinessError } from '@erp/types';
import { EInvoiceService, buildEinvoicePayloadInput, buildNicPayload, toNicDate } from './EInvoiceService.js';
import { EwayBillService, type EwayBillPayload } from './EwayBillService.js';

// Part-A only — vehicle/transporter details aren't captured on the invoice today.
// Part-B (vehicle number) can still be added later via the existing manual
// POST /gst/eway-bill/generate flow once dispatch details are known.
export function buildEwayBillPayload(input: Awaited<ReturnType<typeof buildEinvoicePayloadInput>>): EwayBillPayload {
  if (!input) throw new BusinessError('EINVOICE_NOT_APPLICABLE', 'Cannot build e-Way Bill payload without e-Invoice input data');
  const isInterstate = input.igstAmount > 0;

  return {
    supplyType: 'O',
    subSupplyType: 'Supply',
    docType: 'INV',
    docNo: input.invoiceNumber,
    docDate: toNicDate(input.invoiceDate),
    fromGstin: input.seller.gstin,
    fromTrdName: input.seller.legalName,
    fromAddr1: input.seller.address1,
    fromPlace: input.seller.location,
    fromPincode: input.seller.pincode,
    fromStateCode: Number(input.seller.stateCode),
    toGstin: input.buyer.gstin,
    toTrdName: input.buyer.legalName,
    toAddr1: input.buyer.address1,
    toPlace: input.buyer.location,
    toPincode: input.buyer.pincode,
    toStateCode: Number(input.buyer.stateCode),
    totalValue: input.grandTotal,
    cgstValue: isInterstate ? 0 : input.cgstAmount,
    sgstValue: isInterstate ? 0 : input.sgstAmount,
    igstValue: isInterstate ? input.igstAmount : 0,
    cessValue: input.cessAmount,
    transMode: '1',
    itemList: input.lines.map((l) => ({
      productName: l.description,
      hsnCode: l.hsnCode,
      quantity: l.quantity,
      qtyUnit: l.unit,
      cgstRate: isInterstate ? 0 : l.gstRate / 2,
      sgstRate: isInterstate ? 0 : l.gstRate / 2,
      igstRate: isInterstate ? l.gstRate : 0,
      ...(l.cessRate ? { cessRate: l.cessRate } : {}),
      taxableAmount: l.taxableAmount,
    })),
  };
}

// Exported so apps/gst-service/src/api/internal.routes.ts can call the same
// generateIrn/cancelIrn/generateEwayBill implementations directly — those internal
// routes exist so event-service's proxy deps (apps/event-service/src/sagas/
// gstComplianceProxy.ts) have something real to call during retry()/compensate().
export function createGstComplianceRealDeps(rawDb: ErpDatabase): GstComplianceActionDeps {
  return {
    async generateIrn(ctx): Promise<void> {
      const db = new TenantScopedDatabase(ctx.tenantId, rawDb);
      const input = await buildEinvoicePayloadInput(db, ctx.tenantId, ctx.invoiceId);
      if (!input) throw new BusinessError('EINVOICE_NOT_APPLICABLE', `Cannot build e-Invoice payload for invoice ${ctx.invoiceId}`);
      await EInvoiceService.generateIrn(db, ctx.tenantId, ctx.userId, ctx.invoiceId, buildNicPayload(input), ctx.correlationId);
    },
    async cancelIrn(ctx): Promise<void> {
      const db = new TenantScopedDatabase(ctx.tenantId, rawDb);
      await EInvoiceService.cancelIrn(db, ctx.tenantId, ctx.invoiceId, 'GST_COMPLIANCE_SAGA_COMPENSATION');
    },
    async generateEwayBill(ctx): Promise<void> {
      const db = new TenantScopedDatabase(ctx.tenantId, rawDb);
      const input = await buildEinvoicePayloadInput(db, ctx.tenantId, ctx.invoiceId);
      const payload = buildEwayBillPayload(input);
      await EwayBillService.generate(db, ctx.tenantId, ctx.userId, ctx.invoiceId, payload, ctx.correlationId);
    },
  };
}

// Builds gst-service's own registered orchestrator, wired to the real NIC-calling
// domain services (EInvoiceService/EwayBillService). event-service registers the
// same shared factory-builder against internal-HTTP-proxied deps instead — see
// apps/event-service/src/sagas/gstComplianceProxy.ts.
export function createGstComplianceOrchestrator(rawDb: ErpDatabase): {
  orchestrator: SagaOrchestrator;
  factory: SagaStepFactory<GstComplianceContext>;
} {
  const factory = createGstComplianceStepFactory(rawDb, createGstComplianceRealDeps(rawDb));
  const orchestrator = new SagaOrchestrator(rawDb);
  orchestrator.register(GST_COMPLIANCE_SAGA_TYPE, factory);
  return { orchestrator, factory };
}

export async function runGstComplianceSaga(
  orchestrator: SagaOrchestrator,
  factory: SagaStepFactory<GstComplianceContext>,
  tenantId: number,
  userId: number,
  correlationId: string,
  invoiceId: number
): Promise<SagaResult> {
  const payload = { invoiceId, userId, correlationId };
  const { steps, context } = await factory(payload, tenantId);
  return orchestrator.run({ sagaType: GST_COMPLIANCE_SAGA_TYPE, tenantId, correlationId, steps, context, payload });
}
