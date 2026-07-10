# OFFLINE-01 — POS Token Refresh & Branch Isolation (Prerequisite Fixes)
## STATUS: 🔲 NOT STARTED
## Sprint: Offline-1 | Effort: Small (1–2 days) | Risk: High if skipped (blocks every later offline phase)
## Depends on: none
## Unlocks: OFFLINE-02 through OFFLINE-10 — every later phase assumes the POS session survives an outage and that branch-scoped data isn't mixed up
## Source: `ERP-PLANNING/reports/OFFLINE_READINESS_REPORT.md`, `ERP-PLANNING/reports/OFFLINE_FIRST_ROADMAP.md`

---

## YOUR ROLE

You are the **Platform Engineer** responsible for the offline-first initiative on the NEXORAA Multi-Tenant Cloth Retail ERP, starting with its prerequisite fixes.

The 2026-07-05 offline-readiness audit found two issues that have nothing to do with "offline" as a feature per se, but that will silently break every later offline phase if left unfixed:

1. **POS access tokens expire in 15 minutes and `apps/pos-frontend` has no refresh-token flow.** A cashier's device offline for several hours will hold a dead access token by the time connectivity returns. Every subsequent phase in this program assumes the app can sync a queued backlog on reconnect — if the token is dead, every sync call 401s, and the current code just clears the token and forces a fresh login, which does not happen automatically and blocks the queue from flushing.
2. **`apps/sales-service`'s `POST /pos/sales` never validates `branchId` against the caller's JWT.** It trusts whatever `branchId` the client submits, scoping writes only by tenant. This is a pre-existing gap, but it matters more once this endpoint becomes the primary write path for a sync layer processing bursts of queued sales.

This phase fixes both. It is deliberately small and self-contained — do not let it grow into the sync/idempotency work; that's OFFLINE-02.

---

## PRE-FLIGHT CHECKLIST

