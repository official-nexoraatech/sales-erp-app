# CP-9 Follow-up — Closing Remaining Flagged Items — COMPLETION REPORT

## Generated: 2026-07-15 | Status: Closes 6 of the 7 items flagged as open after CP-9; verification debt is now genuinely resolved (services rebuilt+restarted+verified live), unlike every prior phase's report

> This is a follow-up to `CP-9_COMPLETION.md`, produced in the same session after the user asked
> "is there any other flagged item still open, if yes please plan to close it" and confirmed two
> scoping decisions (build a generic consent/preference center now; no new channel adapters yet).
> Per this initiative's convention, `CP-9_COMPLETION.md` itself is not modified — this is a new
> document, exactly like how no earlier phase's report was ever edited after generation.

---

## 1. WHAT THIS SESSION ADDRESSES

Immediately after CP-9's report was written, the user hit a live **404** trying to use the
approval workflow (`POST /crm/campaigns/:id/submit-for-approval`). Root cause: the standing
"verification debt" flagged in every completion report since CP-2 was real — `sales-service` and
`notification-service` were dev processes running code from before this entire initiative began.
With the user's explicit, per-restart confirmation (the environment's safety classifier correctly
required this each time, since these processes weren't started by this session), **both services
were rebuilt and restarted multiple times this session** as new work landed. This is the first
point in the whole initiative where the live stack actually reflects the code.

That unblocked everything else the user then asked to close out.

---

## 2. ITEMS CLOSED THIS SESSION

