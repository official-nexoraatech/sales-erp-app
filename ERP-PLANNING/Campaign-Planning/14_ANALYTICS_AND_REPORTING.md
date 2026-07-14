# 14 — Campaign Analytics & Reporting Requirements

## Current State

`GET /crm/campaigns/:id/stats` returns `{total, sent, delivered, failed, pending}` — `delivered` is always 0
in practice since nothing sets it. `GET /crm/campaigns/:id/recipients` gives a per-recipient table. No
dashboard, no engagement metrics, no attribution, no comparison, no A/B testing, no `report-service`
integration.

## Metrics Model (target)

### Delivery Metrics (`FR-I1`, `MH-02`)

- Requires webhook receivers from each provider that supports delivery callbacks: MSG91 (SMS DLR), SendGrid
  (Email events webhook), Meta WhatsApp Cloud API (message status webhook).
- Each receiver: verifies provider signature/HMAC (`NFR-14`), is idempotent (`NFR-09`), maps the provider's
  status vocabulary onto `campaign_recipients.status` (`DELIVERED`/`FAILED`/`BOUNCED`), and rolls up into
  `campaigns.deliveredCount`/`failedCount`.
- Bounce classification (hard vs. soft) matters for Email/SMS list hygiene — a hard bounce should be a
  strong signal to flag the customer record, not just the campaign.

### Engagement Metrics (`FR-I2`, `MH-15`)

- **Open rate**: Email via tracking pixel; WhatsApp via read-receipt webhook where available. SMS has no
  open concept.
- **Click-through rate**: link-wrapping — campaign links are rewritten to a redirect-and-record endpoint
  before going out, regardless of channel.
- Per-recipient and per-campaign rollups, consistent with the existing recipient-level granularity already
  established by `campaign_recipients`.

### Conversion & Revenue Attribution (`FR-I3`, `SH-10`)

- A campaign can be linked to a coupon code and/or tracked link.
- Orders placed using that coupon code, or preceded by a click on that tracked link within a configurable
  attribution window (e.g. 7 days), are attributed to the campaign.
- Reported as: redemption count, attributed revenue, and simple ROI (`attributed revenue` vs. `estimated
provider send cost` from `BR-16`).

### A/B Testing (`FR-I5`, `SH-09`)

- A campaign can define 2+ content variants (message text, subject line, image, CTA, or send-time).
- Audience is split (configurable ratio, e.g. 50/50 or 10/10/80-winner-takes-rest for send-time
  optimization).
- Success metric configurable per test (delivery rate, click rate, conversion rate — reuses the metrics
  above rather than inventing a separate measurement path).
- Winner is reported, not auto-selected/auto-scaled in this roadmap (auto-scaling the winner is a candidate
  future enhancement, not required for launch).

## Reporting Surfaces (`FR-I4`, `MH-14`)

- **Campaign Detail → Analytics tab**: funnel (sent → delivered → opened → clicked → converted), per-channel
  breakdown if the campaign is multi-channel.
- **Cross-campaign comparison**: filterable by date range, channel, campaign type — answers "which channel/
  type performs best" (`US-08`).
- **Segment health tie-in**: reuse the existing health-score summary strip pattern already on
  `SegmentsPage.tsx` as a UI precedent for how to present aggregate numbers concisely.
- Export: reuse the existing CSV export pattern for analytics data, not a new export mechanism.

## Data Model Implication

Analytics requires new columns/tables beyond today's `campaigns`/`campaign_recipients` (webhook event log,
click/open events, A/B variant assignment, coupon/attribution link) — detailed in
`17_DATA_MODEL_AND_API_DESIGN.md`. None of this requires changing the existing columns' meaning, only
additive extension (`NFR-21`).

## Explicitly Deferred

Deep funnel analysis beyond the basic stage funnel above, and predictive/ML-based send-time optimization,
are `Nice to Have`/future work (`NH-03`) — not required for the platform to be considered "enterprise-grade
omnichannel," which is achievable with the metrics above.
