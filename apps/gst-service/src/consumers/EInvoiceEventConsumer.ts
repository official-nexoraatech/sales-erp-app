import { eq, and } from 'drizzle-orm';
import type { ERPEventPayload } from '@erp/types';
import type { TenantScopedDatabase, GstComplianceContext, SagaOrchestrator, SagaStepFactory } from '@erp/sdk';
import { EWB_VALUE_THRESHOLD } from '@erp/sdk';
import { einvoiceData } from '@erp/db';
import { createLogger } from '@erp/logger';
import { EInvoiceService, buildEinvoicePayloadInput, buildNicPayload } from '../domain/EInvoiceService.js';
import { runGstComplianceSaga } from '../domain/GstComplianceSaga.js';

const logger = createLogger({ serviceName: 'gst-service' });

const IRN_CANCEL_WINDOW_HOURS = 24;

// Built once at bootstrap (apps/gst-service/src/main.ts) and passed into the consumer
// so the two NIC calls for high-value invoices become one compensable saga instead of
// two independent fire-and-forget calls (PG-006).
export interface GstComplianceSagaHandle {
  orchestrator: SagaOrchestrator;
  factory: SagaStepFactory<GstComplianceContext>;
}

interface InvoiceConfirmedPayload {
  invoiceId: number;
  invoiceNumber: string;
  customerId?: number;
  customerName?: string;
  customerGstin?: string;
  placeOfSupply?: string;
}

interface InvoiceCancelledPayload {
  invoiceId: number;
  reason?: string;
}

// Triggered after INVOICE_CONFIRMED (Kafka). e-Invoice/IRN only applies to B2B sales —
// invoices without a customer GSTIN (B2C) are skipped; NOT_APPLICABLE is the implicit
// default status when no einvoice_data row exists (see EInvoiceService.getStatus).
export async function handleInvoiceConfirmedForEinvoice(
  event: ERPEventPayload,
  db: TenantScopedDatabase,
  complianceSaga?: GstComplianceSagaHandle
): Promise<void> {
  const p = event.payload as unknown as InvoiceConfirmedPayload;
  if (!p.customerGstin) return;

  try {
    const input = await buildEinvoicePayloadInput(db, event.tenantId, p.invoiceId, {
      customerGstin: p.customerGstin,
      ...(p.customerName !== undefined ? { customerName: p.customerName } : {}),
      ...(p.placeOfSupply !== undefined ? { placeOfSupply: p.placeOfSupply } : {}),
      invoiceNumber: p.invoiceNumber,
    });
    if (!input) return;

    // createdBy=0: system-triggered, no interactive user (mirrors the retryPendingIrns sentinel)
    await EInvoiceService.generateIrn(db, event.tenantId, 0, p.invoiceId, buildNicPayload(input));
    logger.info({ invoiceId: p.invoiceId }, 'e-Invoice: auto IRN generation triggered from INVOICE_CONFIRMED');

    // PG-006: only invoices over the e-Way Bill threshold need the second NIC call —
    // below it, the direct generateIrn call above already fully handles compliance.
    // Starting the saga is best-effort: a failure here must never undo the IRN that
    // was just generated above (matches this consumer's existing swallow-errors
    // philosophy for NIC issues).
    if (complianceSaga && Number(input.grandTotal) > EWB_VALUE_THRESHOLD) {
      try {
        await runGstComplianceSaga(
          complianceSaga.orchestrator,
          complianceSaga.factory,
          event.tenantId,
          0,
          event.correlationId,
          p.invoiceId
        );
        logger.info({ invoiceId: p.invoiceId }, 'e-Invoice: GST_COMPLIANCE_GENERATION saga started for e-Way Bill step');
      } catch (sagaErr) {
        logger.error({ err: sagaErr, invoiceId: p.invoiceId }, 'e-Invoice: GST_COMPLIANCE_GENERATION saga failed to start/complete');
      }
    }
  } catch (err) {
    // EInvoiceService already persists FAILED_IRN/PENDING_IRN internally on NIC errors;
    // never let a NIC issue fail the INVOICE_CONFIRMED event (GST ledger recording must still succeed).
    logger.error({ err, invoiceId: p.invoiceId }, 'e-Invoice: auto IRN generation failed');
  }
}

// Triggered after INVOICE_CANCELLED (Kafka). IRN can only be cancelled at NIC within 24h
// of generation; past that window NIC requires manual cancellation via the portal.
export async function handleInvoiceCancelledForEinvoice(
  event: ERPEventPayload,
  db: TenantScopedDatabase
): Promise<void> {
  const p = event.payload as unknown as InvoiceCancelledPayload;

  const [record] = await db.raw
    .select()
    .from(einvoiceData)
    .where(and(eq(einvoiceData.tenantId, event.tenantId), eq(einvoiceData.invoiceId, p.invoiceId)));
  if (!record || record.irnStatus !== 'IRN_GENERATED' || !record.irn) return;

  const generatedAt = record.ackDate ?? record.createdAt;
  const hoursSinceGeneration = (Date.now() - generatedAt.getTime()) / (1000 * 60 * 60);

  if (hoursSinceGeneration > IRN_CANCEL_WINDOW_HOURS) {
    await db.raw
      .update(einvoiceData)
      .set({ irnStatus: 'CANCEL_REQUIRED_MANUALLY', updatedAt: new Date() })
      .where(and(eq(einvoiceData.tenantId, event.tenantId), eq(einvoiceData.invoiceId, p.invoiceId)));
    logger.warn(
      { invoiceId: p.invoiceId },
      'e-Invoice: 24h NIC cancellation window expired — manual cancellation required via NIC portal'
    );
    return;
  }

  try {
    await EInvoiceService.cancelIrn(db, event.tenantId, p.invoiceId, 'Invoice cancelled in ERP', p.reason);
    logger.info({ invoiceId: p.invoiceId }, 'e-Invoice: auto IRN cancellation triggered from INVOICE_CANCELLED');
  } catch (err) {
    logger.error({ err, invoiceId: p.invoiceId }, 'e-Invoice: auto IRN cancellation failed');
  }
}