| #   | Item (as flagged in CP-7/CP-8/CP-9)                                                           | Status                                                    | Evidence                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| --- | --------------------------------------------------------------------------------------------- | --------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Verification debt (CP-2 through CP-9)                                                         | **RESOLVED**                                              | Both services rebuilt+restarted; every new route (CP-6 webhooks, CP-7 approval/comments, CP-8 sender-identity/webhooks) directly curl-verified returning 401/signature-rejection instead of 404; 6/6 live Playwright specs pass against the current code.                                                                                                                                                                                                                                                                                       |
| 2   | Sender-identity and webhook-subscriptions had working APIs but no settings UI                 | **CLOSED**                                                | `CampaignSettingsPage.tsx` extended with a Sender Identity section (upsert per channel) and an Outbound Webhooks section (create/pause/remove, one-time secret display). Verified live via Playwright.                                                                                                                                                                                                                                                                                                                                          |
| 3   | `approval_required`/frequency-cap had no settings UI (root cause of the user's 404 confusion) | **CLOSED**                                                | New `GET/PUT /crm/communication-settings` route + the same settings page's Approval & Frequency section. Verified live: toggling it on now correctly moves a submitted campaign to `PENDING_APPROVAL` instead of auto-approving.                                                                                                                                                                                                                                                                                                                |
| 4   | Consent/preference-center (DPDP/TRAI-flagged item) — API/UI deferred                          | **CLOSED, generic version, per user's explicit decision** | `GET/PUT /customers/:id/preferences` (upsert on the existing `customer_communication_preferences` table), a "Detailed Consent" channel×category grid on `CustomerViewPage.tsx`, **and** enforcement wired into `CampaignService.resolveRecipients()` (a customer with an explicit consented=false PROMOTIONAL row for a channel is now excluded from targeting on that channel) — see section 4 for why enforcement wasn't originally scoped and had to be added. `campaign-preference-center.spec.ts` unskipped, now a real passing live test. |
| 5   | `notification_delivery_events` missing `tenant_id`                                            | **CLOSED**                                                | Migration `0061`; zero existing rows meant a direct `NOT NULL` add, no backfill needed. `recordDeliveryEvent()`'s signature updated, all 3 call sites (MSG91/SendGrid/Meta) and its test updated.                                                                                                                                                                                                                                                                                                                                               |
| 6   | 3 pre-existing frontend a11y gaps (unlabeled selects, toggle-buttons without `aria-pressed`)  | **CLOSED**                                                | `aria-label` added to Target Segment/Campaign Type/Load-from-Template selects; `aria-pressed` added to the channel picker and status-filter toggle groups. Zero regression (full suite re-run).                                                                                                                                                                                                                                                                                                                                                 |
| 7   | Additional channel adapters (Telegram/Messenger/Web Push/QR)                                  | **Still open, by explicit user decision**                 | User chose "None for now" — correctly not built.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |

### Not part of the original 7, found and fixed along the way

- **App-wide accessibility bug, unrelated to Campaigns**: writing an axe-core test for the empty-state on `CampaignsPage` failed with a `heading-order` violation — `ERPPageHeader` renders `<h1>`, `ERPEmptyState` renders `<h3>`, skipping `<h2>`, on **every page in the entire application** that uses both (dozens of pages, not just Campaigns). Fixed with a one-line, zero-visual-impact change (`<h3>` → `<h2>` in `ERPEmptyState.tsx`) since it's a shared component; full suite re-run confirmed zero regressions elsewhere.
- **A real, live, currently-reproducible performance failure mode** — see section 3. This was not on anyone's list because it was never measured until this session actually could.

---

## 3. NFR-01/02/03 PERFORMANCE — MEASURED FOR REAL THIS TIME

`CP-9_COMPLETION.md` reported this as genuinely not done, since there was no live target to measure
against. With both services now live, real numbers were captured (never written to disk —
measured in-process via a Playwright script holding the auth token only in memory, per the
environment's credential-handling guardrails).

### NFR-01 (endpoint latency, target < 500ms p95)

| Endpoint                      | Samples | min  | p50  | p95   | max   |
| ----------------------------- | ------- | ---- | ---- | ----- | ----- |
| `GET /crm/campaigns` (list)   | 8       | 22ms | 26ms | 109ms | 109ms |
| `GET /customers` (list)       | 8       | 21ms | 30ms | 38ms  | 38ms  |
| `POST /crm/campaigns/preview` | 8       | 34ms | 45ms | 65ms  | 65ms  |

**All comfortably under the 500ms target — but not at the target scale.** NFR-01 specifies "up to
~50k customers"; the qa-e2e tenant has 13 customers total across every tenant in this dev database.
These numbers demonstrate the code path works and is fast at trivial scale; they do **not**
validate the 50k-row target, which would require seeding a large synthetic dataset — not done this
session, flagged as a real follow-up.

### NFR-03 (segment query indexing)

`EXPLAIN` on a representative segment-matching query (`tenant_id + status + deleted_at IS NULL`)
returns a **sequential scan**, not an index scan — but this is _correct, expected Postgres planner
behavior_ on a 13-row table (an index lookup would be slower than a seq scan at this size). The
real finding: **`customers` has no index on `tenant_id` at all** (only `tenant_id+client_operation_id`
and `tenant_id+code` composite indexes exist). At the 50k-row target scale this would very likely
force a real, costly sequential scan filtering out every other tenant's rows on every segment
query. **This is a latent risk, not a currently-observed problem** — flagged for whoever next
works with production-scale data, not fixed speculatively this session per this repo's own
"don't build for hypothetical future requirements" principle (`CLAUDE.md`).

### NFR-02 (10,000-recipient fan-out) — a real, reproducible failure found

A genuine, moderate-scale (300 recipients, not 10,000) live test was run: seeded 300 real customer
rows in a throwaway tenant, created an `IN_APP` campaign (no external provider dependency — DB-only
delivery, isolating the measurement from third-party API variance) targeting all of them, and
called `CampaignService.send()` — the exact same code the HTTP route calls — against the live,
just-restarted `notification-service`.

**Result: 300 recipients took 4.2 seconds total (13.95ms/recipient) — but only 200 of 300 (67%)
succeeded. 100 recipients failed.**

This is not noise. `notification-service`'s global rate limiter is configured at exactly
`max: 200, timeWindow: '1 minute'` (`apps/notification-service/src/main.ts`). `CampaignService.send()`
calls `POST /notifications/send-raw-internal` once per recipient (in concurrent batches of 25, but
cumulatively against the same rate-limited endpoint) with no awareness of that limit. The exact
200-succeeded / 100-failed split matches the configured limit precisely — strong evidence (though
the specific failed rows' error text wasn't captured before the test's cleanup ran, so this is
reported with high-but-not-absolute confidence, not asserted as 100% proven).

**This means any campaign with more than ~200 recipients sent within about a minute will have some
recipients silently fail today** (surfaced only as the generic `campaign_recipients.error_message`
= "Delivery failed", not as "rate limited" specifically) — a real, currently-existing gap, not a
hypothetical one about the 10,000-recipient target. It also confirms, directly, that CP-5's actual
implementation is **still synchronous in-request batching** (`BATCH_SIZE = 25` inside the HTTP
request), not "moved to a background worker" as NFR-02's own stated enforcement mechanism
describes — CP-5's completion report documented this as a deliberate, reasoned scope decision at
the time, but this measurement shows the tradeoff has a real, current cost, not just a theoretical
one at 10k scale.

**Not fixed this session** — this is a genuine design decision (raise `notification-service`'s
rate limit for internal-key-authenticated calls specifically vs. build an actual queue/worker vs.
have `CampaignService` self-throttle to stay under the limit), not a small, unambiguous bug fix
like the others in section 2, and this session's authorization was for closing flagged items, not
redesigning the dispatch architecture. Flagged as the most important finding of this follow-up
session.

---

## 4. WHY CONSENT-MODEL _ENFORCEMENT_ NEEDED TO BE ADDED (NOT JUST THE API/UI)

While updating `campaign-preference-center.spec.ts` (which the original CP-7 scope required to
"verify it is respected by subsequent campaign targeting"), it became clear that building only the
CRUD API + admin UI for `customer_communication_preferences` — without also wiring it into
`CampaignService.resolveRecipients()` — would have shipped a preference toggle that visibly saves
but has **zero actual effect on who receives a campaign**. That would have been misleading, not a
"generic version" of the feature. `applyGranularConsentFilter()` was added (mirrors
`applyFrequencyCap()`'s existing structure exactly): a customer with a `consented: false` row for
`(channel, 'PROMOTIONAL')` is excluded from that channel's targeting; a customer with no row is
treated as consented (backward-compatible, matches the UI's own default assumption). 'PROMOTIONAL'
is the only category `CampaignService` ever checks, since every campaign this service sends is a
marketing/broadcast message by definition — transactional notifications (receipts, order
confirmations) go through `notification-service`'s own direct send path, never through a
`campaigns` row.

3 new integration tests cover this (`campaign-service.test.ts`), plus the live Playwright test.

---

## 5. TEST RESULTS

| Suite                                  | Before this follow-up                   | After                                                                                                                                                                      |
| -------------------------------------- | --------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `sales-service` (vitest)               | 238                                     | **245** (+7: 3 consent-enforcement, 4 sender-identity/comm-settings/preferences integration)                                                                               |
| `notification-service` (vitest)        | 45 (48 incl. skipped)                   | **48** (all running, none skipped — `webhook-delivery.test.ts` was accidentally being skipped in the CP-9 run for lack of `DATABASE_URL`, corrected)                       |
| `web-frontend` (vitest, component+axe) | 82 (1 pre-existing unrelated failure)   | **91** (+9: CampaignsPage ×4, CampaignSettingsPage ×2, still 1 pre-existing unrelated `navigation.test.ts` failure)                                                        |
| Live Playwright (Campaign specs)       | 5 passing, 2 skipped, 2 failing (infra) | **6 passing, 1 skipped** (the 2 previously-failing approval-workflow tests now pass; the unsubscribe-mechanism test remains genuinely unimplemented and correctly skipped) |

All new/changed files typecheck clean and lint with 0 errors (warning-only, consistent with this
repo's pre-existing style conventions).

---

## 6. UPDATED RELEASE READINESS

Compared to `CP-9_COMPLETION.md`'s release checklist:

- [x] Verification debt — **now genuinely resolved**, not just documented as a known gap.
- [x] Full Playwright suite passing for everything currently buildable — the 2 previously-infra-blocked tests now pass live.
- [x] Accessibility — axe-core now actually run (not just planned) on 2 campaign surfaces, plus 1 app-wide fix.
- [ ] **NFR-02 recipient fan-out is now a confirmed, not hypothetical, gap** — this is the one item that should block calling the platform fully production-ready for high-volume tenants specifically, until addressed.
- [x] Consent model now has real enforcement, not just a UI, closing the "does this toggle actually do anything" gap.
- [ ] NFR-01/03 at 50k-customer scale still unvalidated (dev DB has 13 rows total) — recommend a synthetic-data load test before onboarding a large real tenant.

**Two genuine open items remain, both requiring a decision rather than being simple fixes:**

1. How to fix the NFR-02 rate-limit collision (raise the internal limit / self-throttle / real queue).
2. Whether/when to run a 50k-row-scale load test to validate NFR-01/03 for real.

Both are recommended as the next session's starting point.

---

_Generated by: Claude Sonnet 5 | Date: 2026-07-15_
