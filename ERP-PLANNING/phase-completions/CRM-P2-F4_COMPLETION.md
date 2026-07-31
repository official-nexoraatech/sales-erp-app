# CRM-ROADMAP Phase 2, Feature 4 — Referral Program Engine — Completion Report

**Date:** 2026-07-29
**Status:** Complete.

## Summary

Referral codes, fraud guardrails, and reward payout via the existing loyalty ledger — genuinely
absent from this codebase before this feature. Sequenced after Feature 3 (Loyalty Tiering) per
the roadmap's own explicit dependency, since payout credits both parties through the exact same
`loyalty_transactions` ledger — no new reward rail.

- **3 new tables**: `crm_referral_codes` (per-customer, globally-unique 8-char code — globally,
  not per-tenant, because the public click/redeem routes resolve the tenant FROM the code
  itself, since an unauthenticated referral link can't otherwise carry a tenantId),
  `crm_referral_events` (CLICKED/SIGNED_UP/PURCHASED funnel), `crm_referral_rewards` (one row per
  referee, DB-enforced `UNIQUE(tenant_id, referee_phone)` — the structural guarantee behind
  "one-time-per-referee enforcement," not just an application check).
- **`ReferralService.ts`** — `getOrCreateCode`/`trackClick`/`redeem`/`attributeQualifyingPurchases`/
  `approveFlagged`/`rejectFlagged`/`listRewards`/`getFunnelStats`. `redeem()` runs every fraud
  guardrail before a reward row exists:
  1. **Self-referral** — referee phone matches the referrer's own.
  2. **Already an existing customer** — the roadmap's own explicit edge case: referrals
     incentivize _new_ customer acquisition, so a phone number already belonging to a customer
     record doesn't qualify.
  3. **One-time-per-referee** — DB constraint, not just a check.
  4. **Device/address correlation** — 3+ other redemptions sharing the same IP/device within 30
     days flags the reward `FLAGGED` instead of `PENDING`, per the roadmap's own security
     classification requiring fraud detection to have "its own abuse-review path, not just a
     reward payout path." A `FLAGGED` reward never auto-pays until a `REFERRAL_CONFIGURE`
     reviewer approves or rejects it.
     Payout itself (`attributeQualifyingPurchases`, scheduler-driven) happens once the referee's
     phone resolves to a real, newly-created customer (created after the reward, ruling out a
     coincidental pre-existing match) with a qualifying invoice — the referee usually isn't a real
     customer yet at redemption time.
- **New `LoyaltyService.creditPoints()`** — a flat-amount credit (referral rewards aren't tied to
  a purchase percentage like `earnPoints()`'s existing math), reusing the exact same `FOR UPDATE`
  - tier-evaluation discipline Feature 3 already established. Referral-earned points count
    toward a customer's lifetime tier progress, same as any other EARN transaction.
- **New public routes** (`referral-public.routes.ts`, sibling-registered per the established
  public-route gotcha): `GET /r/:code` (click-tracking redirect to the frontend landing page —
  never an attacker-supplied destination, same open-redirect-safe shape as
  `link-tracking.routes.ts`'s click route) and `POST /referral/redeem` (rate-limited,
  honeypot-gated, same posture as the pre-existing `/leads/capture`). Both added to
  `api-gateway`'s `EXEMPT_PATHS`/`EXEMPT_PREFIXES` and `route-guard-coverage`'s
  `KNOWN_EXCEPTIONS`.
- **New staff routes** (`referral.routes.ts`): get-or-create a customer's code, funnel stats,
  list/approve/reject rewards.
- **New scheduler job**: `crm.referral-attribution` (`0 5 * * *`) → internal route
  `POST /referral/attribute-purchases` → loops active tenants.
- **New permissions**: `REFERRAL_VIEW`/`REFERRAL_CONFIGURE` (names taken directly from the
  roadmap's own Security Considerations section). `REFERRAL_VIEW` also granted to `CASHIER` —
  a cashier printing a receipt needs to fetch the paying customer's own code for the receipt QR,
  mirroring the exact `LOYALTY_REDEEM`-to-`CASHIER` gap fixed in Feature 3.
- **Frontend**: a "Refer a Friend" card on Customer 360 (code + tracked shareable link, copy
  button), a `ReferralRewardsPage.tsx` admin review queue (funnel stats + FLAGGED
  approve/reject), a public `ReferralLandingPage.tsx` at `/refer/:code` (name+phone form, same
  honeypot/rate-limit posture as the existing lead-capture page), and a referral QR on the POS
  receipt (`ReferralQr.tsx`, mirrors the existing `UpiQr.tsx` exactly) encoding the tracked
  `GET /r/:code` link, not the landing page directly.

## Decisions / deviations (flagged during implementation, not silently decided)

1. **Claw-back policy: none, by design, matching existing behavior.** The roadmap explicitly
   flags "if the referee's first order is later cancelled/returned" as a decision to make and
   document. Checked first: `SaleReturnService.ts` does **not** claw back
   `loyaltyPointsEarned` on a return anywhere in this codebase today. A referral reward, once
   paid, follows the identical policy — not a stricter rule invented just for this feature.
2. **Payout is deferred to a scheduler tick, not done at redemption time**, because the referee
   usually isn't a real customer record yet when they redeem a code — `refereeCustomerId` on the
   reward row starts null and is only resolved once a matching, newly-created customer with a
   qualifying purchase is found.
3. **A referee who was already an existing customer is rejected outright**, not silently
   converted into "no reward, but let them proceed" — the roadmap's own edge case explicitly
   requires this not to count as new-customer acquisition, and the cleanest way to guarantee that
   is to refuse the redemption entirely rather than letting a reward row exist in a permanently
   dead state.
4. **Device/IP correlation uses a persisted per-browser random id (`localStorage`), not a real
   device fingerprint** — confirmed via research that no fingerprinting mechanism exists
   anywhere in this codebase (`suspicious-login.ts` is IP-only, login-brute-force-specific).
   Documented as a lightweight correlation signal, not a strong anti-fraud guarantee — a
   determined abuser clearing localStorage defeats it, but the IP-sharing check still catches
   the common case, and this is explicitly flagged as a follow-up if stronger guarantees are
   needed later.
5. **`crm_referral_codes.code` is globally unique, not per-tenant** — a deliberate schema choice
   forced by the public routes having no other way to resolve which tenant an unauthenticated
   referral link belongs to.

## Acceptance Criteria

- [x] A referral program runs end-to-end with fraud protection and correct payout — covered
      directly (full funnel test: redeem → matching customer created → qualifying invoice →
      attribution run → both parties credited, reward `PAID`, `PURCHASED` event recorded).
- [x] Zero double-payout under any tested abuse scenario — covered directly (re-running
      attribution after a reward is already `PAID` credits nothing further; a second redemption
      attempt for the same phone is rejected outright, not silently accepted).
- [x] Self-referral blocked — covered directly.
- [x] Double-redemption (same referee phone, even under a different code) blocked — covered
      directly.
- [x] Suspicious-correlation flag — covered directly (3rd+ redemption sharing an IP is `FLAGGED`,
      not auto-paid; a `FLAGGED` reward stays unpaid through an attribution run until approved).
- [x] Referral funnel report shows shared→clicked→purchased counts matching seeded data — covered
      directly (`getFunnelStats` aggregation test).

## Verification performed this session

- `pnpm --filter @erp/db build` / `@erp/types build` — clean.
- `pnpm --filter sales-service type-check` / `scheduler-service type-check` /
  `api-gateway type-check` / `shared-types type-check` / `web-frontend type-check` /
  `pos-frontend type-check` — all clean.
- `eslint` scoped to every touched/new file — 0 new errors (only the same pre-existing-style
  `explicit-function-return-type` warnings, plus the one pre-existing, unrelated
  `react-hooks/exhaustive-deps` rule-not-found error in `App.tsx` documented in the Feature 2
  report).
- **Live migrations applied**: `0126_crm_referral_program.sql` (3 tables),
  `0127_crm_referral_permission_backfill.sql` (`INSERT 0 208` for
  OWNER/ADMIN/SUPER_ADMIN/SALES_MANAGER, `INSERT 0 26` for CASHIER).
- **New `referral-service.test.ts`** — **11/11 passing**: code get-or-create idempotency, clean
  redemption + SIGNED_UP event, self-referral block, existing-customer block, one-time-per-referee
  block across different codes, device/IP correlation flagging, full funnel payout (both parties
  credited the exact reward amount, ledger-linked, `PURCHASED` event, no double-payout on a
  second attribution run), FLAGGED-blocks-payout-until-approved, reject-then-cannot-approve,
  funnel-stats aggregation, and the `SELF_REFERRAL` business-error code.
- **Regression sweep**: `loyalty-service.test.ts` (9), `pos-completion.test.ts` (7),
  `journey-service.test.ts` (19), `campaign-service.test.ts` (103), `segment-service.test.ts`
  (39) — **177/177 passing**, confirming `LoyaltyService.creditPoints()` doesn't disturb any
  existing loyalty behavior. `scheduler-service` full suite (83), `tenant-service` full suite
  (59, `role-defaults.ts` changed), `api-gateway` full suite (51, `gateway-auth.ts` changed) —
  all passing. `pos-frontend` full suite (192 across 31 files) and `web-frontend` CRM/customer/
  marketing page tests (19) — all passing.
- `packages/shared-types` `route-guard-coverage` + `dead-permission-constants` scans — the new
  referral routes/permissions are correctly recognized; the 2 unguarded routes the scan does
  report are pre-existing and unrelated.

## Files touched

- `packages/db-client/src/schema/crm.ts` — 3 new tables + type exports.
- `packages/db-client/migrations/0126_crm_referral_program.sql`,
  `0127_crm_referral_permission_backfill.sql` — both applied live.
- `packages/db-client/migrations/meta/_journal.json` — 2 appended entries.
- `packages/shared-types/src/permissions.ts` — `REFERRAL_VIEW`, `REFERRAL_CONFIGURE`.
- `packages/shared-types/src/__tests__/route-guard-coverage.test.ts` — new `KNOWN_EXCEPTIONS`
  entry.
- `apps/tenant-service/src/rbac/role-defaults.ts` — SALES_MANAGER (both) + CASHIER
  (`REFERRAL_VIEW` only) grants.
- `apps/sales-service/src/domain/ReferralService.ts` — new.
- `apps/sales-service/src/domain/LoyaltyService.ts` — new `creditPoints()` method.
- `apps/sales-service/src/api/referral.routes.ts`, `referral-public.routes.ts` — new.
- `apps/sales-service/src/api/internal.routes.ts` — new `POST /referral/attribute-purchases`.
- `apps/sales-service/src/main.ts` — registers both new route files.
- `apps/scheduler-service/src/jobs/system-jobs.ts` — new `crm.referral-attribution` job.
- `apps/api-gateway/src/middleware/gateway-auth.ts` — `EXEMPT_PATHS`/`EXEMPT_PREFIXES` entries.
- `apps/sales-service/src/__tests__/referral-service.test.ts` — new, 11 tests.
- `apps/web-frontend/src/pages/crm/ReferralRewardsPage.tsx`,
  `apps/web-frontend/src/pages/marketing/ReferralLandingPage.tsx` — new.
- `apps/web-frontend/src/pages/customers/CustomerViewPage.tsx` — "Refer a Friend" card.
- `apps/web-frontend/src/schemas/referral.schema.ts`, `apps/web-frontend/src/api/endpoints.ts` —
  new schema + `referralApi`.
- `apps/web-frontend/src/App.tsx`, `apps/web-frontend/src/lib/navigation.ts` — routes + nav entry.
- `apps/pos-frontend/src/components/pos/ReferralQr.tsx` — new.
- `apps/pos-frontend/src/components/pos/ReceiptOverlay.tsx` — referral QR wiring.

## What is not done (remaining TODO)

| Item                                                                  | Why deferred                                                                                                                                                       | Target                                                                                |
| --------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------- |
| Playwright E2E specs for the 4 scenarios in the phase doc             | Not run this session; logic covered instead by unit + live-DB integration tests                                                                                    | Follow-up before Phase 2 sign-off                                                     |
| Real device fingerprinting (vs. the persisted-localStorage-id signal) | No such mechanism exists anywhere in this codebase yet; the current signal catches the common IP-sharing abuse case but not a determined attacker clearing storage | If real fraud volume shows the current signal is insufficient                         |
| Per-tenant-configurable reward amounts                                | Currently a flat 100/100-point constant, matching this feature's "Complexity: Low" framing in the roadmap                                                          | If a tenant needs a different reward size                                             |
| Referral code deactivation UI                                         | `crm_referral_codes.is_active` exists in schema; no route/UI exposes toggling it off                                                                               | If abuse on a specific customer's code needs to be shut down without deleting history |

## Deployment Checklist

- [ ] Run migrations `0126_crm_referral_program.sql`, `0127_crm_referral_permission_backfill.sql`
      against every target database (staging/prod) — verified applied against the local dev DB
      this session only.
- [ ] Set `WEB_FRONTEND_URL` env var on sales-service in any environment where it differs from
      the `http://localhost:5173` default (used to build the `GET /r/:code` redirect target).
- [ ] No other new environment variables.
