# PHASE CP-1 — Foundation Hardening — COMPLETION REPORT

## Generated: 2026-07-15 | Status: COMPLETE

> **This document is the official handoff artifact for Phase CP-1.**
> **The next phase (CP-2) MUST start by reading this document.**
> **Never modify this document after generation.**

---

## 1. PHASE SUMMARY

| Field        | Value                                                                  |
| ------------ | ---------------------------------------------------------------------- |
| Phase Number | CP-1                                                                   |
| Phase Name   | Foundation Hardening                                                   |
| Start Date   | 2026-07-15                                                             |
| End Date     | 2026-07-15                                                             |
| Status       | COMPLETE                                                               |
| Engineer(s)  | Claude (autonomous execution, Campaign Management Platform initiative) |
| Session      | Same session that authored `ERP-PLANNING/Campaign-Planning/`           |

---

## 2. WHAT WAS BUILT

### 2.1 Database Schema

No new tables or migrations. **Deviation from the original plan** — see section 13.

### 2.2 APIs Implemented

None. No API changes in this phase (as planned — CP-1 is hardening-only).

### 2.3 Services Implemented / Changed

```
apps/sales-service/src/domain/CampaignService.ts
  - send()      — now increments `version` on both the SENDING and SENT updates
  - schedule()  — now increments `version` on the SCHEDULED update
  - cancel()    — now increments `version` on the CANCELLED update
  (No other behavior change — recipient resolution, opt-out gating, status guards,
   message rendering, stats/recipient-listing all verified unchanged by the new test suite.)
```

### 2.4 Frontend Screens

None changed as planned — but see section 13 for an unplanned fix (`live-crm.spec.ts` selectors).

### 2.5–2.8 Events / Jobs / Sagas

Not applicable to this phase.

---

## 3. TESTS

### 3.1 New Test Files

| File                                                        | Tests | Type                                                                     |
| ----------------------------------------------------------- | ----- | ------------------------------------------------------------------------ |
| `apps/sales-service/src/__tests__/campaign-service.test.ts` | 26    | 10 pure-function (always run) + 16 DB-integration (`DATABASE_URL`-gated) |
| `apps/sales-service/src/__tests__/segment-service.test.ts`  | 14    | 4 pure-function (always run) + 10 DB-integration (`DATABASE_URL`-gated)  |

Coverage established as the CP-1 regression baseline: `checkChannelLimits`, `renderCampaignMessage`,
`optOutCondition`, `resolveRecipients` (explicit list, segment-based, opt-out filtering per channel,
IN_APP has no gate, validation-error path), `previewSample`, every status-transition guard on
`send`/`schedule`/`cancel` (including the new version-increment behavior), `getStats`/`listRecipients`,
`SegmentService.isPrebuilt`, `customWhere`/`buildCondition` (whitelist rejection, operator rejection),
and DB-verified correctness of `gold-tier` prebuilt segment, custom AND/OR logic, `contains` operator,
tenant scoping, and `resolveWhere` dispatch for both system and custom segments.

### 3.2 Test Execution Results

- New tests: **40/40 passing** (both DB-gated and pure), run against the real dev Postgres
  (`erp-postgres-primary`, port 5435).
- Full existing `apps/sales-service` suite: **149/149 passing** (22 test files) — confirms zero
  regression from the `version`-increment change.
- `apps/web-frontend/e2e/live-crm.spec.ts`: **passing** (see section 13 — required a fix, not just
  a re-run).

---

## 7. KNOWN ISSUES AND TECHNICAL DEBT

| Issue                                                                                         | Severity | Resolution Plan                                                                       |
| --------------------------------------------------------------------------------------------- | -------- | ------------------------------------------------------------------------------------- |
| `campaigns.segment_id` / `campaign_recipients.notification_log_id` remain informal (no DB FK) | Low      | Intentional — see section 13. Not planned to change unless the whole repo adopts FKs. |
| No queue/worker for recipient fan-out yet (still in-request batches of 25)                    | Medium   | CP-5, as planned                                                                      |
| No delivery-confirmation webhooks yet (`deliveredCount` still never increments)               | Medium   | CP-6, as planned                                                                      |

---

## 12. WHAT IS NOT DONE (REMAINING TODO)

Everything else in `07_FEATURE_BACKLOG.md` — CP-1 was scoped to hardening + baseline test coverage only,
per the roadmap. CP-2 (Channel Abstraction & Media) is next.

---

## 13. ARCHITECTURE DECISIONS MADE IN THIS PHASE

