import type { FastifyReply, FastifyRequest } from 'fastify';
import { verifyAccessToken, type AuthPayload } from '@erp/sdk';

// In-memory only for this process — never forwarded downstream as a header. Every service
// independently re-verifies the same JWT and derives its own tenantId from it (see PG-001
// Architecture: a client can reach most services directly, bypassing this gateway entirely,
// so a service ever trusting an x-tenant-id header instead of its own JWT verification would
// be spoofable). This decoration exists solely so the gateway's own rate limiter can key by
// tenant (see gatewayAuthDecorate below) — it is not a substitute for each service's own auth.
declare module 'fastify' {
  interface FastifyRequest {
    auth?: AuthPayload;
  }
}

// Coarse-grained gate only — JWT signature/expiry check so malformed/expired tokens
// never reach a backend service. Fine-grained requirePermission() checks stay
// exclusively in each service (see PG-001 Architecture: gateway has no route-table
// visibility into per-route permission requirements).
const EXEMPT_PATHS = new Set([
  '/health',
  // Prometheus can't send a JWT bearer token. Every other one of the 14 backend services
  // leaves /metrics unauthenticated by registering their auth hook on a child-scoped
  // plugin instead of the root instance; this gateway registers its auth hooks on the root
  // instance (needed so they cover every proxy route), so /metrics must be listed here
  // explicitly or it 401s every scrape (found 2026-07-23: the gateway had zero Prometheus
  // coverage — no scrape job even existed for it, and this would have 401'd the moment one
  // was added).
  '/metrics',
  '/api/auth/auth/login',
  '/api/auth/auth/lookup-tenants',
  '/api/auth/auth/refresh',
  '/api/auth/auth/logout',
  '/api/auth/auth/forgot-password',
  '/api/auth/auth/reset-password',
  '/api/auth/auth/mfa/verify',
  // CRM-ROADMAP Phase 3, Feature 2 (Self-Service Customer Portal): the portal's own
  // login/refresh/logout/set-password surface — a customer has no staff JWT to present,
  // same reasoning as the staff /api/auth/auth/login|refresh|logout entries above.
  '/api/auth/auth/portal/set-password',
  '/api/auth/auth/portal/login',
  '/api/auth/auth/portal/refresh',
  '/api/auth/auth/portal/logout',
  // CRM-ROADMAP Phase 4, Feature 6 (Partner/Channel Portal): same reasoning, third auth scope.
  '/api/auth/auth/partner/set-password',
  '/api/auth/auth/partner/login',
  '/api/auth/auth/partner/refresh',
  '/api/auth/auth/partner/logout',
  '/api/tenant/public/signup',
  '/api/tenant/public/faqs',
  '/api/tenant/public/demo-requests',
  // CRM-ROADMAP Phase 1, Feature 2 (Lead Management & Capture): the one unauthenticated write
  // route sales-service exposes — 04-API-DESIGN-PLAN.md §1 explicitly warns forgetting this
  // exact step is a recurring failure mode (route works direct-to-service, 404/401s through
  // the gateway). sales-service is registered apiV2:true, so the client-facing path omits
  // /api/v2 (see config.ts's apiV2 comment) even though lead.routes.ts registers it under
  // that prefix internally.
  '/api/sales/leads/capture',
  // CRM-ROADMAP Phase 2, Feature 4 (Referral Program Engine): the other unauthenticated write
  // route sales-service exposes — same "must add here or it 401s through the gateway" gotcha as
  // the lead-capture entry above.
  '/api/sales/referral/redeem',
  // CRM-ROADMAP Phase 2, Feature 5 (Omnichannel Communication Hub): inbound provider webhooks —
  // a WhatsApp/email/SMS provider posting a reply isn't a logged-in ERP user. Verified by
  // provider signature instead (see inbound-webhooks.routes.ts), same as every entry above.
  '/api/sales/webhooks/whatsapp',
  '/api/sales/webhooks/instagram',
  '/api/sales/webhooks/email',
  '/api/sales/webhooks/sms',
  // CRM-ROADMAP Phase 4, Feature 7 (CTI / Call Center Integration): Twilio's own callbacks —
  // verified by X-Twilio-Signature (see verifyTwilioSignature), same reasoning as every other
  // inbound-provider-webhook entry above.
  '/api/sales/webhooks/twilio/voice',
  '/api/sales/webhooks/twilio/status',
  '/api/sales/webhooks/twilio/recording',
]);