- [ ] Read `ERP-PLANNING/reports/OFFLINE_READINESS_REPORT.md` in full, especially the sections on POS token expiry and branch isolation
- [ ] Read `apps/pos-frontend/src/LoginScreen.tsx` in full — current login/token-storage logic
- [ ] Read `apps/pos-frontend/src/POSScreen.tsx`'s auth-related code: where `pos_token` is read (`localStorage.getItem('pos_token')`), and the 401-handling paths that currently clear it
- [ ] Read `apps/auth-service/src/routes/refresh.ts` in full — the existing, working `POST /auth/refresh` endpoint: request/response shape, how the refresh token is validated and rotated
- [ ] Read `apps/auth-service/src/jwt.ts` — token payload shape (`tenantId`, `roles`, `permissions`, `branchIds`) and TTL config (`apps/auth-service/src/config.ts`, `JWT_ACCESS_TOKEN_TTL_SECONDS`/refresh TTL)
- [ ] Read `packages/platform-sdk/src/auth.ts` — `getBranchScope(req.auth)` and how `invoice.routes.ts` uses it correctly
- [ ] Read `apps/sales-service/src/api/pos.routes.ts` in full — the `POST /pos/sales` handler and every other route in the file, to find every place `branchId` is read from the request body without a branch-membership check
- [ ] Read `apps/sales-service/src/api/invoice.routes.ts:84` for the reference pattern to copy
- [ ] Confirm how `apps/web-frontend` currently does its (working, per prior audit only "no refresh flow" was flagged for web-frontend too — verify current state, don't assume) token refresh, if any, as a cross-check of conventions before designing the POS one
- [ ] Run `pnpm --filter @erp/pos-frontend build` and `pnpm --filter @erp/sales-service test` to confirm a clean baseline

---

## PROJECT CONTEXT

### Why the token-refresh gap matters specifically for offline

```
Cashier logs in at 9am → access token expires 9:15am → store loses internet 9:20am
→ cashier keeps ringing up sales offline (queued to IndexedDB, this part already works)
→ internet returns at 1pm → app tries to sync the queue → every POST /pos/sales gets 401
→ current code clears pos_token → app effectively logs the cashier out mid-sync
→ queued sales sit unsynced until someone notices and logs back in
```

The fix is not "make the access token last longer" (that increases blast radius if a
device is lost/stolen) — it's "use the refresh token the backend already issues but the
POS app currently throws away." Match `POST /auth/refresh`'s existing contract; do not
change the backend endpoint unless you find it's missing something POS-specific (it
shouldn't be — other clients should be able to use the same endpoint unchanged).

### Why the branch-isolation gap matters specifically now

It's a pre-existing bug independent of offline work, but this phase's timing is
deliberate: OFFLINE-02 onward will make `POST /pos/sales` (and endpoints built on the same
pattern) the target of replayed, possibly-bursty offline-queue syncs. Fixing branch
validation before that traffic pattern exists is cheaper than untangling cross-branch
data after multiple stores have been syncing against an unvalidated endpoint.

### Coding Standards
- TypeScript strict — no `any`
- No `console.log` — use `packages/logger`
- Match `apps/web-frontend`'s existing token-refresh conventions if it has a working one; otherwise this establishes the pattern `apps/pos-frontend` will follow going forward
- Do not change `POST /auth/refresh`'s request/response contract — only wire pos-frontend to consume what already exists

---

## OBJECTIVE

1. `apps/pos-frontend` persists the refresh token issued at login (not just the access token)
2. On a 401 response from any API call, or proactively before the access token's known TTL expires, `apps/pos-frontend` calls `POST /auth/refresh` and retries the original request with the new access token — the user is never silently logged out just because time passed while offline
3. `apps/sales-service`'s `POST /pos/sales` (and any other `pos.routes.ts` route that reads `branchId` from the request body) validates that `branchId` is a member of `req.auth.branchIds`, using the existing `getBranchScope` helper, and rejects with a clear 403 if not

---

## SCOPE

### Step 1 — Persist the refresh token in pos-frontend

`apps/pos-frontend/src/LoginScreen.tsx`: alongside the existing `localStorage.setItem('pos_token', result.accessToken)`, also persist `result.refreshToken` (e.g. `pos_refresh_token`). Match whatever storage mechanism is already used for the access token — don't introduce a second storage technology (e.g. don't move the access token to IndexedDB while leaving the refresh token in localStorage) unless there's a concrete security reason to, in which case state it explicitly in the completion report.

### Step 2 — Build the refresh-and-retry flow

