# 09 — Rollback Strategy & Risk Assessment

## 1. Rollback strategy (general policy, per-feature specifics live in phase docs)

Every phase in this roadmap ships as additive schema + new routes + new frontend pages/routes,
never a rewrite of existing behavior (see `03-DATABASE-MIGRATION-PLAN.md` §3). This makes the
default rollback shape consistent across the whole roadmap:

1. **Application-level rollback (first line of defense):** redeploy the previous service/frontend
   version. Because new tables/columns are additive and never removed columns/behavior, the
   previous version simply doesn't read/write them — no data loss, no compensating migration
   needed for a same-day rollback.
2. **Feature-flag rollback (where applicable):** any feature this roadmap wires behind a feature
   flag (`PlatformFeatureFlags`, already used elsewhere per `TECH_AUDIT.md` §18) can be disabled
   without a deploy at all. Recommended for: Journey Builder (Phase 2, highest blast-radius if a
   bad journey definition fires at scale), AI suite (Phase 3, wrong predictions are a trust problem,
   not just a bug), DLT SMS gate (Phase 1 — though this one defaults to strict/on given its
   compliance nature, so "rollback" here means a documented emergency-override path with audit
   logging, not a casual toggle).
3. **Data rollback (last resort, case-by-case):** since no migration in this roadmap drops or
   rewrites existing data, a genuine data rollback is only ever "stop writing to the new
   table/column" — actually deleting rows is a deliberate, separate, reviewed action taken after
   confirming no downstream consumer depends on them, never an automatic part of an incident
   response.
4. **Event/consumer rollback:** every new Kafka event this roadmap introduces (§3 of the API design
   plan) has new consumers. If a consumer has a bug, the fix is redeploying that consumer — the
   `inbox_events` idempotency pattern already in place means replaying events after a consumer fix
   is safe, not a special procedure to design.

## 2. Migration-specific rollback notes

- **`customers.account_id`** — nullable, additive. Rollback = stop writing it; no risk to existing
  reads since nothing existing queries it yet.
- **Permission backfill migrations** — these are additive grants. Rolling one back means a targeted
  `DELETE FROM role_permissions WHERE ...` for the specific permission/role pair, the same shape as
  every existing `*_permission_backfill.sql` migration's implicit reverse — no new rollback
  mechanism needed, follow precedent.
- **`campaignRecipients.opened_at`/`clicked_at` write-path activation (Phase 2)** — this is the one
  item in this roadmap that changes behavior on an _existing_ table without adding a new one.
  Rollback = redeploy the previous `CampaignService`/click-tracking-redirect version; the columns
  simply stop being written again, exactly as they are today. Zero risk to existing rows since
  they're currently always `NULL`.

## 3. Risk register

