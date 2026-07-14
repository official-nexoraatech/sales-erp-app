Copy everything below the line into the first message of a new Claude Code session.

---

I'm starting **Phase CP-6: Analytics & A/B Testing** of the Campaign Management Platform initiative. This
is phase 6 of 9. **CP-2 and CP-5 must both be complete** — check `phase-completions/CP-2_COMPLETION.md` and
`CP-5_COMPLETION.md`.

Read in this order:

1. `ERP-PLANNING/Campaign-Planning/README.md`
2. `ERP-PLANNING/Campaign-Planning/00_CURRENT_STATE_ASSESSMENT.md` (section 7, analytics)
3. `ERP-PLANNING/Campaign-Planning/14_ANALYTICS_AND_REPORTING.md`
4. `ERP-PLANNING/Campaign-Planning/16_INTEGRATION_REQUIREMENTS.md`
5. `ERP-PLANNING/Campaign-Planning/17_DATA_MODEL_AND_API_DESIGN.md` (CP-6 section)
6. `ERP-PLANNING/Campaign-Planning/20_RISK_ASSESSMENT.md` (R3)
7. `phase-completions/CP-2_COMPLETION.md`, `CP-5_COMPLETION.md`

## Goal for This Phase

Make campaigns measurable: real delivery confirmation, engagement tracking, attribution, comparison
dashboards, and A/B testing.

## Scope

1. **Delivery-status webhook receivers** for MSG91 (SMS DLR), SendGrid (Email events), Meta WhatsApp (status
   webhook). Each **must** verify provider signature/HMAC and be idempotent (dedup on `(provider,
provider_event_id)`) — this is a hard security requirement (R3 in `20_RISK_ASSESSMENT.md`), not optional
   hardening to skip under time pressure.
2. **Engagement tracking**: open pixel (Email), click-through link-wrapping (all channels with links),
   read-receipt mapping where the provider supports it (WhatsApp).
3. **Attribution**: `campaign_attribution_links` (coupon code / tracked link + attribution window), rolled
   up into redemption count and attributed revenue/ROI.
4. **Campaign Detail → Analytics tab**: funnel view (sent → delivered → opened → clicked → converted).
5. **Cross-campaign comparison view**: filterable by channel/type/date range.
6. **A/B testing**: `campaign_ab_variants`, audience split, configurable success metric, winner reporting
   (report only — do not auto-scale the winner in this phase).

## Rules

- Webhook receivers are public-facing — never trust a client-supplied tenant/campaign ID without verifying
  it against the webhook's own signed payload.
- No secrets (webhook signing keys, provider tokens) in logs.
- `apps/web-frontend/e2e/live-crm.spec.ts` must still pass.
- Reuse this ERP's existing response-envelope and permission-check conventions for the new analytics
  endpoints.

## Definition of Done

See `ERP-PLANNING/Campaign-Planning/22_DEFINITION_OF_DONE_AND_RELEASE_CHECKLIST.md`.

## When Done

Generate `ERP-PLANNING/Campaign-Planning/phase-completions/CP-6_COMPLETION.md`, update status trackers, add
`campaign-analytics.spec.ts` and `campaign-ab-testing.spec.ts` per `24_PLAYWRIGHT_TEST_PLAN.md`.