// A handful of genuinely unauthenticated routes carry a dynamic path segment (e.g. a
// one-time token), so they can't be listed as an exact string in EXEMPT_PATHS above.
const EXEMPT_PREFIXES = [
  '/api/report/unsubscribe/',
  // CRM-ROADMAP Phase 2, Feature 6 (Campaign Studio — Engagement Tracking Activation): the
  // click-redirect and open-pixel routes carry a dynamic :trackingToken segment, same reason
  // as the unsubscribe entry above.
  '/api/sales/c/',
  '/api/sales/o/',
  // CRM-ROADMAP Phase 2, Feature 4: the referral-link click redirect carries a dynamic :code
  // segment, same reason as the two entries above.
  '/api/sales/r/',
  // CRM-ROADMAP Phase 4, Feature 8 (Public CRM API & BI Export): a third auth mechanism
  // (per-tenant API key, `x-api-key` header, never a JWT) — a whole route namespace, not a
  // single path, so it's a prefix rather than individual EXEMPT_PATHS entries.
  // public-api.routes.ts's own requirePublicApiScope preHandler is the real
  // authentication/authorization gate; this only lets the request past the gateway's own
  // JWT-only coarse check.
  '/api/sales/public/v1/',
];

// The native browser EventSource API cannot set an Authorization header, so SSE routes
// accept the JWT as a `?token=` query param instead (notification-service's own
// authenticateStream already handles this) — the gateway must recognize the same fallback
// for exactly these routes, or it 401s every SSE connection before notification-service ever
// sees it (found in live QA 2026-07-17: the stream 401'd on every page load).
const QUERY_TOKEN_PATHS = new Set(['/api/notification/notifications/stream']);

function extractToken(request: FastifyRequest, path: string | undefined): string | undefined {
  const authHeader = request.headers.authorization;
  const headerToken = authHeader?.startsWith('Bearer ')
    ? authHeader.slice('Bearer '.length)
    : undefined;
  if (headerToken) return headerToken;
  if (path !== undefined && QUERY_TOKEN_PATHS.has(path)) {
    return (request.query as { token?: string } | undefined)?.token;
  }
  return undefined;
}

// Runs FIRST, before rate-limiting (see app.ts registration order) — attempts full
// signature/expiry/issuer verification and decorates request.auth on success; never rejects.
// Registered ahead of @fastify/rate-limit's own preHandler-phase hook specifically so the
// limiter can key by verified tenantId when available (packages/platform-sdk/src/rate-limit.ts
// tenantOrIpKeyGenerator), while an invalid/missing token still falls back to IP-keying and is
// still counted — not skipped — by the limiter, exactly as before.
//
// Deliberately does the real, signature-verified check here rather than a cheap unverified
// decode: an unverified decode would let anyone bucket their own traffic under an arbitrary
// tenantId claim (just base64 JSON, no crypto needed to fabricate one) and exhaust another
// tenant's rate-limit quota with zero valid credentials. Requiring a real signature means only
// someone already holding a currently-valid token for a given tenant can ever count against
// that tenant's bucket — which is correct and intended.
//
// Fixes F1 from the 2026-07-23 API Gateway audit: tenantOrIpKeyGenerator was already wired up
// but silently always fell back to IP, because request.auth never existed at rate-limit time.
export async function gatewayAuthDecorate(
  request: FastifyRequest,
  _reply: FastifyReply
): Promise<void> {
  const path = request.url.split('?')[0];
  const token = extractToken(request, path);
  if (!token) return;

  try {
    request.auth = await verifyAccessToken(token);
    const correlationId = (request as unknown as { correlationId?: string }).correlationId;
    if (correlationId) {
      request.headers['x-correlation-id'] = correlationId;
    }
  } catch {
    // Left undecorated — gatewayAuthReject rejects non-exempt paths with no request.auth.
    // Not this hook's job to distinguish "no token" from "bad token": both fall back to
    // IP-keying identically at the rate limiter.
  }
}

// Runs THIRD, after rate-limiting — the actual reject-if-unauthenticated decision. Same
// externally-observable outcome as the original single-function gatewayAuthPreHandler, just
// split across the rate limiter so a request's auth state is known before its rate-limit
// check runs, instead of after.
export async function gatewayAuthReject(
  request: FastifyRequest,
  reply: FastifyReply
): Promise<void> {
  const path = request.url.split('?')[0];
  if (path !== undefined) {
    if (EXEMPT_PATHS.has(path)) return;
    if (EXEMPT_PREFIXES.some((prefix) => path.startsWith(prefix))) return;
  }
  if (request.auth) return;

  const hadToken = extractToken(request, path) !== undefined;
  void reply.code(401).send({
    error: {
      code: 'UNAUTHENTICATED',
      message: hadToken
        ? 'Invalid or expired access token'
        : 'Missing or invalid Authorization header',
    },
  });
}
