# 07 — Performance Optimization Plan

## 1. Customer 360 — the composed-read page must not become a fan-out-of-death

Customer 360 (Phase 1) is explicitly a composition of `HealthScoringService`,
`ActivityTimelineService`, and reads across sales/accounting/loyalty data. The single biggest
performance risk in this entire roadmap is that page becoming N sequential round-trips.

- All composed reads must be issued **in parallel** (`Promise.all`), not sequentially.
- If p95 latency in testing exceeds an acceptable threshold (validate against this codebase's
  existing page-load expectations — no new number invented here), the fallback is a materialized
  `crm_customer_360_view` refreshed on relevant events (order placed, payment received, ticket
  created) — the same CQRS-projection pattern already used for
  `projection_dashboard_daily`/`projection_customer_balance`/`projection_stock_level`. Build the
  live-composed version first; only add the projection if measurement proves it's needed — don't
  pre-optimize.

## 2. Indexing plan for new tables

Every new table with a list/filter route needs the same index discipline the existing `crm.ts`
tables already show (e.g. `idx_campaigns_tenant_status`, `idx_campaign_recipients_customer`):

| Table                     | Required index                              | Reason                                                                                 |
| ------------------------- | ------------------------------------------- | -------------------------------------------------------------------------------------- |
| `crm_leads`               | `(tenant_id, stage, assigned_to)`           | Kanban board query, rep's own-leads filter                                             |
| `crm_leads`               | `(tenant_id, created_at)`                   | Funnel/velocity reporting                                                              |
| `crm_opportunities`       | `(tenant_id, stage, branch_id)`             | Pipeline board + branch scoping (AR-6)                                                 |
| `crm_opportunities`       | `(tenant_id, expected_close_date)`          | Forecast dashboard                                                                     |
| `crm_tickets`             | `(tenant_id, status, sla_due_at)`           | SLA-breach sweep job, inbox list                                                       |
| `crm_tickets`             | `(tenant_id, customer_id)`                  | Customer 360 timeline join                                                             |
| `crm_conversations`       | `(tenant_id, customer_id, last_message_at)` | Inbox list + Customer 360                                                              |
| `crm_journey_enrollments` | `(journey_id, current_step_id)`             | Scheduler-cron evaluation query, this is the hot path for the automation engine (AR-3) |
| `crm_link_clicks`         | `(campaign_recipient_id)`                   | Attribution join back to `campaignRecipients`                                          |

## 3. AI suite (Phase 3) — batch, not synchronous

Churn prediction, next-best-action, and product recommendations are **batch-scored nightly per
tenant**, cached to `crm_health_scores`/`crm_churn_predictions`/etc., never computed synchronously
on page load. This is stated as a hard requirement, not an optimization to consider — computing a
churn model inline on every Customer 360 page view would make that already-composed page even
slower, compounding the risk in §1.

## 4. Journey/automation scheduler load

`campaignAutomationRules`'s existing scheduler-cron mechanism (reused per AR-3) evaluates rules on a
fixed interval today. Adding journey-step evaluation to the same mechanism multiplies the per-tick
workload by the number of active enrollments — before Phase 2 ships, validate the scheduler-service's
current cron performance headroom (33 existing system cron jobs per `TECH_AUDIT.md` §14) rather than
assuming it scales for free; this is a "measure before Phase 2, not to be discovered in production"
item.

## 5. Campaign send-time performance (existing, unaffected)

No change proposed to `CampaignService`'s existing send-path performance — this roadmap only adds
write-backs for `opened_at`/`clicked_at` via a click-tracking redirect endpoint, which is a small,
independent, high-QPS-tolerant endpoint (a redirect + a fire-and-forget DB write), not a change to
the bulk-send critical path.

## 6. Segmentation query cost

Behavioral/RFM segment operators (Phase 2, Advanced Segmentation Engine) are more expensive than the
existing static-field filters — `crm_segment_membership_cache` exists specifically so dynamic-segment
membership is computed on a nightly refresh, not recalculated on every campaign-send or every
Customer 360 render that needs "is this customer in segment X."

## 7. Portal load profile is a different shape than internal ERP traffic

The Self-Service Portal (Phase 3) is the first customer-facing surface in this codebase — its
traffic pattern (many low-privilege, low-value-per-request calls, potentially bursty around order
status checks) is unlike internal staff usage. Rate-limiting per customer (not just per
tenant/IP) is a performance-protection measure as much as a security one — cross-reference
`06-SECURITY-PLAN.md` §2.3.
