# ES-34 — RBAC Audit Phase B: Login Redirect & Access UX
## STATUS: ✅ COMPLETED
## Sprint: Enterprise RBAC Refactor (Phase B of 5) | Effort: 0.5–1 day | Risk: Low
## Depends on: ES-33
## Unlocks: ES-35, ES-31, ES-32

---

## YOUR ROLE

You are the **Principal Frontend Engineer** on the NEXORAA Multi-Tenant Cloth Retail ERP,
continuing the 5-phase enterprise RBAC audit and refactor.

---

## CONTEXT

Frontend research found every user is hardcoded to land on `/dashboard` after login
(`LoginPage.tsx`) and on the root path (`App.tsx` index route), regardless of whether they
hold `DASHBOARD_VIEW`. Users without it land straight on a generic "Access Denied" screen
right after signing in. There was also no "No Modules Assigned" page for a genuinely
zero-permission new user, and `client.ts`'s token refresh never re-applied updated
permissions mid-session.

---

## OBJECTIVE

1. Extract the sidebar's `NAV_GROUPS`/permission-filter logic out of `Layout.tsx` into a
   shared `src/lib/navigation.ts` module, so the sidebar and the login-redirect logic use
   one single source of truth for "what can this user reach" — add
   `getFirstAccessiblePath()`.
2. Replace the hardcoded `/dashboard` redirects (`LoginPage.tsx` post-login, `App.tsx`
   index route) with a redirect to the first nav item the user actually has permission
   for, in `NAV_GROUPS` declaration order.
3. Build a "No Modules Assigned" page/route for users with zero accessible modules.
4. Fix `client.ts`'s token-refresh flow to re-decode and re-apply `roles`/`permissions`
   from the refreshed JWT.
5. Confirm whether `/security` being permission-unguarded is intentional.
6. Reconcile the unused fine-grained inventory permissions vs. `WAREHOUSE_MANAGE`.

---

## VERIFICATION CHECKLIST

- [x] `getFirstAccessiblePath` returns the correct landing page for: full-access user,
      single-module user, zero-permission user (unit-tested)
- [x] Sidebar and login-redirect share the exact same filter logic (no drift possible)
- [x] `/no-access` page renders for zero-permission users, not a bare error screen
- [x] Token refresh re-applies updated permissions without requiring re-login
- [x] `/security` route decision documented (intentional — personal account page)
- [x] `pnpm --filter @erp/web-frontend type-check` clean
- [x] `pnpm --filter @erp/web-frontend test` — all pass, no regressions
- [x] Completion report saved at `ERP-PLANNING/phase-completions/ES-34_COMPLETION.md`
