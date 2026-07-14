# 00 — Current State Assessment

Verified by direct codebase inspection on 2026-07-14. All file paths are repo-relative. Re-verify line
numbers before relying on them if this document is more than a few weeks old — code moves.

## 1. Where the module lives

There is **no dedicated marketing/CRM microservice**. Campaigns, segments, and business-season/festival
promotions all live inside `apps/sales-service`, which also owns customers and invoicing. Actual message
delivery is delegated to `apps/notification-service`, the shared transactional-notification engine used by
the rest of the ERP. Scheduling execution is delegated to `apps/scheduler-service`'s generic cron registry.

This means the Campaign module today is **three services collaborating with no message broker between
them** — sales-service computes recipients and renders messages, calls notification-service synchronously
over HTTP for each recipient, and scheduler-service just polls a dispatch endpoint every 5 minutes.

## 2. Backend inventory

| File                                                         | Role                                                                                                |
| ------------------------------------------------------------ | --------------------------------------------------------------------------------------------------- |
| `apps/sales-service/src/domain/CampaignService.ts`           | Campaign engine: recipient resolution, preview, send, schedule, cancel, stats, recipient drill-down |
| `apps/sales-service/src/domain/SegmentService.ts`            | Segment resolution (prebuilt + custom), preview, CSV export                                         |
| `apps/sales-service/src/api/crm.routes.ts`                   | User-facing HTTP routes for campaigns, segments, business seasons                                   |
| `apps/sales-service/src/api/internal.routes.ts`              | Internal (`x-internal-key`) routes: scheduled-dispatch poll, birthday-greeting automation           |
| `apps/scheduler-service/src/jobs/system-jobs.ts` (~L819-847) | Cron job `crm.campaign-dispatch` (`*/5 * * * *`), calls sales-service's dispatch endpoint           |
| `apps/notification-service/src/domain/NotificationEngine.ts` | Actual message delivery: `sendRaw()`, retry, channel providers                                      |
| `apps/notification-service/src/api/notification.routes.ts`   | `POST /notifications/send-raw-internal`, SSE stream for IN_APP                                      |

### Campaign send flow, today

1. User (or the 5-minute cron poll) triggers `CampaignService.send()`.
2. Recipients resolved from either a saved segment (`SegmentService.resolveWhere`) or an explicit
   `customerIds[]`, filtered by channel-specific opt-out flags (SMS/WhatsApp/Email only — `IN_APP` has no
   opt-out gate).
3. Recipients are processed in **fixed batches of 25** via `Promise.all` — in-request bounded concurrency,
   **not a queue or worker pool**. This runs inside the HTTP request (manual send) or inside the cron job's
   HTTP call (scheduled send) — there is no background job runner for the fan-out itself.
4. Each recipient: insert `campaign_recipients` row (`PENDING`) → call notification-service's
   `send-raw-internal` through a circuit breaker (opens after 5 failures/10s) → update row to `SENT`/`FAILED`.
5. Campaign row updated to `SENT` with `sentCount`/`failedCount`; `CAMPAIGN_SENT` event published; audit log
   written.

### Scheduling, today

Single-shot only. `campaigns.scheduledAt` + `status='SCHEDULED'`; the scheduler-service cron polls every 5
minutes for due campaigns and calls the same synchronous `send()`. No recurring-campaign concept exists —
each row is one campaign, one send.

### What does NOT exist in the backend (confirmed by search, not inference)

- No recurring/repeating campaign concept (only generic cron _job_ scheduling infra, unrelated to campaigns).
- No A/B testing / variant / split-audience logic anywhere in the codebase.
- No approval workflow for campaigns (a generic `tenant-service` approval router exists but is unrelated —
  any user with `CRM_CAMPAIGN_SEND` can send a `DRAFT` campaign directly).
- No delivery-status webhook receiver from MSG91/SendGrid/Meta — `campaigns.deliveredCount` and
  `campaign_recipients.status = 'DELIVERED'` are schema placeholders nothing ever sets.
- No campaign-specific reusable template entity (notification-service has `notificationTemplates` for
  _transactional_ events like "invoice created", not for campaign broadcast authoring).
- No media/attachment support on campaigns at all.
- No optimistic-locking use of `campaigns.version` on updates (column exists, unused).
- No campaign edit-after-creation — campaigns are create-only.

## 3. Database schema, today

Defined in `packages/db-client/src/schema/crm.ts`, materialized by
`packages/db-client/migrations/0005_phase9_crm.sql` (+ `0017_es18_crm_gaps.sql` for customer opt-out flags).

### `campaigns`

`id, tenant_id, name, segment_id (nullable, no FK constraint), customer_ids (jsonb number[], nullable),
channel ('SMS'|'WHATSAPP'|'EMAIL'|'IN_APP'), message_template (text), status ('DRAFT'|'SCHEDULED'|'SENDING'
|'SENT'|'CANCELLED'|'FAILED'), scheduled_at, sent_at, total_recipients, sent_count, delivered_count,
failed_count, cancelled_at, created_by, created_at, updated_at, version`.
Indexes: `(tenant_id, status, created_at)`, `(scheduled_at, status)`.

### `campaign_recipients`

`id, tenant_id, campaign_id, customer_id, status ('PENDING'|'SENT'|'DELIVERED'|'FAILED'),
notification_log_id (nullable, no FK), error_message, sent_at, created_at`.
Indexes: `(campaign_id, status)`, `(customer_id, tenant_id)`.

