# ERP-PLANNING/implementation/phase-04-business-profile-foundation — How to Use This Folder

Status: **Planning only.** No source file, migration, or config was changed to produce any document in this folder. Written 2026-08-19, chosen by the user from `phase-02-inventory-batch-capability/41-phase-2b-closure-review.md` §14.3's three-option list, as the planning target following (but independent of) `phase-03-hr-payroll-pos-enforcement`, which remains blocked on its own D1.

## Naming note — read this first

This folder's number (`04`) is a **filesystem sequence**, not a roadmap position. The source roadmap (`multi-industry-platform/16-phase-roadmap.md`) calls this work **"Phase 1 — Business Profile Foundation"** and treats it as an independent, parallel track, not sequential with the capability-enforcement phases (`phase-01`, `phase-02`, `phase-03`). See `00-overview.md` §1 for the full explanation — this is recorded proactively here to avoid the exact confusion `41`§14.1 already found once for `phase-02`'s naming.

## Start here

`00-overview.md`, then `01-current-code-evidence.md`. Then `25-decision-record.md` for D1 (naming) — recommended to resolve before the migration is written, though not safety-blocking the way `phase-03`'s D1 was.

## Current status: IMPLEMENTED AND VERIFIED (2026-08-19)

D1 confirmed (`25-decision-record.md`: rename to `default_capability_keys`), implemented, and applied to the real dev Postgres instance — not just planned. See `26-implementation-report.md` and `27-post-implementation-review.md`. Migration `0170_business_profile_foundation.sql` is live; all 28 existing dev tenants backfilled with 0 mismatches; full `tenant-service` regression suite green (64/65, 1 pre-existing unrelated skip). One caveat: `27`'s review was a same-session second pass, not an independent-session review — recommended before citing this at Phase 1/2B's verification tier.

## Why this, not Phase 10 itself

This is schema groundwork only — it does not pick or launch a new industry. See `02-business-requirements.md` §2 and `00-overview.md` §7's explicit non-goals.

## What "done" looks like

`industries`/`business_types` tables exist with `COMMERCE`/`CLOTH_RETAIL`/`GROCERY` seed data; every existing tenant's `business_type_id` correctly matches its `vertical`; the 5 real `vertical`-reading call sites (`01-current-code-evidence.md` §2 — one more than the architecture layer's stale "4 known" count) are unmodified and unaffected; a new tenant provisioned after this ships gets both fields set together, always. Full criteria: `20-acceptance-criteria.md`.

## Relationship to `phase-03-hr-payroll-pos-enforcement`

Fully independent — no shared files, no shared migration content, no functional dependency either direction (`00-overview.md` §3, `06-database-impact.md`'s "what this migration does NOT do"). The only coordination point is migration-number sequencing (`25-decision-record.md` D2), since both phases want the next number after `0169`.
