# 06 — Security Considerations

## 1. Permission constants — full list this roadmap adds

Every constant below must be added to **both** `packages/shared-types/src/permissions.ts` and
`apps/web-frontend/src/constants/permissions.ts` in the same change, per AR-7. Exact final naming
should follow this codebase's existing `<ENTITY>_<ACTION>` convention (e.g. `INVOICE_CREATE`) —
the list below is intent, not final spelling; grep existing sibling constants for the precise style
before finalizing.

```
ACCOUNT_VIEW, ACCOUNT_CREATE, ACCOUNT_UPDATE, ACCOUNT_MERGE
CONTACT_VIEW, CONTACT_CREATE, CONTACT_UPDATE, CONTACT_DELETE
LEAD_VIEW, LEAD_CREATE, LEAD_UPDATE, LEAD_ASSIGN, LEAD_CONVERT, LEAD_DELETE
OPPORTUNITY_VIEW, OPPORTUNITY_CREATE, OPPORTUNITY_UPDATE, OPPORTUNITY_STAGE_CHANGE, OPPORTUNITY_DELETE
TICKET_VIEW, TICKET_CREATE, TICKET_UPDATE, TICKET_ASSIGN, TICKET_RESOLVE, TICKET_DELETE
JOURNEY_VIEW, JOURNEY_CREATE, JOURNEY_PUBLISH, JOURNEY_DELETE
LOYALTY_TIER_MANAGE, LOYALTY_REDEEM
REFERRAL_VIEW, REFERRAL_CONFIGURE
CONVERSATION_VIEW, CONVERSATION_REPLY, CONVERSATION_ASSIGN
CRM_360_VIEW
```

Every one of these needs its `requirePermission()` call grepped against the actual route (not
inferred), per the four-times-recurred bug class in `RBAC_ARCHITECTURE.md` §4.

## 2. New attack surface — three items requiring explicit sign-off

Mirrors `04-API-DESIGN-PLAN.md` §4. Restated here with the specific mitigations required, since this
is the security-owning document:

### 2.1 Public lead capture endpoint

- Rate limiting via `@fastify/rate-limit` (already installed, used on auth-service login — same
  pattern, new route).
- CAPTCHA or equivalent bot-mitigation before the row is written (not after) — otherwise this is an
  unauthenticated write endpoint into a multi-tenant database, the highest-risk shape of endpoint
  this codebase has ever exposed.
- Strict Zod validation with tight field limits — this is the one endpoint in the entire codebase an
  anonymous internet user can reach without any auth token at all; treat every field as hostile
  input.
- No PII should be logged from this path at info/debug level, matching `CODING_STANDARDS.md` §5.

### 2.2 Inbound channel webhooks (WhatsApp/email reply, click-tracking redirect)

- Verified by provider signature (Meta's webhook signature scheme for WhatsApp; equivalent for
  email inbound-parse), never by a shared secret alone — mirrors how outbound
  `WebhookDispatchService` already signs deliveries, applied in reverse.
- Idempotency required — a provider retry must not create a duplicate ticket/message. Use the same
  `inbox_events`-style idempotency-key pattern this codebase already uses for Kafka consumers.

### 2.3 Customer Self-Service Portal (Phase 3)

- New `CUSTOMER` role, explicitly **not** part of `ROLE_DEFAULTS`'s 13 staff roles and never
  granted `BRANCH_SCOPE_BYPASS` — see AR-5.
- Every portal route filters `WHERE customer_id = :selfCustomerId` server-side from the JWT claim,
  never from a client-supplied ID — this is the standard IDOR (insecure direct object reference)
  risk class for any customer-facing account portal, and the one this document flags as highest-risk
  in the whole roadmap because it's genuinely novel for this codebase (every existing JWT belongs to
  a trusted employee).
- Add portal routes to `route-guard-coverage.test.ts` rather than exempting them — the CI backstop
  should apply with equal force to a newer, higher-risk surface, not less.
- Session/token TTL for portal customers should likely be shorter-lived or otherwise distinct from
  staff tokens — a decision for implementation time, but explicitly not "reuse the staff default
  blindly."
- Support-agent impersonation of a portal session (for debugging a customer's issue) must go through
  the existing platform-operator impersonation audit-log pattern (`PLATFORM_ADMIN` impersonation
  already exists per prior QA memory) — never a silent admin override.

## 3. Data sensitivity classification for new tables

| Table category                             | Sensitivity                                                                  | Handling                                                                                                                                             |
| ------------------------------------------ | ---------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| `crm_leads`, `crm_lead_activities`         | Contains PII (name, phone, email) pre-consent in some cases (public capture) | No different from existing customer PII handling — never logged at info/debug (`CODING_STANDARDS.md` §5)                                             |
| `crm_tickets`, `crm_ticket_messages`       | May contain sensitive complaint content, occasionally payment/order disputes | Same handling as existing `customer_interactions`                                                                                                    |
| `crm_conversations` (Omnichannel)          | Raw message content from customers, potentially sensitive                    | Do not index full message bodies into logs; consider retention policy (not committed in this roadmap — flag for a follow-up data-retention decision) |
| `crm_referral_codes`/`crm_referral_events` | Fraud-relevant — self-referral, device/address correlation                   | Fraud detection logic (Phase 2 feature) needs its own abuse-review path, not just a reward payout path                                               |

## 4. DLT/TRAI SMS compliance (Phase 1, legal requirement)

- `crm_dlt_templates` stores tenant-configured DLT-registered template IDs and sender headers.
- `notification-service`'s `NotificationEngine.sendSms()` must reject (not silently send) any
  promotional SMS whose content doesn't match a registered DLT template for that tenant — this is a
  hard gate, not a warning, because non-compliant SMS in India carries real regulatory and carrier
  -blocking risk to the tenant, not just this platform.
- This is a compliance/config concern per the existing ES-18 prompt's own framing ("DLT Registration
  ... is a configuration concern, not code concern") — the code's job is to enforce the gate, not to
  handle the registration process itself.

## 5. Encryption / field-level protection

No new field in this roadmap rises to the level requiring AES-256-GCM field encryption the way
GSTIN/PAN/bank accounts do today (`TECH_AUDIT.md` §15) — confirm this holds at implementation time
if any Phase 3+ feature (e.g. a portal payment-method-on-file feature, not currently in scope) is
added later.

## 6. Audit logging

Every state-changing CRM route follows the existing `PlatformAuditLogger` pattern
(`packages/platform-sdk`) — lead assignment, opportunity stage changes, ticket resolution, and
referral reward payouts are exactly the kind of "who did what, when" actions this codebase already
audit-logs for sales/inventory/accounting; no exception for CRM.