| Risk                                                                                                                             | Phase            | Likelihood                                   | Impact                                                                 | Mitigation                                                                                                                                                                      |
| -------------------------------------------------------------------------------------------------------------------------------- | ---------------- | -------------------------------------------- | ---------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Portal authorization boundary bug leaks cross-customer data (IDOR)                                                               | 3                | Medium                                       | Severe                                                                 | AR-5 + `06-SECURITY-PLAN.md` §2.3 — mandatory explicit boundary tests, add to `route-guard-coverage.test.ts`, do not ship without a dedicated security review pass              |
| Public lead-capture endpoint abused for spam/injection since it's the only unauthenticated write surface in the codebase         | 1                | Medium                                       | Moderate                                                               | Rate limiting + CAPTCHA + strict Zod validation, §2.1 of security plan — treat as hostile-input-by-default                                                                      |
| RBAC frontend/backend permission drift (recurred 4x already in this codebase)                                                    | All              | High if not disciplined                      | Moderate (silent 403s, not a security hole, but a real UX/trust break) | AR-7 — every permission ships both mirrors + grep-verified route match, checked at PR time                                                                                      |
| Journey Builder misconfiguration sends a bad message to a large customer segment at scale                                        | 2                | Low-Medium                                   | Moderate-High (customer trust, opt-out spike)                          | Reuses existing frequency-cap/consent enforcement (AR-3) which already protects campaigns; add a feature flag + a "preview affected customer count before publish" UX safeguard |
| Scheduler-service cron load increases beyond current headroom once journey-step evaluation is added                              | 2                | Medium                                       | Moderate (delayed sends, not data loss)                                | `07-PERFORMANCE-PLAN.md` §4 — measure existing headroom before Phase 2, not after                                                                                               |
| AI churn/next-best-action predictions are wrong often enough to erode rep trust and get ignored                                  | 3                | Medium                                       | Moderate (wasted investment, not a bug)                                | Always ship the "why" explanation alongside the score (per the feature spec), and a feedback/dismiss control to measure and improve acceptance rate over time                   |
| DLT/TRAI non-compliance if the gate is implemented as advisory instead of blocking                                               | 1                | Low (if built correctly)                     | Severe (regulatory/carrier risk to tenants)                            | AR-8 — hard gate, not a warning, explicitly called out as the one non-negotiable compliance item in this roadmap                                                                |
| `sales-service` grows large enough that build/deploy/ownership becomes a real bottleneck (AR-1's stated reconsideration trigger) | All (cumulative) | Low near-term, rises over the roadmap's life | Moderate (engineering velocity, not correctness)                       | Not mitigated now — explicitly deferred per AR-1, revisit after Phase 2 ships and re-measure                                                                                    |
| Existing campaign E2E specs regress from the engagement-tracking write-path change                                               | 2                | Medium                                       | Moderate                                                               | `08-TESTING-STRATEGY.md` §5 — mandatory re-run of all 6 existing CRM/campaign specs before merge                                                                                |
| Branch-scoping retrofit debt continues to grow if new Phase 3/4 tables skip it                                                   | 3, 4             | Medium                                       | Moderate (repeats a known, previously expensive audit finding)         | AR-6 applied consistently — checked per feature in the phase docs' DB Impact sections                                                                                           |

## 4. Dependency graph across phases (what blocks what)

```
Phase 1 (Foundation)
  Contact & Account Hierarchy ──┬─→ Lead Management (leads convert into accounts)
                                 └─→ Sales Pipeline (Phase 2, opportunities need accounts)
  Customer 360 ──────────────────── depends on nothing new (composes existing services) — ship first
  Support & Ticketing ───────────── depends on nothing new — can ship in parallel with the above
  ERP-Native Integration Layer ──── depends on nothing new, but Phase 2 Pipeline and Phase 3 AI
                                     suite both assume it exists — sequencing risk if delayed
  DLT/TRAI Compliance ──────────── independent, but blocks nothing else — do not let it slip behind
                                     product features given its compliance nature

Phase 2 (Pipeline & Engagement) — requires Phase 1's Account Hierarchy + ERP-Native layer shipped
  Sales Pipeline ─────────────────── requires Contact & Account Hierarchy (Phase 1)
  Journey Builder ────────────────── requires nothing new from Phase 1, but reuses
                                      campaignAutomationRules (already live) — AR-3
  Loyalty Tiering ─────────────────── independent
  Referral Engine ─────────────────── soft-depends on Loyalty Tiering (shares the payout ledger)
  Omnichannel Inbox ───────────────── independent, but benefits from Customer 360 (Phase 1) existing
                                      as the natural place to surface conversation history

Phase 3 (Intelligence) — requires Phase 1 + 2 substantially shipped (needs real pipeline/ticket/
                          journey data to train/score against)
  AI & Predictive Suite ──────────── requires Customer 360 (Phase 1) as its display surface, and
                                      benefits from Phase 2's richer interaction data (journeys,
                                      tickets) for better predictions
  Self-Service Portal ─────────────── requires Support & Ticketing (Phase 1) + Loyalty Tiering
                                      (Phase 2) since it surfaces both

Phase 4 (Enterprise) — requires the full foundation; lowest near-term confidence, see 13-PHASE-4-ENTERPRISE.md
```
