# 10 — Database and Migrations

## Explicit statement: NO database change in this phase

## Why

1. **The registry is code, not data.** `CAPABILITY_REGISTRY` (`03-capability-registry.md`) is a TypeScript object in `packages/shared-types`. A capability only exists because code implementing/gating it exists — a DB-editable registry would let someone "add a capability" through an admin UI with no corresponding enforcement anywhere, which is worse than useless (it would look configurable but do nothing). This mirrors the existing, working precedent: `ROLE_DEFAULTS` and `VERTICAL_DEFAULTS` are both code, not DB tables, for the identical reason.
2. **Capability state reuses `feature_flags` as-is.** Verified this session (`01-current-code-evidence.md` §7) — the existing table (`tenantId` nullable, `flagKey`, `enabled`, `config`, unique on `(tenantId, flagKey)`) already has everything capability resolution needs. No new column, no new table, no new index.
3. **No capability-registry-shaped table exists to migrate away from or consolidate.** Verified this session — grepped `registry|capabilit|modules` across every schema file in `packages/db-client/src/schema/`; the only "registry" hit is `schema_registry` (event-schema versioning, unrelated). Nothing to reuse or avoid duplicating beyond `feature_flags` itself.

## What this means concretely

- No new migration file under `packages/db-client/migrations/`.
- No change to `packages/db-client/src/schema/index.ts` or any schema file.
- No seed-data migration for the 2 proof-of-concept capabilities (`HR_PAYROLL`, `POS`) — their underlying flags (`hr.payroll.enabled`, `pos.enabled`) already exist and are already seeded for real tenants; the registry entries in `capability-registry.ts` simply describe them, they don't create new rows.

## Additional justification found during pre-implementation gate review (2026-08-18)

This phase's "no migration" decision turns out to be even more important than originally reasoned. Verified: `packages/db-client/migrations/meta/` contains drizzle-kit schema snapshots only through `0001_snapshot.json`, while the actual migration history has grown to 169 hand-written `.sql` files (`0000`–`0168`). This is a known, self-documented repo convention (`ERP-PLANNING/phase-completions/ES-04_COMPLETION.md`): running `pnpm drizzle-kit generate` at any point would diff the current schema against the stale 0001 snapshot and attempt to regenerate ~167 migrations' worth of schema as one giant erroneous file. **Practical implication for this phase: do not run `drizzle-kit generate` for any reason, and do not edit `drizzle-schema.ts`** — since this phase makes no schema change, there is nothing to generate, but this is worth stating explicitly so a coding session doesn't reflexively run the documented `db:generate` script out of habit when starting a new phase.

## If a future phase needs a DB change

Explicitly out of scope here, but noted for completeness: if a future phase ever needs capability metadata that genuinely can't live in code (e.g. a per-tenant admin-configurable capability description, or usage analytics per capability), that would be a new, small, clearly-scoped migration at that time — not built speculatively now. Nothing in this phase's design blocks that future possibility, and nothing in this phase requires it.
