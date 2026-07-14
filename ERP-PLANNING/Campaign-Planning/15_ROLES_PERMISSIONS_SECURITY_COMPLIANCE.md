# 15 — Roles, Permissions, Security & Compliance

## Current State

Three coarse permissions gate everything: `CRM_VIEW`, `CRM_CAMPAIGN_CREATE`, `CRM_CAMPAIGN_SEND`. No
separation between "can draft" / "can approve" / "can send" / "can view analytics". Note per
`rbac_dead_permission_constant_pattern` memory: this ERP has a recurring bug class where a permission
constant is granted in `role-defaults.ts` but the route/UI checks a different constant — **every new
permission added in this initiative must be verified end-to-end (granted in role defaults AND checked by
the actual route/UI it's meant to guard)**, not assumed correct because it compiles.

## Target Permission Model (`FR-K3`, `MH-13`)

| Permission                                                                                             | Grants                                                     |
| ------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------- |
| `CRM_VIEW` (existing)                                                                                  | View campaigns, segments, analytics — read-only            |
| `CRM_CAMPAIGN_CREATE` (existing)                                                                       | Create/edit drafts                                         |
| `CRM_CAMPAIGN_APPROVE` (new)                                                                           | Approve/reject a campaign pending approval                 |
| `CRM_CAMPAIGN_SEND` (existing)                                                                         | Send/schedule an approved campaign, pause/resume, cancel   |
| `CRM_CAMPAIGN_ANALYTICS_VIEW` (new)                                                                    | View analytics/dashboard (may be granted more broadly than |
| `CRM_VIEW`, e.g. to a marketing analyst who shouldn't create campaigns)                                |
| `CRM_AUTOMATION_MANAGE` (new)                                                                          | Configure automation rules/triggers                        |
| `CRM_SEGMENT_MANAGE` (existing scope, may already be covered by `CRM_CAMPAIGN_CREATE` — confirm during |
| CP-3 implementation whether segments need their own permission separate from campaigns)                |

Store/salesperson-scoped restriction (`US-05`) is enforced server-side at recipient-resolution time, not
just hidden in the UI — a Ravi-scoped user's segment queries are additionally filtered to their own branch/
assigned-customer set regardless of what the UI shows.

## Security Requirements

- **Delivery-webhook endpoints are public-facing** (called by MSG91/SendGrid/Meta, not by an authenticated
  ERP user) — each must verify the provider's signature/HMAC scheme and must resolve tenant/campaign context
  from the webhook's own signed payload, never trust a client-supplied tenant/campaign ID without that
  verification (`NFR-14`).
- **Media uploads** are validated server-side for type/size regardless of client-side checks, and stored
  with tenant-scoped access control (`NFR-15`).
- **No secrets in logs** — provider API keys (MSG91/SendGrid/Meta tokens), consistent with existing
  `notification-service/src/config.ts` conventions (`NFR-16`).
- **Preference-center changes are audit-logged** — who changed what, when (`NFR-18`).

## Compliance Requirements

- **Consent basis** (`BR-09`): India's DPDP Act and TRAI regulations govern commercial SMS/WhatsApp
  communication. The platform must record a consent basis per customer per channel (not just an opt-out
  flag) sufficient to demonstrate compliance if challenged — this is a data-model addition
  (`17_DATA_MODEL_AND_API_DESIGN.md`), not just a UI toggle.
- **Preference center** (`FR-L2`, `MH-17`): customer-facing, channel + category (promotional vs.
  transactional) level control, not binary opt-out only.
- **Guaranteed unsubscribe** (`FR-L1`): every outbound marketing message includes a working, channel-
  appropriate opt-out mechanism, and it takes effect before any subsequent send (`US-06`).
- **Opt-out enforcement remains non-bypassable** (`NFR-17`) — this is the one invariant that must never
  regress through any phase, since it's the one piece of the current implementation already verified
  correct.

## Audit History

- Every lifecycle transition (create, edit, submit, approve, reject, schedule, send, pause, resume, cancel)
  is logged with actor + timestamp, consistent with the existing audit-log pattern already used for send/
  schedule/cancel today.
- Campaign detail view surfaces this as a visible "History" tab (`SH-13`), not just a backend log table —
  today's audit logging exists but has no UI, which defeats its purpose for a non-technical user like Anita
  (`US-10`).