| Decision                                                                                                                                                                                                                                                  | Why                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         | Alternatives Considered                                                                                                                                                                                                                                                                                                     |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Did NOT add DB FK constraints** for `campaigns.segment_id → customer_segments.id` and `campaign_recipients.notification_log_id → notification_log.id`, despite this being explicitly planned in `02_GAP_ANALYSIS.md`/`17_DATA_MODEL_AND_API_DESIGN.md`. | Repo-wide check (`grep -r REFERENCES packages/db-client/migrations`) found **zero FK constraints across all 53 existing migrations** — every one of this schema's ~50+ tables enforces relationships at the application layer only. This is a consistent, deliberate architectural convention, not an oversight. Adding the first-ever FK here would be a unilateral deviation, and `notification_log` is owned by a different service's domain (notification-service) than `campaigns`/`campaign_recipients` (sales-service) — a hard FK would introduce cross-service schema coupling this codebase has never had. Verified 0 orphan rows exist today (checked live against the dev DB), so it would have been _safe_ to add, but safety alone doesn't justify breaking an established, repo-wide pattern for one module. | Add the FKs as originally planned (rejected: inconsistent with 53/53 migrations); add `ON DELETE SET NULL` FKs only within the same service's schema, i.e. just `campaigns.segment_id` and skip the cross-service one (rejected: still the only FK in the entire schema, same core objection).                              |
| Applied `version: sql\`${campaigns.version} + 1\``to every mutating update in`CampaignService`                                                                                                                                                            | This is the exact, already-established pattern used throughout the codebase (`StockTransferService`, `StockAdjustmentService`, `ReservationEngine`, `JobWorkOrderService`, etc. all do `version: sql\`${table.version} + 1\``alongside`updatedAt`). Zero behavior change today (no reader depends on `version` yet), but makes CP-4's optimistic-locked editing feature a small addition instead of a retrofit.                                                                                                                                                                                                                                                                                                                                                                                                             | Leave `version` untouched until CP-4 (rejected: CP-1's explicit mandate was to make this safe to extend, and this is a zero-risk, zero-behavior-change way to do that now).                                                                                                                                                 |
| **Fixed `apps/web-frontend/e2e/live-crm.spec.ts`** (not originally in CP-1's scope, but required to satisfy "confirm the E2E baseline passes")                                                                                                            | Running the existing spec against the live dev stack failed immediately: the segment-creation step still expected a modal dialog (`getByRole('dialog', { name: 'New Custom Segment' })`), but `SegmentFormPage.tsx` is now a full page at `/crm/segments/new` — a latent regression from the separate "ERP-wide create-record UX standardization" work that shipped 2026-07-14 (14 modal→page conversions), which never re-ran this spec afterward. Updated the test's selectors to navigate to and interact with the page instead of a dialog; the underlying capability (segment creation) was never broken, only the test's assumption about its container. Re-ran and confirmed the full Segment → Campaign → Preview → Send flow passes end-to-end (7.8s) against real backend services.                               | Leave the E2E test red and note it as pre-existing (rejected: `19_MIGRATION_AND_BACKWARD_COMPATIBILITY.md` designates this spec as the regression gate every phase must keep green; leaving it broken at the start of a 9-phase initiative would make every subsequent phase's "did I regress anything" check meaningless). |

---

## 14. RISKS FOR NEXT PHASE

| Risk                                                                                                                                                                                                                                                          | Impact | Mitigation                                                                                                                             |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ | -------------------------------------------------------------------------------------------------------------------------------------- |
| CP-2 will refactor `notification-service`'s channel dispatch (`deliverViaChannel`) onto a new adapter interface — the informal-reference decision above means CP-2 must not assume a DB-level FK exists when reasoning about `notification_log_id` integrity. | Low    | Documented explicitly in `17_DATA_MODEL_AND_API_DESIGN.md`'s CP-1 section.                                                             |
| The `live-crm.spec.ts` fix confirms this repo's E2E suite can silently go stale when a shared UI pattern changes elsewhere (the modal→page conversion). Future phases should re-run this spec proactively, not just at their own DoD checkpoint.              | Medium | Called out in every remaining `phase-prompts/CP-*.md` file already (each requires the spec to pass before considering the phase done). |

---

## 15. FINAL ARCHITECTURE SUMMARY

CP-1 hardened the existing Campaign engine without changing any user-visible behavior: `CampaignService`'s
three mutation paths (`send`/`schedule`/`cancel`) now increment `campaigns.version` on every update,
matching this codebase's established optimistic-locking pattern, in preparation for CP-4's editing feature.
A planned FK-constraint addition was investigated and deliberately **not** made, because it would have been
the first hard FK in this database's entire 53-migration history and would have coupled two different
services' schemas — the informal-reference pattern was kept, and the decision (with full reasoning) is
recorded here and in `17_DATA_MODEL_AND_API_DESIGN.md` for future sessions. 40 new unit/integration tests
establish the CP-1 regression baseline for `CampaignService`/`SegmentService`'s current behavior, and the
existing 149-test `sales-service` suite passes unchanged. The `live-crm.spec.ts` E2E regression gate — found
broken due to an unrelated, earlier UI change (modal→page conversion) that was never re-verified against
this spec — was fixed and now passes end-to-end against the live dev stack. The Campaign module is now on a
verified, tested foundation; CP-2 (Channel Abstraction & Media) can proceed.

---

_Generated by: Claude Sonnet 5 | Date: 2026-07-15 | Next Phase: CP-2 — Channel Abstraction & Media_