Add a small auth-helper module in `apps/pos-frontend/src` (e.g. `auth.ts`, matching this app's existing flat file-organization convention — check whether `pos-frontend` groups helpers in a subdirectory or keeps them at `src/` root before deciding) that:
- Wraps `fetch` calls to the sales-service API (used in `POSScreen.tsx`'s `syncPending`, sale creation, held-sales, customer search, etc.)
- On a 401 response, calls `POST /auth/refresh` with the stored refresh token, and on success stores the new access token (and rotated refresh token, per the backend's rotation behavior) and retries the original request exactly once
- On refresh failure (refresh token itself expired/invalid), falls back to today's behavior — clear tokens, force re-login — since there's no way to recover a session with no valid token at all
- Also consider a proactive check (e.g. before initiating a sync batch) rather than relying solely on reactive 401 handling, since a burst of many queued-sale POSTs hitting 401 back-to-back would otherwise trigger redundant refresh attempts — a single refresh-then-retry-all-queued-items flow is cleaner than one refresh call per queued item

### Step 3 — Branch-isolation check in pos.routes.ts

`apps/sales-service/src/api/pos.routes.ts`: for `POST /pos/sales` and every other route in this file that reads `branchId` from the request body, add a check using `getBranchScope(req.auth)` (or the equivalent membership check `invoice.routes.ts:84` uses) — reject with `403`/a clear `BusinessError` if the submitted `branchId` isn't one the caller is scoped to. Do not change how `branchId` is used once validated — this is a validation addition, not a refactor of the route's business logic.

### OUT OF SCOPE
- Any change to `POST /auth/refresh` itself, or to `apps/web-frontend`'s auth flow
- Idempotency/dedup work on `POST /pos/sales` — that's OFFLINE-02
- Any change to how long access/refresh tokens live (TTL config) unless you discover the current TTLs are actually unworkable for this fix, in which case flag it as a finding rather than silently changing `apps/auth-service/src/config.ts`
- Encrypting/hardening how the refresh token is stored client-side beyond matching the existing access-token storage convention — that's a separate security hardening concern, note it as a "Known Issues" item if it seems warranted

---

## TESTING REQUIREMENTS

1. Login stores both access and refresh tokens in `apps/pos-frontend`
2. A simulated 401 on any wrapped API call triggers exactly one refresh call, then a retry of the original request with the new token
3. A burst of N queued-sale sync calls hitting 401 simultaneously triggers only one refresh call, not N
4. A refresh-token failure (backend returns 401 on `/auth/refresh` itself) results in the existing clear-tokens/force-login behavior, not a crash or infinite retry loop
5. `POST /pos/sales` with a `branchId` not in the caller's JWT `branchIds` is rejected with 403
6. `POST /pos/sales` with a valid, in-scope `branchId` succeeds unchanged
7. Existing POS sale-creation flow (happy path, no token expiry involved) is unaffected

---

## BUILD VERIFICATION

```bash
pnpm --filter @erp/pos-frontend build
pnpm --filter @erp/pos-frontend type-check
pnpm --filter @erp/sales-service build
pnpm lint
pnpm type-check
pnpm test --filter @erp/sales-service
```

---

## VERIFICATION CHECKLIST

- [ ] Refresh token is persisted at login in pos-frontend
- [ ] A 401 mid-session (simulated by an expired/near-expired token) triggers a silent refresh-and-retry, not a forced logout
- [ ] A genuinely invalid/expired refresh token still results in a clean forced re-login (no infinite loop, no crash)
- [ ] `POST /pos/sales` rejects a `branchId` outside the caller's JWT-scoped branches
- [ ] `pnpm lint` and `pnpm type-check` pass repo-wide

---

## REGRESSION CHECKLIST

- [ ] Normal login → immediate sale (no token expiry involved) still works exactly as before
- [ ] Existing offline sale-queueing (`offlineDb.ts`) and manual "Sync now" flow are unaffected by the new auth wrapper
- [ ] `invoice.routes.ts`'s existing branch-scope enforcement is untouched
- [ ] No change to `apps/web-frontend`'s auth behavior

---

## DEFINITION OF DONE

- [ ] pos-frontend persists and uses the refresh token; a multi-hour offline session followed by reconnect no longer forces a manual re-login before sync can proceed
- [ ] `pos.routes.ts` validates `branchId` against the caller's JWT scope on every route that accepts it from the request body
- [ ] All new tests pass; regression suite green
- [ ] `pnpm lint` and `pnpm type-check` pass repo-wide
- [ ] Completion report saved at `ERP-PLANNING/phase-completions/OFFLINE-01_COMPLETION.md`
- [ ] `ERP-PLANNING/reports/OFFLINE_FIRST_ROADMAP.md` updated to mark OFFLINE-01 complete with a pointer to the completion report

---

## COMPLETION REPORT TEMPLATE

**Save as:** `ERP-PLANNING/phase-completions/OFFLINE-01_COMPLETION.md`

```markdown
# OFFLINE-01 Completion Report — POS Token Refresh & Branch Isolation
**Date:** [YYYY-MM-DD]
**Status:** COMPLETE / PARTIAL

## Findings Closed
| Finding | Fix Summary | Verified By |
|---|---|---|
| POS has no refresh-token flow, 15-min token dies during outages | Persisted refresh token + refresh-and-retry wrapper | test |
| `pos.routes.ts` trusts client-submitted branchId | Added getBranchScope validation | test |

## Files Changed
[Table]

## Tests: [N]/[N] PASS | lint: PASS | type-check: PASS | build: PASS

## Known Issues / Deferred
- [Any refresh-token storage hardening not attempted, if applicable]
```
