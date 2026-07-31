# 05 — UI/UX Implementation Plan

## 1. Conventions (inherited, not invented)

- File structure per `CODING_STANDARDS.md` §7.1: `pages/crm/<feature>/`, `components/ui/` for
  generic primitives (already has `Modal`, `Button`, `Input`, `Select`, `DatePicker`, etc. — reuse
  before adding new ones), `components/common/` for ERP-specific composites (`ERPDataGrid` etc.),
  `api/endpoints/crmApi.ts`-style one-file-per-module, `hooks/useLeads.ts`-style TanStack Query
  wrappers.
- TanStack Query for reads, mutations for writes, `queryClient.invalidateQueries` + `toast` on
  success — exact pattern in `CODING_STANDARDS.md` §7.2, copy it, don't reinvent it per feature.
- Every create/edit/delete action gated by `hasPermission()` from `useAuthStore`, hidden (not
  disabled) when unauthorized, matching `RBAC_ARCHITECTURE.md` §3's UI-gating pattern rolled out to
  ~50 files already — CRM pages are not an exception.
- Dark mode via Tailwind `dark:` variants on every new element — non-negotiable per
  `CODING_STANDARDS.md` §7.5 and this repo's DoD.
- react-hook-form + Zod resolver for every form, matching the shared validation schema style
  already used (`CreateInvoiceSchema` pattern) — CRM Zod schemas should live alongside the route's
  schema on the backend and be mirrored (not necessarily shared as one literal file, since frontend
  and backend are separate packages today) on the frontend.
- No new frontend libraries. `TECH_AUDIT.md` §2's "what is NOT used" list applies — no Redux, no
  Framer Motion, no component library beyond what's already installed (Radix/shadcn/MUI are all
  explicitly out). Journey Builder's canvas/node-graph UI (Phase 2) is the one feature that will
  feel the pressure to reach for a graph library — evaluate against what's already a dependency
  first (a constrained custom SVG/canvas layout is preferable to adding a new heavy dependency for
  one feature, consistent with this codebase's stated minimalism).

## 2. Information architecture changes

- **New top-level nav group is NOT proposed.** Leads, Pipeline, Tickets, and the enhanced Customer
  360 all live under the existing "CRM" nav group in `apps/web-frontend/src/lib/navigation.ts`
  (`NAV_GROUPS`), alongside Segments/Campaigns/Seasons — consistent with AR-1 (no new service means
  no new top-level module either).
- **Customer 360 becomes the hub page**, linked from: the customer list's "View" action (replacing
  today's plain detail page), every Lead's "converted to" reference, every Opportunity's account
  link, and every Ticket's customer reference — one destination, many entry points, per
  `ERP-PLANNING/02_ERP_NAVIGATION_ARCHITECTURE.md`'s existing hub-and-spoke convention (verify that
  doc's current pattern before deviating).
- **Pipeline (Phase 2) is a Kanban board**, the one net-new interaction pattern this roadmap
  introduces to the CRM module — check whether `components/common/` already has a drag-and-drop
  primitive from another module (e.g. any existing Kanban-style board) before building one from
  scratch.

## 3. Component reuse vs. new components needed

| Reuse as-is                                                                                                          | Extend                                                                                                                                                                   | Net new                                                                                                                                        |
| -------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| `Modal`, `Button`, `Input`, `Select`, `DatePicker`, `DateTimePicker`, `Checkbox`, `Badge`, `FileUpload`, `TagsInput` | `ERPDataGrid` (needs SLA-countdown-chip cell renderer for Tickets, weighted-value column for Pipeline)                                                                   | Kanban board component (Leads stage view + Pipeline)                                                                                           |
| `PermissionRoute`, `ProtectedRoute`                                                                                  | Timeline component (referenced in ES-18 prompt — verify it still exists and is generic enough for the unified Customer 360 timeline, or build the unified version fresh) | Journey canvas/node-graph editor (Phase 2)                                                                                                     |
| `useAuthStore`, `hasPermission`                                                                                      |                                                                                                                                                                          | Inbox split-pane (conversation list + thread) (Phase 2)                                                                                        |
| `react-hot-toast`                                                                                                    |                                                                                                                                                                          | Portal frontend shell — separate route tree, `CUSTOMER`-scoped, likely its own top-level layout distinct from the staff `Layout.tsx` (Phase 3) |

## 4. Design system compliance

Every new screen must satisfy this repo's existing DoD checklist (`CODING_STANDARDS.md` §10)
without exception: loading/error/empty states, mobile-responsive breakpoints, dark mode, `title`
attributes on icon-only buttons. The Customer 360 page in particular (Phase 1, highest-traffic new
screen in this roadmap) should get explicit design review against
`ERP-PLANNING/03_ERP_DESIGN_SYSTEM.md` and `06_ERP_DESIGN_TOKENS.md` before implementation, since
it's the first genuinely new "hub" page pattern added since the ERP UI redesign phases.

## 5. Portal is a UX register shift, not just a new route tree

The Self-Service Portal (Phase 3) is used by customers, not trained staff — copy, error messages,
and information density all need a different register than the internal ERP screens (see the
Writing the Copy guidance: name things by what a customer recognizes — "your order," not "sales
order #SO-2026-00412" — active voice, specific error text). This is a UX decision each Portal
feature spec should be checked against individually at implementation time, not a one-time
component-library change.
