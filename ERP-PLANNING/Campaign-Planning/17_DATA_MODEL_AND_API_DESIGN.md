# 17 — Data Model & API Design

All changes are **additive**: new nullable columns, new tables, new endpoints. No existing column is
renamed or removed; no existing endpoint's request/response shape breaks. See
`19_MIGRATION_AND_BACKWARD_COMPATIBILITY.md` for the compatibility contract this design must honor.

## Schema Additions by Phase

### CP-1 (Foundation Hardening) — DEVIATION FROM ORIGINAL PLAN, see CP-1 completion report

- **FK constraints were investigated and deliberately NOT added.** A repo-wide check found **zero `REFERENCES`
  clauses across all 53 existing migrations** — every relationship in this entire schema (53 tables) is
  enforced at the application layer only, with no exceptions. Adding the first-ever hard FK constraints for
  `campaigns.segment_id`/`campaign_recipients.notification_log_id` would be a unilateral, unprecedented
  architecture change, not a "hardening" — and `notification_log` is owned by a different service's domain
  (notification-service) than `campaigns` (sales-service), so a hard FK would create cross-service schema
  coupling this codebase has consistently avoided elsewhere. Orphan check confirmed 0 orphans exist today
  (safe to add if ever revisited), but the informal-reference pattern is being kept as-is, matching
  established convention. Revisit only with an explicit, repo-wide decision to start using FKs generally —
  not as a one-off for this module.
- `campaigns.version` **is now used** for optimistic locking: every mutating update in `CampaignService`
  (`send`, `schedule`, `cancel`) increments `version: sql\`${campaigns.version} + 1\``alongside`updatedAt`,
matching the exact pattern already used in `StockTransferService`/`StockAdjustmentService`/etc. across the
  codebase. No behavior change — additive column usage only, sets up CP-4's editing feature.

### CP-2 (Channel Abstraction + Media)

- `campaign_media_assets`: `id, tenant_id, filename, mime_type, size_bytes, storage_key, tags (jsonb),
uploaded_by, created_at`.
- `campaign_media_links`: `id, campaign_id, media_asset_id` (many-to-many, a campaign can attach multiple
  assets, an asset can be reused across campaigns).
- `channel_provider_config`: `id, tenant_id, channel, config (jsonb, e.g. sender identity), enabled` — seeds
  the sender-identity work done fully in CP-8 but the table is introduced here since it's where channel
  config naturally lives once channels are abstracted.

### CP-3 (Segmentation + Personalization)

- Extend `customer_segments.filter_definition` field whitelist (application-level change, `SegmentService
.FIELD_COLUMNS`) — no schema change needed for most new fields since they're existing `customers`
  columns or computed subqueries.
- `customer_custom_attributes`: `id, tenant_id, customer_id, attribute_key, attribute_value` — backs
  tenant-defined custom targeting/personalization fields without a schema change per tenant/industry.
- `personalization_token_fallbacks`: `id, tenant_id, token_key, fallback_value` — tenant-configurable
  fail-safe values (`FR-F2`).

### CP-4 (Campaign Builder 2.0)

- `campaign_templates`: `id, tenant_id, name, category, campaign_type, channel, content (jsonb: per-
language variants), media_asset_ids (jsonb), version, created_by, created_at, updated_at`.
- `campaigns` new nullable columns: `campaign_type`, `template_id (nullable FK)`, `is_draft_autosaved (bool)`,
  `last_edited_at`.
- `campaign_history`: `id, campaign_id, actor_id, action, from_status, to_status, diff (jsonb), created_at` —
  backs the audit-history UI (`SH-13`) and edit tracking (`MH-19`).

### CP-5 (Scheduling + Automation)

