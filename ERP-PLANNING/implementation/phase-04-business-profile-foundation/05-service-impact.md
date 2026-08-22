# 05 — Service Impact

## `apps/tenant-service` — the only service with real code changes

**New file: `apps/tenant-service/src/domain/setTenantBusinessType.ts`** (or a method on an existing domain class — `TO VERIFY` at implementation time which fits the codebase's existing convention better; `TenantProvisioner.ts` and `BillingService.ts` are both plausible homes, but neither currently owns "which business type is this tenant" as a concern, so a small new file is the more surgical choice per CLAUDE.md §3, avoiding forcing this into an unrelated class):

```ts
export async function setTenantBusinessType(
  db: ErpDatabase,
  tenantId: number,
  businessTypeCode: TenantVertical
): Promise<void> {
  const businessType = await db.query.businessTypes.findFirst({
    where: eq(businessTypes.code, businessTypeCode),
  });
  if (!businessType)
    throw new BusinessError('UNKNOWN_BUSINESS_TYPE', `No business type: ${businessTypeCode}`);
  await db
    .update(tenants)
    .set({
      vertical: businessTypeCode,
      businessTypeId: businessType.id,
    })
    .where(eq(tenants.id, tenantId));
}
```

**Modified: `apps/tenant-service/src/domain/TenantProvisioner.ts:78`** — the existing `const vertical: TenantVertical = input.vertical ?? 'CLOTH_RETAIL';` line is unchanged in logic; the subsequent tenant-insert step (wherever `vertical` is currently written to the new tenant row — `TO VERIFY` exact line, not read in full this session) is extended to also resolve and write `business_type_id` via the new helper (or inline, if the team prefers not to introduce a new file for a single call site — a legitimate simplification, see `21-file-level-change-plan.md`).

## `apps/accounting-service`, `apps/tenant-service/src/rbac/vertical-defaults.ts`, `scheduler-internal.routes.ts`

**Unchanged.** Per `15-migration-strategy.md` step 2's explicit design goal: these three call sites keep reading `vertical` exactly as today, because `setTenantBusinessType()` keeps it synced. This is the entire point of retaining `vertical` rather than a big-bang rename (ADR-01) — confirmed by this phase's own domain model (`04-domain-model.md` §3).

## `apps/tenant-service/src/api/tenant.schemas.ts`

**Modified**, per `01-current-code-evidence.md` §2 row 5's finding: `CreateTenantSchema`'s `vertical: z.enum(['CLOTH_RETAIL', 'GROCERY'])` stays exactly as-is for this phase — **not** widened or replaced. This phase adds `business_type_id` as a resolvable _derived_ value (looked up from `vertical`, per `04-domain-model.md`), not a second, independent input field. Changing this enum to accept a new business type is Phase 10's job, not this phase's — this phase only builds the table the enum's values could someday be validated against, without doing that validation-source swap yet (that would require the enum's _values_ to actually change, i.e., a real new business type, out of scope per `00-overview.md` §7). **Recorded as a deliberate non-change**, not an oversight — flagged since it's tempting to conflate "we built the reference table" with "we should immediately wire it into every validation boundary," which this phase's own scope discipline rejects.

## `apps/tenant-service/src/api/tenant.routes.ts:154`

**Optionally modified**: the `TENANT_CREATED` audit-log payload could additionally record `businessTypeId`/`businessTypeCode` alongside the existing `vertical` field, for audit completeness. Low-value, low-risk, not required for any acceptance criterion — noted in `21-file-level-change-plan.md` as optional, not required.

## No other service touched

`packages/db-client/src/schema/*.ts` gains the two new table definitions and the one new column (schema-package change, not really a "service" — tracked in `06-database-impact.md`/`21-file-level-change-plan.md`). No file in `apps/hr-service`, `apps/sales-service`, `apps/inventory-service`, `apps/web-frontend`, `apps/auth-service`, `apps/api-gateway`, or any other service changes.
