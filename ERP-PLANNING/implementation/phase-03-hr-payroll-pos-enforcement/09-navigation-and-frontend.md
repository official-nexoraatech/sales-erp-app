# 09 — Navigation and Frontend

## `web-frontend` — HR & PAYROLL nav group

`apps/web-frontend/src/lib/navigation.ts`, `groupLabel: 'HR & PAYROLL'` (line ~704), contains an `HR` entry (line ~707) and a `/hr/payroll` path entry (line ~737). **Exact node to tag TBD at implementation time** — verify by reading the full group structure fresh (this session confirmed the group and the payroll path exist, but did not read every leaf under the group) whether:

- (i) the whole `HR & PAYROLL` group gets `capabilityKey: 'HR_PAYROLL'` (hides the entire group, including non-payroll HR items like Employees/Attendance, if Payroll is off) — **too broad**, since `HR_PAYROLL` only gates payroll-specific routes, not employee/attendance/leave management, which stay accessible regardless.
- (ii) only the `/hr/payroll` leaf (and any payroll-specific sub-items — salary structures, payroll runs) gets the tag — **correct scope**, matching the backend gate exactly (only `payroll.routes.ts` is gated).

**Recommendation: (ii)**. Gating the whole group would hide Employees/Attendance/Leave for a tenant with `HR_PAYROLL` off, which is wrong — those are core HR functions unrelated to this capability (confirmed by `01-current-code-evidence.md` §3/§4: only `payroll.routes.ts` and `employee.routes.ts`'s in-handler field are `PAYROLL_*`-gated; attendance/leave/employee-lifecycle are not). This mirrors Phase 1's own explicit correction — `20-implementation-report.md` §16 deviation 3 shows the team already caught and fixed an over-broad nav assumption once (`ERPCommandPalette.tsx`); the pattern here is the same kind of care, applied preemptively.

Uses the existing, already-tested `filterNavItem`/`filterNavGroups` mechanism unchanged — `capabilityKey` is set on the node, `Layout.tsx`/`ERPCommandPalette.tsx` already pass `enabledCapabilities` (both call sites wired since Phase 1, confirmed unmodified need in `05-service-impact.md`).

## `pos-frontend` — no equivalent mechanism, real (bounded) new work

Confirmed absent (`01-current-code-evidence.md` §7): no nav-group structure, no `enabledCapabilities` delivery, no `capabilityKey` concept anywhere in `apps/pos-frontend/src`.

**Scope for this phase, bounded deliberately**:

1. `pos-frontend`'s API client must handle a `403 CAPABILITY_NOT_ENABLED` response from any of the 15 gated routes gracefully — i.e., show a clear "Point of Sale isn't enabled for this account, contact your administrator" message instead of a generic error/crash. This is the minimum bar for Phase 3B to not degrade the till operator's experience when (D1-dependent) enforcement is live.
2. **Not built**: a pre-emptive "check capability before rendering the till UI at all" mechanism (the `web-frontend` pattern of hiding a nav entry before the user ever hits a 403). `pos-frontend` has no session-payload equivalent to `GET /users/me`'s `enabledCapabilities` today — building that delivery mechanism from scratch is a materially bigger piece of work than tagging one existing nav node, and is explicitly deferred. Given D1's finding that (once correctly backfilled) no currently-active tenant should ever actually see this 403 in practice, a graceful-error-handling floor is a proportionate scope for this phase; a pre-emptive UI is a reasonable Phase 3C candidate if real usage patterns later show operators hitting the error state often.

## No other frontend change

`web-frontend`'s `ItemFormPage.tsx`/`NearExpiryStockPage.tsx`-style dedicated new pages (Phase 2B's pattern) have no analog here — this phase gates existing routes/UI, it doesn't add a new page.