- `campaigns` new nullable columns: `recurrence_rule (jsonb)`, `timezone`, `parent_recurring_campaign_id
(nullable self-FK, links each firing back to its recurring definition)`.
- `campaign_automation_rules`: `id, tenant_id, trigger_type, enabled, channel, template_id, send_window
(jsonb), conditions (jsonb), created_by, created_at, updated_at`.
- `tenant_communication_settings`: `id, tenant_id, business_hours (jsonb), frequency_cap (jsonb), quiet_hours
(jsonb)`.
- Dispatch moves to a queue table or existing message-broker mechanism (pick whichever the ERP already uses
  elsewhere for background jobs, if any exists, rather than introducing a new broker technology — confirm
  during CP-5 implementation).

### CP-6 (Analytics + A/B Testing)

- `campaign_recipients` new nullable columns: `delivered_at`, `opened_at`, `clicked_at`, `converted_at`,
  `ab_variant`.
- `campaign_delivery_events`: `id, campaign_recipient_id, provider, event_type, raw_payload (jsonb),
received_at` — raw webhook event log, idempotency-keyed on `(provider, provider_event_id)` (`NFR-09`).
- `campaign_ab_variants`: `id, campaign_id, variant_key, content (jsonb), split_percentage`.
- `campaign_attribution_links`: `id, campaign_id, coupon_code (nullable), tracked_link_token (nullable),
attribution_window_days`.

### CP-7 (Collaboration + Compliance)

- `campaigns` new nullable columns: `approval_status`, `approved_by`, `approved_at`, `rejection_reason`.
- `campaign_comments`: `id, campaign_id, author_id, body, created_at`.
- `customer_communication_preferences`: `id, tenant_id, customer_id, channel, category (promotional/
transactional), consented (bool), consent_source, consent_recorded_at` — the consent-basis record required
  by `BR-09`, distinct from (and more granular than) the existing binary `customers.opt_out_*` flags, which
  remain the fast-path enforcement gate.

### CP-8 (Enterprise Scale-out)

- `campaigns` new nullable column: `branch_id` (store scoping, `FR-M1`).
- `tenant_sender_identity`: `id, tenant_id, channel, sender_name, sender_address_or_number` (`FR-M2`).
- `campaign_webhook_subscriptions`: `id, tenant_id, target_url, events (jsonb), secret` (`FR-M3`).

## API Additions by Phase (illustrative, not exhaustive — finalized per phase)

| Endpoint                                                                                                                    | Phase |
| --------------------------------------------------------------------------------------------------------------------------- | ----- |
| `POST /crm/media/upload`, `GET /crm/media`, `DELETE /crm/media/:id`                                                         | CP-2  |
| `PUT /crm/campaigns/:id` (edit while DRAFT/SCHEDULED, version-checked)                                                      | CP-4  |
| `GET/POST /crm/campaign-templates`                                                                                          | CP-4  |
| `GET /crm/campaigns/:id/history`                                                                                            | CP-4  |
| `POST /crm/campaigns/:id/pause`, `POST /crm/campaigns/:id/resume`                                                           | CP-5  |
| `GET/POST /crm/automation-rules`                                                                                            | CP-5  |
| `POST /webhooks/msg91/dlr`, `POST /webhooks/sendgrid/events`, `POST /webhooks/whatsapp/status` (public, signature-verified) | CP-6  |
| `GET /crm/campaigns/:id/analytics`, `GET /crm/campaigns/compare`                                                            | CP-6  |
| `POST /crm/campaigns/:id/approve`, `POST /crm/campaigns/:id/reject`                                                         | CP-7  |
| `GET/PUT /crm/customers/:id/preferences` (customer preference center)                                                       | CP-7  |
| `GET/POST /crm/webhook-subscriptions`                                                                                       | CP-8  |

## Design Constraints Carried Forward

- Every new table gets `tenant_id`, `created_at`, `updated_at` per the ERP-wide convention already
  established (`ERP_MASTER_SPEC.md` "Emergency Contacts" section: "Always add `tenant_id`, `created_at`,
  `updated_at`, `version`. Use BIGSERIAL PK.").
- State-changing operations continue to write to the outbox in the same transaction, never publish directly
  — consistent with the existing `CAMPAIGN_SENT` event pattern.
- Zod validation, permission checks, and audit logging are required on every new endpoint, matching every
  existing route in `crm.routes.ts`.
