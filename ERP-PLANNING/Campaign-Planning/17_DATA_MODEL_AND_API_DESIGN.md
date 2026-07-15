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

### CP-2 (Channel Abstraction + Media) — DEVIATION FROM ORIGINAL PLAN, see CP-2 completion report

- **No new `campaign_media_assets`/`campaign_media_links` tables were created.** This ERP already has a
  generic, tenant-scoped, entity-agnostic attachment system (`document_attachments` table +
  `PlatformAttachments` class in `packages/platform-sdk`, backed by real object storage/MinIO), already used
  by purchase-service (PURCHASE_ORDER/GRN attachments) and hr-service (employee documents) via a shared
  `entityType`/`entityId` polymorphic-association pattern. CP-2 extended sales-service's existing
  `attachment.routes.ts` (previously hardcoded to `entityType === 'INVOICE'` only) to also accept
  `entityType: 'CAMPAIGN'`, with its own view/write permission mapping (`CRM_VIEW`/`CRM_CAMPAIGN_CREATE`),
  matching purchase-service's established multi-entity-type pattern exactly. Uploads go through the same
  `POST /attachments` endpoint every other module uses; storage/download/delete are already solved, and no
  new migration was needed at all.
- **Scope reduction, tracked not dropped:** the original plan's "reuse an asset across many campaigns" (a
  many-to-many library) isn't modeled by `document_attachments` (it's a 1-campaign-to-N-attachments
  relationship, matching how PURCHASE_ORDER/GRN attachments already work). Cross-campaign asset reuse as a
  browsable library remains a legitimate future enhancement — added to `07_FEATURE_BACKLOG.md` as a
  Nice-to-Have rather than silently dropped.
- **Channel-aware media validation** (`FR-G2`) is real: `CampaignService.validateMediaForChannel(channel,
mimeType, fileSize)` rejects media entirely for SMS/IN_APP and enforces per-type size limits (image 5MB,
  video 16MB, document 100MB — the image/video limits mirror Meta's published WhatsApp Cloud API limits) for
  EMAIL/WHATSAPP. The upload route looks up the target campaign's channel and calls this before accepting
  the file.
- `channel_provider_config` (tenant-configurable sender identity) was **not** built in CP-2 — deferred to
  CP-8 as originally planned; CP-2 focused on the adapter interface + media, not sender-identity
  configuration, which has no dependents until CP-8.

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
- `tenant_communication_settings.approval_required` (bool, default false) — reused the existing CP-5 table
  rather than a new one-row settings table, matching that table's existing per-tenant-singleton shape
  (`frequency_cap` lives there too).

**CP-7 deviation, documented per this doc's running convention:** the customer preference-center
**API and UI were not built** this phase — only the schema above shipped. The phase prompt for CP-7 asked to
flag actual India DPDP Act / TRAI applicability to the user before finalizing the consent-model shape,
given real legal weight (`R9`). That confirmation has not happened as of CP-7's completion (see
`phase-completions/CP-7_COMPLETION.md` section 12) — building `GET/PUT /crm/customers/:id/preferences` and
an unsubscribe-link mechanism on a schema that may need to change once that review happens was judged
higher-risk than deferring. `GET/PUT /crm/customers/:id/preferences` below is retained as the planned shape
but is **not yet implemented**.

### CP-8 (Enterprise Scale-out)

- `campaigns` new nullable column: `branch_id` (store scoping, `FR-M1`).
- `tenant_sender_identity`: `id, tenant_id, channel, sender_name, sender_address_or_number` (`FR-M2`).
- `campaign_webhook_subscriptions`: `id, tenant_id, target_url, events (jsonb), secret` (`FR-M3`).
- `campaign_webhook_deliveries` (not in the original plan, added during implementation): `id, tenant_id,
subscription_id, event_type, campaign_id, payload (jsonb), status, attempt_count, last_error, created_at,
sent_at` — the per-subscriber delivery queue/log `WebhookDispatchWorker` polls, modeled on
  event-service's `OutboxRelayWorker` (`FOR UPDATE SKIP LOCKED`, retry/dead-letter). Needed because
  `outbox_events`/Kafka doesn't cleanly express per-subscription HTTP retry state.

**CP-8 deviation, documented per this doc's running convention:** sender-identity override (`FR-M2`) is
only wired to real outbound delivery for **EMAIL** — SMS (MSG91) and WhatsApp (Meta) sender identity
requires provider-side business/DLT registration that a database row can't substitute for; both channels
accept and store a configured identity but currently ignore it at send time. See
`phase-completions/CP-8_COMPLETION.md` section 13. Additional channel adapters (`FR-M4`-adjacent, originally
CP-8 scope item 4) and segment-membership caching/partitioning (scope item 5) were **not started** —
both are gated by the phase's own rules on explicit user confirmation, which did not happen this session;
see the CP-8 completion report section 12 for the specific open questions.

## API Additions by Phase (illustrative, not exhaustive — finalized per phase)

| Endpoint                                                                                                                           | Phase |
| ---------------------------------------------------------------------------------------------------------------------------------- | ----- |
| `POST /crm/media/upload`, `GET /crm/media`, `DELETE /crm/media/:id`                                                                | CP-2  |
| `PUT /crm/campaigns/:id` (edit while DRAFT/SCHEDULED, version-checked)                                                             | CP-4  |
| `GET/POST /crm/campaign-templates`                                                                                                 | CP-4  |
| `GET /crm/campaigns/:id/history`                                                                                                   | CP-4  |
| `POST /crm/campaigns/:id/pause`, `POST /crm/campaigns/:id/resume`                                                                  | CP-5  |
| `GET/POST /crm/automation-rules`                                                                                                   | CP-5  |
| `POST /webhooks/msg91/dlr`, `POST /webhooks/sendgrid/events`, `POST /webhooks/whatsapp/status` (public, signature-verified)        | CP-6  |
| `GET /crm/campaigns/:id/analytics`, `GET /crm/campaigns/compare`                                                                   | CP-6  |
| `POST /crm/campaigns/:id/submit-for-approval`, `POST /crm/campaigns/:id/approve`, `POST /crm/campaigns/:id/reject`                 | CP-7  |
| `GET/POST /crm/campaigns/:id/comments`                                                                                             | CP-7  |
| `GET/PUT /crm/customers/:id/preferences` (customer preference center) — **planned, not yet implemented, see deviation note above** | CP-7  |
| `GET/PUT /crm/sender-identity`                                                                                                     | CP-8  |
| `GET/POST /crm/webhook-subscriptions`, `PUT/DELETE /crm/webhook-subscriptions/:id`                                                 | CP-8  |

## Design Constraints Carried Forward

- Every new table gets `tenant_id`, `created_at`, `updated_at` per the ERP-wide convention already
  established (`ERP_MASTER_SPEC.md` "Emergency Contacts" section: "Always add `tenant_id`, `created_at`,
  `updated_at`, `version`. Use BIGSERIAL PK.").
- State-changing operations continue to write to the outbox in the same transaction, never publish directly
  — consistent with the existing `CAMPAIGN_SENT` event pattern.
- Zod validation, permission checks, and audit logging are required on every new endpoint, matching every
  existing route in `crm.routes.ts`.
