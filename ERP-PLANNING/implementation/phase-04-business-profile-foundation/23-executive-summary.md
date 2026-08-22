# 23 — Executive Summary

## What

Add `industries`/`business_types` reference tables and `tenants.business_type_id`, backfilled from the existing `vertical` column, with `vertical` retained and kept in sync going forward via a new `setTenantBusinessType()` write path. Schema foundation for Phase 10 (first new industry) — does not launch a new industry itself.

## Why

Directly closes one of Phase 10's own stated readiness gates (`16-phase-roadmap.md`: "a new business type needs a `business_types` row to seed from") before Phase 10 planning needs it, and fixes `02-gap-analysis.md` G2 (`vertical`'s hardcoded 2-value union has no extensible hierarchy). Chosen by the user from `41-phase-2b-closure-review.md` §14.3's option list, independent of `phase-03-hr-payroll-pos-enforcement`'s still-blocked status.

## Why this is structurally safer than Phase 3

Zero enforcement added, zero existing route changed, zero existing behavior altered for any tenant — the backfill is a provably total, lossless function over a closed two-value set (`01-current-code-evidence.md` §4), not a heuristic that could misjudge a tenant's real state. This phase can make an unconditional "zero behavior change" claim that Phase 3 explicitly could not.

## The one real open decision

`04-domain-model.md`'s original design used Module-era terminology (`default_module_keys`) that the shipped architecture (flat `CAPABILITY_REGISTRY`, since doc 21) superseded before this phase was ever planned. `25-decision-record.md` D1 recommends renaming to `default_capability_keys` and seeding it with real registry keys, to avoid repeating the exact naming-drift class `phase-02-inventory-batch-capability/41-phase-2b-closure-review.md` §14.1 already found once. Not blocking for safety — blocking only in the sense that the column's final name/shape needs an answer before the migration is written.

## Scope

One migration (two new tables + one new column + a backfill), one new small service file, one modified existing function call, new test coverage where none existed before. No frontend change, no new route, no permission change, no entitlement change.

## What this phase is not

Not Phase 10. Not a new industry. Not `MODULE_REGISTRY` (confirmed never built, not built here either). Not related to or blocked by `phase-03`'s D1.

## Gate before coding starts

`24-pre-implementation-review.md` — D1 (naming) should be answered first; D2 (migration numbering) is a re-check-at-implementation-time item, not a decision requiring advance user input.
