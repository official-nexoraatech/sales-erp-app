import type { FastifyInstance } from 'fastify';
import type { PlatformContextFactory } from '@erp/sdk';
import {
  tenantScopedHandler,
  getBranchScope,
  omitFieldsFromListWithoutPermission,
  omitFieldsWithoutPermission,
} from '@erp/sdk';
import { PERMISSIONS } from '@erp/types';
import { authenticate } from '../middleware/authenticate.js';
import { requirePermission } from '../middleware/authorize.js';
import { CrmDashboardService } from '../domain/CrmDashboardService.js';

// CRM-ROADMAP Phase 1, Feature 8 — CRM Dashboards & KPI Tracking. One composed read endpoint
// (same "no new source of truth" discipline as Feature 3's Customer 360), gated on
// CRM_DASHBOARD_VIEW to open it at all — but each section is FURTHER gated by the permission
// that already governs that data (LEAD_VIEW/TICKET_VIEW/CRM_CAMPAIGN_ANALYTICS_VIEW), and a
// caller missing one is simply omitted from the response (`hiddenSections`), never a 403 for
// the whole dashboard — a manager without TICKET_VIEW still sees their lead funnel.
//
// Phase 9 GUC-per-request rollout — migrated 2026-08-21. No external I/O, pure reads.
export async function crmDashboardRoutes(
  fastify: FastifyInstance,
  ctxFactory: PlatformContextFactory
): Promise<void> {
  fastify.get(
    '/crm/dashboard',
    { preHandler: [authenticate, requirePermission(PERMISSIONS.CRM_DASHBOARD_VIEW)] },
    tenantScopedHandler(ctxFactory, async (request, reply, ctx) => {
      const { permissions, branchIds } = request.auth;
      const query = request.query as { from?: string; to?: string };
      const range = {
        from: query.from ? new Date(query.from) : undefined,
        to: query.to ? new Date(query.to) : undefined,
      };
      const branchScope = getBranchScope({ permissions, branchIds });

      const canViewLeads = permissions.includes(PERMISSIONS.LEAD_VIEW);
      const canViewTickets = permissions.includes(PERMISSIONS.TICKET_VIEW);
      const canViewCampaigns = permissions.includes(PERMISSIONS.CRM_CAMPAIGN_ANALYTICS_VIEW);
      // CRM-ROADMAP Phase 4, Feature 5: gated on QUOTA_MANAGE (Sales Ops admin), not a
      // dedicated QUOTA_VIEW — same "one permission for this whole config surface" precedent
      // as TERRITORY_MANAGE. QUOTA_VALUE_VIEW additionally hides the $ figures within the
      // section (applied inside getQuotaAttainment's caller below), same layering as the
      // leadFunnel/ticketSla/campaignPerformance sections' own coarser permission gate.
      const canViewQuotas = permissions.includes(PERMISSIONS.QUOTA_MANAGE);
      const hiddenSections: string[] = [
        ...(canViewLeads ? [] : ['leadFunnel']),
        ...(canViewTickets ? [] : ['ticketSla']),
        ...(canViewCampaigns ? [] : ['campaignPerformance']),
        ...(canViewQuotas ? [] : ['quotaAttainment']),
      ];

      const now = new Date();
      const query2 = request.query as { periodYear?: string; periodMonth?: string };
      const periodYear = query2.periodYear ? parseInt(query2.periodYear, 10) : now.getUTCFullYear();
      const periodMonth = query2.periodMonth
        ? parseInt(query2.periodMonth, 10)
        : now.getUTCMonth() + 1;

      const [leadFunnel, ticketSla, campaignPerformance, quotaAttainmentRaw] = await Promise.all([
        canViewLeads
          ? CrmDashboardService.getLeadFunnel(ctx.db.raw, ctx.tenant.tenantId, branchScope, range)
          : Promise.resolve(null),
        canViewTickets
          ? CrmDashboardService.getTicketSlaCompliance(
              ctx.db.raw,
              ctx.tenant.tenantId,
              branchScope,
              range
            )
          : Promise.resolve(null),
        canViewCampaigns
          ? CrmDashboardService.getCampaignPerformance(
              ctx.db.raw,
              ctx.tenant.tenantId,
              branchScope,
              range
            )
          : Promise.resolve(null),
        canViewQuotas
          ? CrmDashboardService.getQuotaAttainment(
              ctx.db.raw,
              ctx.tenant.tenantId,
              periodYear,
              periodMonth
            )
          : Promise.resolve(null),
      ]);

      const quotaAttainment = quotaAttainmentRaw && {
        periodYear: quotaAttainmentRaw.periodYear,
        periodMonth: quotaAttainmentRaw.periodMonth,
        rows: omitFieldsFromListWithoutPermission(
          quotaAttainmentRaw.rows,
          ['quotaAmount', 'actualAmount', 'attainmentPct'],
          permissions,
          PERMISSIONS.QUOTA_VALUE_VIEW
        ),
        ...omitFieldsWithoutPermission(
          {
            totalQuota: quotaAttainmentRaw.totalQuota,
            totalActual: quotaAttainmentRaw.totalActual,
            totalAttainmentPct: quotaAttainmentRaw.totalAttainmentPct,
          },
          ['totalQuota', 'totalActual', 'totalAttainmentPct'],
          permissions,
          PERMISSIONS.QUOTA_VALUE_VIEW
        ),
      };

      return reply.code(200).send({
        data: { leadFunnel, ticketSla, campaignPerformance, quotaAttainment, hiddenSections },
      });
    })
  );
}
