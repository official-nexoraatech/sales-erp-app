# 25 — Decision Record

Neither decision here is safety-blocking in the sense Phase 3's D1 was (nothing here risks breaking an active tenant) — but both determine the exact schema shape, so the migration cannot be finalized without them, per the same "record, don't silently resolve" discipline `phase-02`/`phase-03`'s decision records established.

**Status: D1 CONFIRMED by the user, 2026-08-19 — option (a), rename to `default_capability_keys`.** This phase is cleared to proceed to implementation — see `24-pre-implementation-review.md`'s updated verdict. `04-domain-model.md` and `06-database-impact.md` already reflect this choice (they were written assuming the recommended option).

---

## D1 — `default_module_keys` or `default_capability_keys`?

**CONFIRMED 2026-08-19: Option (a), rename to `default_capability_keys`.**

### The problem

`04-domain-model.md` §2 (written before Phase 1 shipped) specifies:

```sql
default_module_keys jsonb NOT NULL DEFAULT '[]'   -- ['pos','inventory','crm','hr', ...]
```

This is a **Module**-model field — `05-module-capability-model.md`'s two-tier `Module → Capability` design, with lowercase, lifecycle-agnostic keys (`'hr'`, `'pos'`). `21-capability-resolution-architecture.md` (written after a structured review of docs 00-20) **collapsed this into one flat `CAPABILITY_REGISTRY`**, and every phase actually shipped since (Phase 1, Phase 2B) uses that flat model exclusively — uppercase, registry-defined keys (`'HR_PAYROLL'`, `'POS'`, `'INVENTORY_BATCH'`), no `MODULE_REGISTRY` exists anywhere in the running code (confirmed, `phase-01-capability-foundation/20-implementation-report.md` never built one; `01-current-code-evidence.md` §3 confirms zero `business_types`/module-registry table exists to check against). Writing this phase's schema with the original `04-domain-model.md` field name/shape would introduce a table whose seed data cannot be consumed by anything that actually exists.

### Options

**(a) Rename to `default_capability_keys jsonb`, seeded with real `CAPABILITY_REGISTRY` keys.** E.g. `CLOTH_RETAIL: []`, `GROCERY: ['INVENTORY_BATCH']` (matching that capability's real `applicableBusinessTypes: ['GROCERY', ...]` metadata, `phase-02-inventory-batch-capability`'s shipped registry entry). Directly consumable by a future provisioning-time seeding step (`05-module-capability-model.md` §4's generalization of `seedFeatureFlags`, itself still unbuilt) without any translation layer.

**(b) Keep `default_module_keys` as originally named, treat "module" as a documentation-only synonym for "capability" in this context.** Avoids a one-word rename; risks perpetuating exactly the terminology drift `phase-02-inventory-batch-capability/41-phase-2b-closure-review.md` §14.1 already found once (a folder/field name that doesn't match what was actually built, inviting a future reader to assume a `MODULE_REGISTRY` exists when it doesn't).

**(c) Add the column, but leave it empty/unseeded in this phase**, deferring the naming decision to whichever future phase actually builds the provisioning-time consumer. Minimal now, but re-opens the same question later with no more information than exists today — doesn't actually resolve anything, just postpones.

### Recommendation: **(a)**.

Consistent with this repository's own established pattern of correcting stale terminology when a later architectural decision (doc 21) supersedes an earlier one (docs 04/05/07/08), rather than perpetuating it into new schema. The rename is free right now (the column doesn't exist yet — this is not a migration-of-a-migration, just picking the right name the first time) and directly prevents a repeat of the `phase-02` naming-drift finding. **Not decided by this document** — the user must confirm (a), (b), or (c) before `04-domain-model.md`'s final table shape and `06-database-impact.md`'s migration SQL can be written.

### If (a): seed data content, decided alongside D1

```
CLOTH_RETAIL: []                    -- no optional capability currently applies (HR_PAYROLL/POS are
                                     -- both GA and applicableBusinessTypes-tagged for CLOTH_RETAIL too,
                                     -- but neither is "default" in the sense of auto-enabling —
                                     -- see 04-domain-model.md's own note on this distinction)
GROCERY:      ['INVENTORY_BATCH']   -- matches the real registry entry's applicableBusinessTypes
```

This seed data is **descriptive metadata only** in this phase (nothing reads `default_capability_keys` at provisioning time yet — that's `05-module-capability-model.md` §4's still-unbuilt generalization of `seedFeatureFlags`, explicitly out of this phase's scope, `00-overview.md` §7). Seeding it correctly now avoids a second migration later purely to fix data, but does not imply this phase makes it functionally load-bearing.

---

## D2 — Migration numbering coordination with `phase-03-hr-payroll-pos-enforcement`

Both this phase and `phase-03` (if its own D1 resolves toward a backfill) want the next sequential migration number after `0169`. Whichever phase's migration is actually implemented and merged first claims `0170`; the other becomes `0171` at implementation time — **not decided by this planning pass**, since neither phase has been authorized to write code yet. Flagged here so neither phase's `06-database-impact.md` hardcodes a number that collides with the other's. **Recommendation**: whoever picks up implementation should re-check `packages/db-client/migrations/meta/_journal.json`'s tail entry immediately before authoring either migration file, not trust either plan document's illustrative number.

No functional dependency exists between the two migrations (`00-overview.md` §3) — this is purely a numbering-collision avoidance note, not a sequencing requirement.