### `customer_segments`

`id, tenant_id, name, code, is_system, filter_definition (jsonb: {rules[], logic}), description, created_by,
created_at, updated_at`. Unique `(tenant_id, code)`.

### Adjacent, not campaign-specific

`customer_interactions` (visit/call/complaint log), `business_seasons` (festival discount-multiplier
planner — a _promotions_ feature, not messaging).

## 4. Frontend inventory

All under `apps/web-frontend/src/pages/crm/`, routed at `/crm/campaigns` and `/crm/campaigns/new`
(`PERMISSIONS.CRM_VIEW` / `CRM_CAMPAIGN_CREATE`), linked from the sidebar (`lib/navigation.ts`).

| File                                     | What it does                                                                                                                                                                                                                                                                                             |
| ---------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `CampaignsPage.tsx`                      | List, status-filter pills, per-row "Schedule"/"Send Now"/"Cancel" actions, inline recipient drill-down. No pagination, no charts, no A/B/approval UI.                                                                                                                                                    |
| `CampaignFormPage.tsx`                   | Create-only form: name, channel (button group), single segment `<select>` (no multi-segment, no explicit-customer picker despite API support), message textarea with `{{var}}` insertion buttons, optional schedule datetime, "Preview Recipients" button. No media upload, no reusable template picker. |
| `SegmentsPage.tsx`                       | 6 hardcoded prebuilt segments + saved custom segments list, CSV export, health-score summary strip.                                                                                                                                                                                                      |
| `SegmentFormPage.tsx`                    | Create-only, **single filter rule only** — backend supports an array of rules with AND/OR logic, but the UI never builds more than one.                                                                                                                                                                  |
| `apps/web-frontend/e2e/live-crm.spec.ts` | The one existing E2E: create segment → preview → create campaign → preview recipients → send → confirm SENT.                                                                                                                                                                                             |

## 5. Segmentation, today

Segments are computed on read against the `customers` table (no materialized membership table).

- **6 prebuilt segments** (hardcoded SQL in `SegmentService.prebuiltWhere`): no-purchase-60-days, gold-tier
  (loyaltyPoints ≥ 5000), high-value (avg invoice > threshold), overdue-30, birthdays-this-month,
  new-customers-this-month.
- **Custom segments**: jsonb rule list, but the field whitelist (`FIELD_COLUMNS`) is only 12 columns:
  `customerType, status, creditLimit, loyaltyPoints, openingBalance, healthSegment, healthScore, createdAt,
dateOfBirth, displayName, phone, email`. Operators: `eq, neq, gt, gte, lt, lte, contains`.
- No behavioral targeting (purchase history beyond the 3 prebuilt segments), no RFM/CLV scoring beyond the
  existing `healthScore`, no geographic targeting, no brand/category/product preference targeting, no
  store/salesperson-specific targeting, no custom-attribute targeting.

## 6. Channel/provider reality

All three external channels are wired to **real third-party HTTP APIs** with real retry logic (not mocked),
via `apps/notification-service`:

- **SMS** → MSG91 Flow API. Defaults to literal `'test_key'`/`'test_template'` if env unset.
- **Email** → SendGrid API. Defaults to `'test_key'` / `noreply@erp.local`.
- **WhatsApp** → Meta WhatsApp Cloud API. Defaults to empty-string credentials (hard-fails without config).
- **IN_APP** → persisted `notification_log` row + SSE stream (`GET /notifications/stream`).

No other channel (Push, Web Push, Telegram, Facebook/Instagram/Messenger, Google Business Messages, Apple
Business Chat, QR, print, digital signage, third-party API/webhook) exists in any form today.

## 7. Analytics, today

`GET /crm/campaigns/:id/stats` → `{total, sent, delivered, failed, pending}` counts only (delivered is
always 0 in practice — nothing increments it). `GET /crm/campaigns/:id/recipients` → per-recipient table.
No dashboard, no trend charts, no open/click/conversion/revenue/ROI tracking, no channel or campaign
comparison, no funnel analysis, no `report-service` integration for campaigns at all.

## 8. What already works well (keep, don't rebuild)

- The `optOutCondition()` gate is real and correctly enforced per channel at send time.
- The circuit breaker + retry-with-backoff pattern in notification-service is solid and reusable for new
  channels.
- Recipient-level audit trail (`campaign_recipients` + `error_message`) is a good foundation for analytics —
  it just needs more columns and a delivery-webhook to become real analytics.
- Segment `filter_definition` jsonb + rule/logic shape is a reasonable foundation to extend (add fields and
  operators) rather than replace.
- CSV export and segment preview/count-before-send are good UX patterns to carry forward.
- The existing E2E test (`live-crm.spec.ts`) is a real, working baseline — extend it, don't discard it.

## 9. Bottom line

The current module is a **functional single-shot broadcast tool**: one channel per campaign, one segment or
explicit list, immediate or single scheduled send, minimal count-based reporting, no editing, no approval,
no automation, no analytics beyond counts. It is a solid _foundation_ (real opt-out enforcement, real
provider integrations, real audit trail) but has none of the lifecycle, targeting depth, personalization,
scheduling sophistication, or analytics expected of an enterprise CRM campaign platform. See
`02_GAP_ANALYSIS.md` for the full gap breakdown.
