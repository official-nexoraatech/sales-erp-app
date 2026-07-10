import type { ErpDatabase } from '@erp/db';
import { SagaOrchestrator, GST_COMPLIANCE_SAGA_TYPE, createGstComplianceStepFactory } from '@erp/sdk';
import type { GstComplianceActionDeps, GstComplianceContext } from '@erp/sdk';

// event-service holds no NIC credentials and must not import gst-service's domain
// code (apps don't import each other's src/ in this codebase) — so its deps for the
// shared GST_COMPLIANCE_GENERATION factory proxy to gst-service's internal routes
// instead of calling NIC-integration logic in-process. Same x-internal-key +
// per-service-URL-env-var convention already used between scheduler-service and
// every other service for search-sync (apps/scheduler-service/src/jobs/searchSyncJobs.ts).
async function callGstComplianceAction(path: string, ctx: GstComplianceContext): Promise<void> {
  const gstServiceUrl = process.env['GST_SERVICE_URL'] ?? 'http://localhost:3018';
  const apiKey = process.env['INTERNAL_API_KEY'] ?? '';

  const res = await fetch(`${gstServiceUrl}/api/v2${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-internal-key': apiKey },
    body: JSON.stringify({ tenantId: ctx.tenantId, userId: ctx.userId, correlationId: ctx.correlationId }),
  });

  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    throw new Error(`gst-service internal call ${path} failed (${res.status}): ${JSON.stringify(body)}`);
  }
}

function createProxyDeps(): GstComplianceActionDeps {
  return {
    generateIrn: (ctx) => callGstComplianceAction(`/internal/gst-compliance/${ctx.invoiceId}/actions/generate-irn`, ctx),
    cancelIrn: (ctx) => callGstComplianceAction(`/internal/gst-compliance/${ctx.invoiceId}/actions/cancel-irn`, ctx),
    generateEwayBill: (ctx) => callGstComplianceAction(`/internal/gst-compliance/${ctx.invoiceId}/actions/generate-eway-bill`, ctx),
  };
}

// Built once at bootstrap and reused across requests — SagaOrchestrator.register()
// populates an in-memory map, so a fresh instance per request (the pre-PG-006 bug
// in saga.routes.ts) would lose the registration immediately.
export function createEventServiceGstComplianceOrchestrator(db: ErpDatabase): SagaOrchestrator {
  const orchestrator = new SagaOrchestrator(db);
  orchestrator.register(GST_COMPLIANCE_SAGA_TYPE, createGstComplianceStepFactory(db, createProxyDeps()));
  return orchestrator;
}
