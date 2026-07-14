# 16 — Integration Requirements

## Current Integrations (real, verified)

- **MSG91** (SMS Flow API) — `apps/notification-service`, credential env vars `MSG91_AUTH_KEY`/
  `MSG91_TEMPLATE_ID`.
- **SendGrid** (Email API) — `SENDGRID_API_KEY`, `SMTP_FROM_ADDRESS`.
- **Meta WhatsApp Cloud API** — `WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_ACCESS_TOKEN`.
- All three default to placeholder/empty credentials if unset, meaning they fail loudly in an
  unconfigured environment rather than silently — this is correct behavior to preserve, not a bug to "fix"
  by adding fallback mock-sends.

## New Integrations Required

| Integration                                                                               | Purpose                                                 | Phase                              |
| ----------------------------------------------------------------------------------------- | ------------------------------------------------------- | ---------------------------------- |
| MSG91 delivery-webhook                                                                    | Real SMS delivery status                                | CP-6                               |
| SendGrid Event Webhook                                                                    | Email delivered/opened/clicked/bounced                  | CP-6                               |
| Meta WhatsApp status webhook                                                              | WhatsApp delivered/read                                 | CP-6                               |
| New channel provider APIs (Telegram Bot API, Meta Messenger Platform, Web Push/VAPID)     | New channels                                            | CP-2 (framework) / CP-8 (adapters) |
| Object storage for media assets (reuse existing ERP file-storage mechanism if one exists) | Asset library                                           | CP-2                               |
| Outbound webhook dispatcher                                                               | Notify third-party systems of campaign lifecycle events | CP-8                               |

## Integration Design Principles

- **Inbound webhooks (delivery/engagement callbacks) are channel-adapter-owned** — each adapter that
  supports webhooks implements `parseDeliveryWebhook`, keeping provider-specific payload parsing out of
  `CampaignService`/route handlers (`10_OMNICHANNEL_REQUIREMENTS.md`).
- **Outbound webhooks (SH-17) are generic**, not tied to any one channel — they fire on campaign lifecycle
  events (sent, completed, failed) regardless of which channel(s) the campaign used, for third-party CRM/
  marketing-tool consumption.
- **No new integration bypasses opt-out enforcement or tenant isolation** — every inbound webhook must
  resolve to the correct tenant/campaign via signed payload data, and every outbound webhook only exposes
  data the receiving tenant is entitled to see.
- **Credential management follows the existing per-tenant-or-per-environment config pattern** in
  `notification-service/src/config.ts` — extended to cover new providers, not redesigned.

## API Requirements (surface-level; full detail in `17_DATA_MODEL_AND_API_DESIGN.md`)

- Existing `crm.routes.ts` endpoints remain stable (no breaking changes) — new capability is added via new
  endpoints (e.g. `POST /crm/campaigns/:id/pause`, `GET /crm/campaigns/:id/analytics`) rather than by
  changing existing request/response shapes.
- A future external/public API surface for campaigns (`NH-04`) is documented as a CP-8 candidate but not
  required for the platform to meet its enterprise-grade goals — internal API completeness comes first.
