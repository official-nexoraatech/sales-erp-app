import { eq, and } from 'drizzle-orm';
import { invoices, einvoiceData, type ErpDatabase } from '@erp/db';
import { NotFoundError } from '@erp/types';
import type { SagaStepDefinition, SagaStepFactory } from '../saga.js';

// PG-006: the first registered saga type. Two sequential NIC calls for the same
// invoice — e-Invoice IRN generation, then (conditionally) e-Way Bill generation —
// wrapped so a failed EWB step compensates the IRN instead of leaving the invoice in
// a half-compliant state with no automated remediation.
export const GST_COMPLIANCE_SAGA_TYPE = 'GST_COMPLIANCE_GENERATION';

// e-Way Bill threshold: goods worth > ₹50,000 (single source of truth — both
// gst-service's EwayBillService and this saga's step-list-shape decision must agree,
// since retry()/compensate() rebuild the step list from this same factory in a
// different process than the one that started the saga).
export const EWB_VALUE_THRESHOLD = 50000;

export interface GstComplianceContext {
  tenantId: number;
  userId: number;
  invoiceId: number;
  correlationId: string;
}

// The only part of this saga that legitimately differs per-process: making the real
// NIC calls requires gst-service's domain code (and its NIC_API_KEY), which a shared
// package must not import (would invert the app/package dependency direction) and
// which event-service does not and should not hold. gst-service wires these to its
// own EInvoiceService/EwayBillService; event-service wires them to internal HTTP
// calls against gst-service, so retry()/compensate() from the admin console still
// exercise the real logic without duplicating it.
export interface GstComplianceActionDeps {
  generateIrn(ctx: GstComplianceContext): Promise<void>;
  cancelIrn(ctx: GstComplianceContext): Promise<void>;
  generateEwayBill(ctx: GstComplianceContext): Promise<void>;
}

export function createGstComplianceStepFactory(
  db: ErpDatabase,
  deps: GstComplianceActionDeps
): SagaStepFactory<GstComplianceContext> {
  return async (payload, tenantId) => {
    const invoiceId = payload['invoiceId'] as number;
    const userId = payload['userId'] as number;
    const correlationId = payload['correlationId'] as string;

    const [invoice] = await db
      .select({ grandTotal: invoices.grandTotal })
      .from(invoices)
      .where(and(eq(invoices.id, invoiceId), eq(invoices.tenantId, tenantId)))
      .limit(1);
    if (!invoice) throw new NotFoundError('Invoice', invoiceId);

    const context: GstComplianceContext = { tenantId, userId, invoiceId, correlationId };

    const steps: SagaStepDefinition<GstComplianceContext>[] = [
      {
        name: 'generate_irn',
        type: 'COMPENSATABLE',
        execute: (ctx) => deps.generateIrn(ctx),
        compensate: (ctx) => deps.cancelIrn(ctx),
      },
    ];

    if (Number(invoice.grandTotal) > EWB_VALUE_THRESHOLD) {
      steps.push({
        name: 'generate_eway_bill',
        type: 'COMPENSATABLE',
        execute: (ctx) => deps.generateEwayBill(ctx),
        // NIC has no "cancel EWB" API — there is no synthetic undo to invent here, only
        // a manual-review flag (matches EInvoiceEventConsumer's own CANCEL_REQUIRED_MANUALLY
        // status for the same class of irreversible-external-side-effect problem).
        compensate: async (ctx) => {
          await db
            .update(einvoiceData)
            .set({ ewbStatus: 'EWB_GENERATION_FAILED_MANUAL_REVIEW', updatedAt: new Date() })
            .where(and(eq(einvoiceData.tenantId, ctx.tenantId), eq(einvoiceData.invoiceId, ctx.invoiceId)));
        },
      });
    }

    return { steps, context };
  };
}
