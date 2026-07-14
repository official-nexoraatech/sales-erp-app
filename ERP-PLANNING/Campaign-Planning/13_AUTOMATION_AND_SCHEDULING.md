# 13 — Workflow, Automation & Scheduling Requirements

## Current State

- Scheduling: single-shot `scheduledAt` + 5-minute cron poll (`crm.campaign-dispatch` in
  `apps/scheduler-service/src/jobs/system-jobs.ts`) calling sales-service's dispatch endpoint.
- Automation: exactly one case, birthday greetings, implemented as a **separate** special-cased route
  (`POST /crm/birthday-greetings/send`) that duplicates send/circuit-breaker logic outside
  `CampaignService` entirely — not a "campaign" in the `campaigns` table at all.
- No recurring campaigns, no other triggers, no throttling beyond fixed batch size, no timezone/business-
  hours awareness, no frequency capping.

## Scheduling Requirements

- **Recurring campaigns** (`FR-E1`, `MH-09`): a campaign can define a recurrence rule (daily/weekly/monthly/
  custom cron-like expression) with an optional end date or occurrence count. Each firing creates its own
  `campaign_recipients` batch and its own analytics record (so a "Monday Flash Sale" run 10 times has 10
  trackable sends, not one row mutated repeatedly).
- **Timezone awareness** (`FR-E2`): `scheduledAt` stored UTC; tenant/campaign-level timezone drives display
  and, where per-recipient location data exists, can stagger sends to land in each recipient's local
  business hours.
- **Business-hours/send windows** (`FR-E3`): tenant-configurable quiet hours; a campaign whose computed
  send time falls inside quiet hours is queued to the next valid window rather than sent immediately or
  dropped.
- **Frequency limits** (`FR-E4`, `MH-10`): tenant-configurable cap (e.g. max 2 marketing messages per
  customer per day, max 5 per week) enforced at recipient-resolution time, across _all_ campaigns targeting
  that customer, not just within one campaign.
- **Throttling/queue management** (`FR-E5`, `MH-08`): recipient fan-out moves from in-request
  `Promise.all` batching to a background worker consuming a queue, enabling pause/resume, provider-level
  rate limiting, and removing the HTTP-timeout risk for large segments.

## Automation Requirements

### Trigger Registry Model

A `campaign_automation_rules` concept (tenant-configurable): `{triggerType, enabled, channel, templateId,
sendWindow, conditions}`. Each trigger firing creates a real campaign row (or campaign-recipient entries
against a "virtual" recurring campaign — exact modeling is a CP-5 implementation decision), so automated
sends are visible in the same list/history as manual campaigns, tagged `source: 'AUTOMATION'` (`US-07 AC3`).

### Triggers In Scope (`FR-H1`)

| Trigger                                                                                                 | Fires on                                                                                       |
| ------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| Welcome                                                                                                 | Customer record created                                                                        |
| Birthday                                                                                                | `dateOfBirth` matches today (replaces the special-cased route, folded into the unified engine) |
| Anniversary                                                                                             | Configurable anniversary date field (e.g. first-purchase anniversary) matches today            |
| Post-Purchase Follow-up                                                                                 | N days after an invoice/sale completes                                                         |
| Abandoned Cart                                                                                          | A cart/quotation is left inactive for N hours (requires an existing "cart" or "draft           |
| order" concept in sales-service — confirm exact source event during CP-5 design, since this ERP's sales |
| flow may model this as quotations rather than a literal shopping cart)                                  |
| Loyalty Point Reminder                                                                                  | Loyalty points cross a configurable threshold or are about to expire                           |
| Payment/Dues Reminder                                                                                   | An invoice becomes overdue (existing `overdue-30` segment logic is a reusable                  |
| building block here)                                                                                    |
| Membership Renewal                                                                                      | Membership expiry approaches (requires the membership/tier concept from                        |
| `11_SEGMENTATION_AND_PERSONALIZATION.md`)                                                               |
| Customer Inactivity                                                                                     | No purchase in N days (reuses the existing `no-purchase-60-days` prebuilt segment              |
| logic, generalized to a configurable threshold)                                                         |

### Explicitly Not In Scope (documented, not built)

Inventory-alert-driven marketing triggers and a general-purpose visual workflow/journey builder — see
Non-Goals in `01_VISION_AND_GOALS.md`. The trigger registry is designed so a future phase _could_ add these
without redesigning the engine, but they are not part of this roadmap's deliverables.

## Sequencing Note

CP-5 bundles scheduling-hardening and automation together because both require the same underlying change:
moving dispatch off the 5-minute HTTP-poll/in-request-batch model onto a proper background worker. Doing
this once, for both needs, avoids touching the dispatch path twice (flagged as technical debt in
`02_GAP_ANALYSIS.md`).
