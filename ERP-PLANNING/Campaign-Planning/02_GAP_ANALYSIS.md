# 02 — Gap Analysis

Current state is `00_CURRENT_STATE_ASSESSMENT.md`. This document lists every gap found, organized by the
scope areas from the original request, each tagged with the backlog priority from `07_FEATURE_BACKLOG.md`
(M=Must, S=Should, N=Nice) and the roadmap phase that closes it.

## Campaign Creation & Editing

| Gap                                                                                    | Priority | Phase |
| -------------------------------------------------------------------------------------- | -------- | ----- |
| Campaigns cannot be edited after creation at all                                       | M        | CP-4  |
| No draft autosave — a half-filled form is lost on navigation/crash                     | S        | CP-4  |
| No approval workflow — any `CRM_CAMPAIGN_SEND` holder can send a `DRAFT` immediately   | M        | CP-7  |
| No reusable campaign templates (only per-campaign ad-hoc message text)                 | M        | CP-4  |
| No multi-step/wizard flow — one long form for name+channel+audience+message+schedule   | S        | CP-4  |
| No campaign "type" taxonomy (promo/loyalty/coupon/birthday/...) — just a channel field | M        | CP-4  |
| No conditional/personalized content blocks (same message to everyone in the segment)   | S        | CP-3  |
| No multi-language content support                                                      | S        | CP-4  |

## Campaign Execution & Delivery

| Gap                                                                                                                           | Priority | Phase |
| ----------------------------------------------------------------------------------------------------------------------------- | -------- | ----- |
| Send fan-out is in-request batches of 25, not a real queue/worker — a large segment blocks the HTTP request and risks timeout | M        | CP-5  |
| No pause/resume mid-send                                                                                                      | S        | CP-5  |
| No throttling/rate-limiting beyond the fixed batch size (no per-tenant or per-provider rate caps)                             | S        | CP-5  |
| No retry-with-backoff visible to the user for partially-failed campaigns (must be fully re-triggered)                         | S        | CP-5  |

## Scheduling

| Gap                                                                                              | Priority | Phase |
| ------------------------------------------------------------------------------------------------ | -------- | ----- |
| No recurring campaigns (birthday/seasonal must be re-created each time)                          | M        | CP-5  |
| No timezone-aware scheduling (single `scheduledAt` timestamp, no per-recipient timezone)         | S        | CP-5  |
| No business-hours / send-window enforcement (a campaign can dispatch at 3am)                     | S        | CP-5  |
| No frequency capping (a customer could receive 5 campaigns same day, no de-dup across campaigns) | M        | CP-5  |
| 5-minute poll granularity is a scalability and precision limit as campaign volume grows          | S        | CP-5  |

## Message Templates

| Gap                                                                                                                  | Priority | Phase |
| -------------------------------------------------------------------------------------------------------------------- | -------- | ----- |
| No named/reusable/versioned templates for campaigns (only transactional-event templates exist, in a different table) | M        | CP-4  |
| No template categorization or search                                                                                 | N        | CP-4  |
| No preview-per-channel rendering (SMS vs. WhatsApp vs. Email render differently; only one generic preview exists)    | S        | CP-4  |

## Customer Segmentation / Recipient Selection

| Gap                                                                                                             | Priority | Phase     |
| --------------------------------------------------------------------------------------------------------------- | -------- | --------- |
| Custom-segment UI only supports a single filter rule despite the backend supporting rule arrays + AND/OR        | M        | CP-3      |
| Only 12 whitelisted targeting fields, no behavioral/purchase/preference/brand/category targeting                | M        | CP-3      |
| No geographic targeting                                                                                         | S        | CP-3      |
| No store-specific or salesperson-specific targeting                                                             | S        | CP-3      |
| No "save this ad-hoc filter as a segment" flow from the campaign builder                                        | S        | CP-3      |
| No segment overlap/de-dup preview when a campaign targets a segment + explicit list together                    | N        | CP-3      |
| Segments computed on every read (no caching) — fine at current scale, a scalability watch-item at higher volume | N        | CP-6/CP-8 |

## Campaign Preview

| Gap                                                                                                                                                    | Priority | Phase     |
| ------------------------------------------------------------------------------------------------------------------------------------------------------ | -------- | --------- |
| Preview renders only the first matched recipient's message — no sampling across the segment to catch personalization edge cases (missing fields, etc.) | S        | CP-4      |
| No visual/rendered preview for rich channels (Email HTML, WhatsApp media) since no media support exists yet                                            | M        | CP-2/CP-4 |

## Reporting / Analytics

