import type { FastifyInstance } from 'fastify';
import type { PlatformContextFactory } from '@erp/sdk';
import { withTenantConnection } from '@erp/sdk';
import { crmLinkClicks, campaignRecipients } from '@erp/db';
import { and, eq, isNull, sql } from 'drizzle-orm';

// CRM-ROADMAP Phase 2, Feature 6 — Campaign Studio — Engagement Tracking Activation.
//
// Both routes here are PUBLIC (no `authenticate` preHandler) by necessity — an SMS/email
// recipient clicking a link or loading an image in their inbox isn't logged into this ERP.
// Neither route ever trusts anything in the request beyond the opaque trackingToken: the
// redirect destination always comes from OUR OWN crm_link_clicks row (populated at send time
// from the campaign's own linkUrl, never from a query param), which is what keeps GET
// /c/:trackingToken from being an open-redirect vector — the token can only ever resolve to a
// URL a real, permissioned campaign creator configured, never an arbitrary attacker-supplied one.
//
// Phase 9 GUC-per-request rollout — migrated 2026-08-21. The tenant isn't known until the
// trackingToken resolves to a row (no req.auth here at all — these are public routes), so this
// does the initial lookup unscoped via ctxFactory.rawDb, then scopes the follow-up writes with
// withTenantConnection(ctxFactory.rawDb, row.tenantId, ...) once the tenant is known.

// A minimal 1x1 transparent PNG, decoded once at module load.
const TRANSPARENT_PIXEL = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
  'base64'
);

export async function linkTrackingRoutes(
  fastify: FastifyInstance,
  ctxFactory: PlatformContextFactory
): Promise<void> {
  // ── GET /c/:trackingToken — click redirect ───────────────────────────────────
  fastify.get<{ Params: { trackingToken: string } }>(
    '/c/:trackingToken',
    async (request, reply) => {
      const { trackingToken } = request.params;

      const [row] = await ctxFactory.rawDb
        .select()
        .from(crmLinkClicks)
        .where(eq(crmLinkClicks.trackingToken, trackingToken));
      if (!row || !row.destinationUrl) {
        return reply
          .code(404)
          .send({ error: { code: 'NOT_FOUND', message: 'Unknown or link-less tracking link' } });
      }

      // Best-effort — per this feature's own performance note, a failed click-write must never
      // block or slow the redirect itself.
      try {
        await withTenantConnection(ctxFactory.rawDb, row.tenantId, async (db) => {
          await db
            .update(crmLinkClicks)
            .set({ clickCount: sql`${crmLinkClicks.clickCount} + 1`, lastClickedAt: new Date() })
            .where(eq(crmLinkClicks.id, row.id));
          await db
            .update(crmLinkClicks)
            .set({ firstClickedAt: new Date() })
            .where(and(eq(crmLinkClicks.id, row.id), isNull(crmLinkClicks.firstClickedAt)));
          // "Exactly once" semantic: guarded so a second/third click on the same link never
          // overwrites the recipient's FIRST-click timestamp with a later one.
          await db
            .update(campaignRecipients)
            .set({ clickedAt: new Date() })
            .where(
              and(
                eq(campaignRecipients.id, row.campaignRecipientId),
                isNull(campaignRecipients.clickedAt)
              )
            );
        });
      } catch {
        // Swallow — the redirect must still happen even if the click write failed.
      }

      return reply.redirect(row.destinationUrl, 302);
    }
  );

  // ── GET /o/:trackingToken — open-tracking pixel ───────────────────────────────
  fastify.get<{ Params: { trackingToken: string } }>(
    '/o/:trackingToken',
    async (request, reply) => {
      const { trackingToken } = request.params;

      try {
        const [row] = await ctxFactory.rawDb
          .select()
          .from(crmLinkClicks)
          .where(eq(crmLinkClicks.trackingToken, trackingToken));
        if (row) {
          await withTenantConnection(ctxFactory.rawDb, row.tenantId, async (db) => {
            await db
              .update(crmLinkClicks)
              .set({ openCount: sql`${crmLinkClicks.openCount} + 1`, lastOpenedAt: new Date() })
              .where(eq(crmLinkClicks.id, row.id));
            await db
              .update(crmLinkClicks)
              .set({ firstOpenedAt: new Date() })
              .where(and(eq(crmLinkClicks.id, row.id), isNull(crmLinkClicks.firstOpenedAt)));
            await db
              .update(campaignRecipients)
              .set({ openedAt: new Date() })
              .where(
                and(
                  eq(campaignRecipients.id, row.campaignRecipientId),
                  isNull(campaignRecipients.openedAt)
                )
              );
          });
        }
      } catch {
        // Swallow — the pixel must always render regardless of tracking-write success.
      }

      reply.header('Content-Type', 'image/png');
      reply.header('Cache-Control', 'no-store, no-cache, must-revalidate, private');
      return reply.send(TRANSPARENT_PIXEL);
    }
  );
}
