# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

`texmitra-frontend` — React + TypeScript + Vite SPA for the "Sales ERP" / TexMitra billing and inventory
application. Talks to the sibling backend `../sale-erp-backend` (Spring Boot REST API on port 8081 by
default) — API contracts (response envelope shape, permission name strings) must stay in sync with it.

## Commands

```bash
npm run dev        # Vite dev server on :5173, proxies /api -> http://127.0.0.1:8081
npm run build       # tsc (type-check, noEmit) then vite build
npm run preview     # Preview a production build
npm run test:e2e    # node scripts/e2e-smoke.mjs
```

There is no unit test runner or lint script configured in `package.json`. Type-check with `npx tsc --noEmit`
(same check `npm run build` runs first) before considering frontend work done — this codebase has caught
regressions this way historically.

## Architecture

### Data flow

- `api/axiosClient.ts` is the single Axios instance for all requests. Request interceptor: attaches
  `Authorization: Bearer <token>` from `store/authStore.ts` (Zustand, localStorage-persisted), checks
  session expiry (`isSessionValid()`) and force-logs-out + redirects to `/login` on a stale token, and
  attaches `X-Branch-Id` from `store/branchStore.ts` — but only for non-super-admin roles (super admin has
  implicit access to all branches, mirroring backend `BillTopUserDetails` admin-bypass logic). Response
  interceptor unwraps `response.data` (the backend's `ApiResponseDto` envelope) and toasts errors via
  `react-hot-toast`, force-logging-out on 401.
- `api/endpoints.ts` defines one function-per-endpoint grouped by module (e.g. `branchApi`, `expenseApi`),
  all built on `axiosClient`. Add new endpoints here, not inline in components.
- Data fetching/caching uses TanStack Query (`app/queryClient.ts`). Mutations typically call
  `queryClient.invalidateQueries()` with no key (full invalidate) rather than hand-maintaining branch- or
  module-scoped query keys — follow this pattern unless a specific page has a proven reason not to.
- Types mirroring backend DTOs live in `types/api.types.ts` (and per-domain `types/*.types.ts`). Keep field
  names identical to the backend DTOs — there's no codegen, so drift is caught only by manual review/testing.

### Auth & permissions

- `store/authStore.ts` holds the JWT, user, expiry, and permission list from login; `hooks/useAuth.ts` is
  the read hook (`hasAnyPermission`, `hasAllPermissions`, etc.).
- `auth/permissions.ts` defines the `PERMISSIONS` constant map — string values **must match** the backend's
  permission names exactly (see backend `permissions-config.yaml`). `auth/featurePermissions.ts` builds
  higher-level `FEATURE_PERMISSIONS` groupings, `isSuperAdminRole()`, and `getDefaultAuthorizedPath()` (used
  to redirect a user to the first page they're actually allowed to see).
- `components/layout/ProtectedRoute.tsx` wraps routes in `app/router.tsx`; pass `permissions`/`requireAll`
  to gate a route, otherwise it only checks authentication/session validity.
- Branch switching: `store/branchStore.ts` (Zustand + persist, cleared on logout so it never leaks across
  accounts), `hooks/useBranch.ts`, `components/layout/BranchSwitcher.tsx` in `AppHeader`. **Only some backend
  modules are branch-scoped yet** (Warehouse, Contact/Customer/Supplier, Branch itself) — see the backend's
  `CLAUDE.md` for the current rollout status before assuming a new module respects `X-Branch-Id`.

### Page structure

Pages live under `pages/<module>/`, one subfolder per domain (e.g. `pages/expense`, `pages/items`,
`pages/sales/invoices`, `pages/purchase/bills`). Each CRUD module follows the same file split:
`<Module>ListPage.tsx`, `<Module>CreatePage.tsx` / `<Module>FormPage.tsx`, `<Module>EditPage.tsx`,
`<Module>ViewPage.tsx`, often a shared `<Module>Form.tsx` used by both create and edit, and a
`<module>.schema.ts` Zod schema for `react-hook-form` validation via `@hookform/resolvers`. New CRUD modules
should follow an existing sibling folder (e.g. Warehouse or Expense) as the template rather than inventing a
new structure.

All routes are registered by hand in `app/router.tsx` (no file-based routing) — adding a page means adding
both the component file and a route entry (typically wrapped in `ProtectedRoute` with the matching
permission).

### UI components

Reusable primitives are in `components/ui/` (Button, Input, Select, Table, Modal, Pagination, etc.) and
`components/common/` (DataTable, SearchBox, StatusBadge). Prefer these over ad hoc markup. Styling is
Tailwind CSS v4 (`tailwind.config.js`, `postcss.config.js`) with dark-mode variants used throughout
(`dark:` classes) — match existing dark-mode handling when adding new UI.

### Notable constraints

- TS config (`tsconfig.json`) has `noUnusedLocals`/`noUnusedParameters`/`verbatimModuleSyntax` enabled —
  type-only imports must use `import type`, and unused vars/params will fail `npm run build`.
- No path aliases configured — imports are relative (`../../auth/featurePermissions`, etc.).
