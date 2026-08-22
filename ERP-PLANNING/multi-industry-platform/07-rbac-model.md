# 07 — RBAC × Capability Integration

## 1. Preserve exactly as-is

Per the brief's explicit instruction and CLAUDE.md's surgical-changes principle: **RESOURCE_ACTION naming is not renamed, not restructured, not moved.** `packages/shared-types/src/permissions.ts`'s ~330 flat constants, `ROLE_DEFAULTS`, and JWT-embedded `permissions[]` all continue unchanged.

## 2. What's added: module-association metadata, not a schema change

A new, purely-additive map — not a new column on `permissions.ts`'s constants (they're `as const` string literals, not a mutable structure), and not a rename:

```ts
// packages/shared-types/src/module-permissions.ts (new file)
export const MODULE_PERMISSION_PREFIXES: Record<string, string[]> = {
  hr: ['HR_', 'EMPLOYEE_', 'ATTENDANCE_', 'PAYROLL_', 'LEAVE_'],
  crm: [
    'CRM_',
    'LEAD_',
    'TICKET_',
    'OPPORTUNITY_',
    'JOURNEY_',
    'TERRITORY_',
    'QUOTA_',
    'REFERRAL_',
    'CONVERSATION_',
    'CALL_',
  ],
  gst: ['GSTR1_', 'GSTR2A_', 'GSTR3B_', 'GSTR9_'],
  pos: ['POS_'],
  // populated incrementally per module as MODULE_REGISTRY (04-domain-model.md) grows
};
```

This mirrors `04-domain-model.md`'s `ModuleDefinition.permissionPrefixes` field — in practice the same data, defined once and referenced by both the module registry and any RBAC tooling that wants it (e.g. an admin UI listing "permissions belonging to module X").

## 3. Why prefix-derived, not a permission-by-permission table

The existing ~330 permissions already follow the prefix convention in practice (`01-current-state.md` §4) — deriving module membership by prefix match avoids hand-maintaining a 330-row mapping that would drift the moment a new permission is added and its module tag forgotten. The handful of permissions that don't cleanly prefix-match their module (e.g. cross-cutting ones like `BRANCH_SCOPE_BYPASS`) simply aren't claimed by any module — that's correct, since they're platform-level, not module-level, permissions.

## 4. Effective authorization at request time — unchanged mechanism, one more layer

```
1. requireModule('hr')       -- NEW, only on module-gateable route trees (05-module-capability-model.md §5)
2. requirePermission(X)      -- EXISTING, unchanged, every route already has this
```

These are independent checks, not merged into one — a user can hold `HR_VIEW` permission (granted by their role) while the `hr` module itself is disabled for the tenant; `requireModule` fails first with a distinct, clearer error (`MODULE_NOT_ENABLED` vs `PERMISSION_DENIED`). This distinction matters for the frontend: "you don't have access" (permission) vs. "this feature isn't part of your plan" (module/entitlement) are different UX messages, and conflating them would be a regression from the current single-reason `403`.

## 5. No change to role-default seeding logic per se

`ROLE_DEFAULTS`/`VERTICAL_DEFAULTS` continue to grant permissions exactly as today. A new business type does not need new roles unless its domain genuinely requires a new role (e.g. Hotel's `FRONT_DESK` or `HOUSEKEEPING` role) — most new business types should reuse existing roles (`STAFF`, `MANAGER`-equivalents) per the brief's reuse-over-fork principle, adding new roles only where the job function is genuinely new.
