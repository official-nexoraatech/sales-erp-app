# 01 — Vision & Product Goals

## Vision Statement

Evolve the ERP's Campaign module from a single-channel broadcast tool into a **reusable, omnichannel
Campaign Management platform** — good enough to run a Clothing retailer's full marketing lifecycle
(planning → targeting → execution → tracking → optimization → reporting) today, and architected so that
adding a new industry (Retail, Wholesale, Manufacturing, Healthcare, Hospitality, Distribution) or a new
channel never requires redesigning the core engine — only configuring it.

## Why Now

- The module is currently used for real customer messaging (birthday greetings, basic promos) but every
  session's QA passes have found it "worked first try" only because expectations were low — see
  `qa_crm_live_e2e_2026_07_12.md`. As the business scales past a single channel and a handful of prebuilt
  segments, the gaps in `02_GAP_ANALYSIS.md` become customer-facing failures (no delivery confirmation, no
  edit-after-create, no automation, no compliance/consent tracking).
- Competing CRM/ERP products treat campaign management as a first-class module with lifecycle, analytics,
  and automation. A clothing ERP that wants to retain SMB/mid-market customers needs parity on the
  marketing side, not just the transactional (invoicing/inventory) side.

## Product Goals

1. **Omnichannel by architecture, not by hardcoding.** Adding a channel (e.g. Telegram) should mean writing
   one new provider adapter, not touching `CampaignService`, the schema, or the UI shell.
2. **Full lifecycle, not fire-and-forget.** Draft → Approval (optional) → Scheduled → Running → Paused →
   Completed → Archived, with edit support while still safe (see `09_CAMPAIGN_LIFECYCLE_AND_WORKFLOW.md`).
3. **Targeting that reflects real customer behavior**, not just 6 static SQL segments — purchase history,
   preferences, RFM/CLV, geography, and custom attributes, without needing a data warehouse.
4. **Automation for the campaigns that shouldn't need a human to click "send"** — birthday, win-back,
   abandoned cart, post-purchase, membership renewal.
5. **Real analytics**, not just a count of `SENT`. Delivery confirmation, engagement, conversion/revenue
   attribution, and channel/campaign comparison.
6. **Industry-agnostic core, clothing-specific defaults.** Campaign types, segment attributes, and
   personalization tokens are data-driven/configurable per tenant vertical, not hardcoded enums.
7. **No regression.** Every existing capability (opt-out enforcement, circuit-breaker delivery, CSV export,
   the live E2E test) keeps working through every phase.

## Non-Goals (explicitly out of scope for this initiative)

- Building a full marketing-automation visual workflow designer (drag-and-drop journey builder) in the
  first pass — CP-5 delivers trigger-based automation for a fixed set of well-known triggers
  (birthday/anniversary/abandoned-cart/win-back/post-purchase/membership-renewal), not a general-purpose
  workflow canvas. That is a candidate for a future phase, not this roadmap.
- Building native mobile push SDKs — Web Push and a generic Push provider adapter are in scope; native
  iOS/Android SDK integration is not, since neither app exists yet in this repo.
- Multi-tenant white-labeling of the _entire_ ERP (branding is already partially covered by
  `erp_ui_impl_tenant_branding_2026_07_08`) — this initiative only covers campaign-specific
  white-label needs (sender name/domain per tenant), not full white-label productization.

## Success Metrics

| Metric                    | Today                                           | Target after full roadmap                                                                |
| ------------------------- | ----------------------------------------------- | ---------------------------------------------------------------------------------------- |
| Channels supported        | 4 (SMS, WhatsApp, Email, In-App)                | 4 wired + pluggable adapter for any new channel in < 1 day of work                       |
| Segment targeting fields  | 12 whitelisted columns, single-rule UI          | 30+ fields incl. behavioral/RFM, multi-rule UI, saved dynamic segments                   |
| Campaign lifecycle states | 6 (no approval, no pause)                       | Full lifecycle incl. approval gate and pause/resume                                      |
| Delivery confirmation     | None (schema placeholder only)                  | Real webhook-driven delivered/opened/clicked tracking for every channel that supports it |
| Automation triggers       | 1 (birthday, hardcoded outside CampaignService) | 6+ triggers unified under one automation engine                                          |
| Analytics                 | Sent/failed/pending counts                      | Funnel, revenue attribution, ROI, channel/campaign comparison, A/B test results          |
| E2E test coverage         | 1 happy-path spec                               | Full suite per `24_PLAYWRIGHT_TEST_PLAN.md`                                              |

## Guiding Principle

**Extend the existing engine.** `CampaignService`, `SegmentService`, the `campaigns`/`campaign_recipients`/
`customer_segments` tables, and the notification-service provider pattern are kept and grown, not replaced.
See `19_MIGRATION_AND_BACKWARD_COMPATIBILITY.md` for the specific compatibility contract.
