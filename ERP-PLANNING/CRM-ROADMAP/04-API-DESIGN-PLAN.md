# 04 — API Design Plan

## 1. Conventions (inherited)

- All new routes under `/api/v2/`, served by `sales-service` (per AR-1), reached through
  `api-gateway` in production paths — verify the gateway's route table
  (`apps/api-gateway/src/app.ts`) is updated in the same change that adds a new `sales-service`
  route; this codebase's gateway-cutover history shows forgetting this is a real, recurring failure
  mode (a route works when called directly against the service port but 404s through the gateway).
- Resource naming: kebab-case plural nouns (`/leads`, `/opportunities`, `/tickets`,
  `/referral-codes`); action endpoints are `POST /resource/:id/verb` (`/opportunities/:id/won`,
  `/tickets/:id/resolve`, `/leads/:id/convert`) — matching `CODING_STANDARDS.md` §3 exactly.
- Every route: Zod schema for body/query → `authenticate` → `requirePermission(PERMISSIONS.X)` →
  handler → audit log on state change → outbox event in the same transaction for anything another
  service or the CRM's own consumers need to react to.
- Response envelope matches the existing convention used by `invoiceApi`/`customerApi` — do not
  invent a new envelope shape for CRM endpoints. Remember the frontend's `apiClient.get()` only
  returns `.data` and silently drops sibling fields (`00-CODEBASE-AUDIT.md` §6) — any new paginated
  list endpoint's frontend hook must be written with that in mind, not assumed to "just work" the
  way a naive read of the backend response would suggest.

## 2. New route groups by phase

| Phase | Route group                                                                                                                                                                                                                                                                                                                | Notes                                                                                                                                             |
| ----- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1     | `/accounts`, `/accounts/:id/contacts`                                                                                                                                                                                                                                                                                      | Extends existing `/customers` conceptually; `account_id` FK, not a route rename.                                                                  |
| 1     | `/leads`, `/leads/:id/convert`, `/leads/:id/activities`                                                                                                                                                                                                                                                                    | Public capture endpoint (`POST /leads/capture`) is separately rate-limited and CAPTCHA-gated — different trust level from the rest.               |
| 1     | `/tickets`, `/tickets/:id/messages`, `/tickets/:id/resolve`, `/tickets/:id/csat`                                                                                                                                                                                                                                           | Channel webhooks (WhatsApp/email inbound) create tickets server-side, not via this public surface.                                                |
| 1     | Customer 360 composed read: `GET /customers/:id/360`                                                                                                                                                                                                                                                                       | Read-only, composes `HealthScoringService` + `ActivityTimelineService` + existing sales/accounting reads — no new writes, no new source of truth. |
| 2     | `/opportunities`, `/opportunities/:id/won`, `/opportunities/:id/lost`, `/pipeline-stages`                                                                                                                                                                                                                                  | Stage-won handoff calls the existing `quotation.routes.ts` creation path — does not duplicate quotation logic.                                    |
| 2     | `/journeys`, `/journeys/:id/publish`, `/journeys/:id/enrollments`                                                                                                                                                                                                                                                          |                                                                                                                                                   |
| 2     | `/loyalty/tiers`, `/loyalty/redemptions`, `/loyalty/redemption-catalog`                                                                                                                                                                                                                                                    | Redemption debit posts through the existing `LoyaltyService`, same ledger.                                                                        |
| 2     | `/referral-codes`, `/referral/redeem`                                                                                                                                                                                                                                                                                      | `/referral/redeem` is customer-triggered (called from POS/portal), fraud-gated server-side.                                                       |
| 2     | `/conversations`, `/conversations/:id/messages`, inbound webhook endpoints per channel                                                                                                                                                                                                                                     | Inbound webhooks are the reverse direction of the existing `WebhookDispatchService` pattern.                                                      |
| 3     | AI suite: no public write API — internal scoring job only, results read via `GET /customers/:id/360`'s existing composed response (extend it, don't add a parallel endpoint).                                                                                                                                              |                                                                                                                                                   |
| 3     | Portal: `/portal/orders`, `/portal/tickets`, `/portal/loyalty`, `/portal/preferences` under a **separate auth scope** (AR-5) — these are not the same routes as the internal-staff equivalents even where the underlying data overlaps, because the authorization check differs fundamentally (self-only vs. tenant-wide). |                                                                                                                                                   |
| 4     | `/field-visits`, `/approval-chains`, `/approval-requests`, WhatsApp Commerce webhook                                                                                                                                                                                                                                       |                                                                                                                                                   |

## 3. Event contracts (outbox → Kafka → consumers)

New events this roadmap introduces, following the existing `{ENTITY}_{PAST_TENSE_VERB}` convention:

```
LEAD_CAPTURED, LEAD_CONVERTED, LEAD_ASSIGNED
OPPORTUNITY_CREATED, OPPORTUNITY_STAGE_CHANGED, OPPORTUNITY_WON, OPPORTUNITY_LOST
TICKET_CREATED, TICKET_ASSIGNED, TICKET_SLA_BREACHED, TICKET_RESOLVED
JOURNEY_STEP_ENTERED, JOURNEY_COMPLETED
REFERRAL_REDEEMED
LOYALTY_TIER_CHANGED, LOYALTY_REDEEMED
```

Each carries the same minimum contract every existing event does: `tenantId`, the aggregate ID, and
enough denormalized data for consumers to act without a synchronous callback (per the existing
outbox-payload-completeness convention — see `00-CODEBASE-AUDIT.md`'s note on prior outbox
under-population bugs; do not repeat that pattern here, include full context in the payload, not
just IDs consumers would need to re-fetch).

**Consumers:**

- `OPPORTUNITY_WON` → triggers quotation creation (sales-service internal, same-process call is
  acceptable here since it's the same service — an event is only needed if another _service_ must
  react).
- `TICKET_SLA_BREACHED` → `notification-service` (escalation alert).
- `LOYALTY_TIER_CHANGED` → `notification-service` (customer notification) + potentially
  `accounting-service` if points-liability accounting is ever built (Phase 4+, not committed here).

## 4. Public/external-facing surface (new attack surface — cross-reference `06-SECURITY-PLAN.md`)

Three genuinely new categories of externally-reachable endpoint this roadmap introduces, none of
which exist anywhere in this codebase today:

1. **Public lead capture** (`POST /leads/capture`) — unauthenticated, rate-limited, CAPTCHA-gated.
2. **Inbound channel webhooks** (WhatsApp/email reply, click-tracking redirect) — authenticated by
   provider signature verification (same pattern `WebhookDispatchService` already uses outbound, in
   reverse), not by user JWT.
3. **Customer portal** — authenticated, but by a customer, not staff (AR-5) — the first time this
   codebase issues a JWT to a non-employee.

All three need explicit sign-off in the security review before Phase 1 (items 1–2) and Phase 3
(item 3) ship — see `06-SECURITY-PLAN.md`.
