# ES-33 — RBAC Audit Phase A: Critical Auth Gaps
## STATUS: ✅ COMPLETED
## Sprint: Enterprise RBAC Refactor (Phase A of 5) | Effort: 0.5–1 day | Risk: Low
## Depends on: None (independent)
## Unlocks: ES-34, ES-35, ES-31, ES-32 (remaining RBAC refactor phases)

---

## YOUR ROLE

You are the **Principal Backend Engineer** on the NEXORAA Multi-Tenant Cloth Retail ERP,
kicking off a 5-phase enterprise RBAC audit and refactor. This phase fixes concrete,
already-identified unauthenticated/under-authorized endpoints before any architectural
cleanup begins.

---

## CONTEXT

A broad RBAC audit (3 parallel research passes: frontend, backend, prior-audit-history)
found the RBAC foundation is largely solid (DB-backed roles, 296 backend permissions,
frontend route guards on 21+ pages, permission-filtered sidebar) but surfaced concrete,
previously-undocumented gaps in backend route enforcement. This phase closes those gaps
before Phases B–E (login/UX, backend model cleanup, branch-level permissions + RLS,
frontend UI-level gating) build on top of a clean baseline.

---

## OBJECTIVE

1. `apps/gst-service/src/api/einvoice.routes.ts` — `POST /gst/einvoice/retry-pending` has
   **zero** auth. Its `config: { internalOnly: true }` flag is dead metadata, never read
   anywhere. Confirm the caller (scheduler-service's cron job) and wire the standard
   `requireInternalKey()` check.
2. `apps/scheduler-service` has no `authenticate` middleware wired at all, yet its routes
   guard on a local `hasPermission()` reading `request.auth` — meaning `request.auth` is
   always `undefined` and every route is unconditionally 403. Wire `authenticate`.
3. `notification-service`'s `POST /notifications/send` and `search-service`'s
   `POST /search/index` / `DELETE /search/index/:entity/:id` have `authenticate` only, no
   permission check, despite matching permission constants already existing. Add the
   missing permission checks.
4. Regression-verify (do not re-fix) that the previously-closed auth-bypass chain (C1–C3,
   H1, H12, M17 from `ARCHITECTURE_AUDIT_REPORT.md`, closed by ES-21) is still closed.
5. Re-run the repo-wide grep the architecture report recommended but never fully
   completed: search for `request.params.tenantId` / `request.body.tenantId` used as an
   authorization boundary instead of `request.auth.tenantId` (the JWT claim), across all
   services.

---

## ARCHITECTURE RULE

Same as ES-07: permission checks live at the route layer only, using
`preHandler: [authenticate, requirePermission(PERMISSIONS.X)]` (or the file's existing
local `hasPermission()` inline-check style where that's already the established pattern
for that service/file — match what's already there, don't introduce a second style in the
same file). Internal/service-to-service routes use `requireInternalKey()` (timing-safe
`x-internal-key` header compare against `INTERNAL_API_KEY`), never a user JWT.

---

## VERIFICATION CHECKLIST

- [x] `POST /gst/einvoice/retry-pending` → 401 without/with-wrong `x-internal-key`, 200 with correct key
- [x] `scheduler-service` routes → 401 without JWT, 403 with JWT lacking the permission, 200 with it
- [x] `POST /notifications/send` → 403 without `NOTIFICATION_SEND`
- [x] `POST /search/index`, `DELETE /search/index/:entity/:id` → 403 without `SEARCH_REINDEX`
- [x] C1–C3/H1/H12/M17 confirmed still closed
- [x] Repo-wide `tenantId`-from-param grep: zero new findings
- [x] `pnpm type-check` clean on all 4 touched services
- [x] No new lint error classes introduced (remaining errors are pre-existing, confirmed via identical unmodified sibling files)
- [x] Completion report saved at `ERP-PLANNING/phase-completions/ES-33_COMPLETION.md`