| Gap                                                                                | Priority | Phase |
| ---------------------------------------------------------------------------------- | -------- | ----- |
| No delivery-status webhook receivers — `deliveredCount`/`DELIVERED` never populate | M        | CP-6  |
| No open/click/conversion tracking of any kind                                      | M        | CP-6  |
| No revenue attribution or ROI                                                      | S        | CP-6  |
| No dashboard, trend chart, or channel/campaign comparison view                     | M        | CP-6  |
| No A/B testing (subject/message/image/CTA/audience/send-time)                      | S        | CP-6  |
| No funnel analysis                                                                 | N        | CP-6  |

## Permissions

| Gap                                                                                                                                                                    | Priority | Phase |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- | ----- |
| Only coarse `CRM_VIEW` / `CRM_CAMPAIGN_CREATE` / `CRM_CAMPAIGN_SEND` — no separation between "can create draft" vs "can approve" vs "can send" vs "can view analytics" | M        | CP-7  |
| No per-campaign collaboration (comments, internal notes, multi-user co-editing awareness)                                                                              | N        | CP-7  |

## Audit History

| Gap                                                                                                                | Priority | Phase |
| ------------------------------------------------------------------------------------------------------------------ | -------- | ----- |
| Send/schedule/cancel actions are audit-logged, but there's no visible audit-history UI on the campaign detail view | S        | CP-7  |
| No change history for edits (moot today since campaigns aren't editable, but required once CP-4 ships editing)     | M        | CP-7  |

## Integration Capabilities

| Gap                                                                                                                                                               | Priority | Phase |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- | ----- |
| No abstraction boundary that makes adding a channel provider a config-only change — currently `NotificationEngine` has channel logic inline (`deliverViaChannel`) | M        | CP-2  |
| No webhooks/outbound integration for third-party marketing tools                                                                                                  | N        | CP-8  |
| No public API surface for campaigns intended for external/CRM integration (current routes are UI-oriented)                                                        | N        | CP-8  |

## Performance & Scalability

| Gap                                                                                                            | Priority | Phase |
| -------------------------------------------------------------------------------------------------------------- | -------- | ----- |
| Fixed batch-of-25 synchronous fan-out won't scale past a few thousand recipients without HTTP timeouts         | M        | CP-5  |
| No materialized segment membership — recompute cost grows with customer table size and rule complexity         | N        | CP-8  |
| Single shared `campaigns`/`campaign_recipients` tables with no partitioning strategy for very high send volume | N        | CP-8  |

## User Experience

| Gap                                                                                                                    | Priority | Phase     |
| ---------------------------------------------------------------------------------------------------------------------- | -------- | --------- |
| List page has no pagination — loads the full campaign list                                                             | S        | CP-4      |
| No campaign-level dashboard/analytics visualization anywhere in the UI                                                 | M        | CP-6      |
| Segment builder UX (single rule, raw dropdowns) doesn't communicate the AND/OR model that the backend already supports | M        | CP-3      |
| No media/asset picker anywhere in the campaign flow                                                                    | M        | CP-2/CP-4 |

## Architecture / Technical Debt (not visible to end users, but blocks the above)

- `campaigns.version` column exists, unused for optimistic locking — becomes load-bearing once editing ships
  (CP-4).
- `campaigns.segment_id` and `campaign_recipients.notification_log_id` are informal references with no DB
  FK constraint — fine at current integrity risk level, worth tightening when schema changes anyway (CP-1).
- Birthday-greeting automation (`internal.routes.ts` `POST /crm/birthday-greetings/send`) duplicates
  send/circuit-breaker logic outside `CampaignService` instead of being a triggered campaign — should be
  folded into the automation engine (CP-5) instead of remaining a one-off.
- `apps/scheduler-service`'s 5-minute poll calling sales-service's dispatch endpoint over plain HTTP is
  workable at current scale but is the reason precision/timezone/business-hours scheduling is hard to add
  incrementally — CP-5 revisits this dispatch path together with recurring-campaign support so it isn't
  touched twice.

## Reusable Assets Identified (carry forward, do not rebuild)

- Circuit breaker + retry/backoff pattern in `NotificationEngine`.
- Opt-out gating logic (`optOutCondition`).
- Segment `filter_definition` jsonb shape (rules[] + logic) — extend the field whitelist and UI, don't
  redesign the storage shape.
- CSV export pattern for segments — reusable for campaign recipient/analytics export.
- `live-crm.spec.ts` E2E baseline.

## Opportunities for Future Extensibility (beyond this roadmap, worth designing for now)

- A generic "trigger + condition + action" automation model (CP-5) is the natural seed of a future visual
  journey builder, if ever prioritized.
- A channel-provider adapter interface (CP-2) is the natural seed of a plugin marketplace for
  industry-specific channels (e.g. digital signage for Retail, patient-portal messaging for Healthcare).
- Campaign "type" as tenant-configurable metadata (CP-4) is what makes the platform industry-agnostic
  without a schema change per vertical.
