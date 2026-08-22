# 17 — Migration and Backward Compatibility

## Before this phase

Every tenant has `vertical` (`CLOTH_RETAIL`/`GROCERY`), no `business_type_id`, no `industries`/`business_types` tables exist.

## During migration

Additive schema (two new tables, one new nullable column) + a total, lossless backfill (`01-current-code-evidence.md` §4 proves this is a 1:1 function over a closed value set, not a best-effort heuristic). No existing query can fail mid-migration — nothing existing references the new tables/column yet, so there is no window where a concurrent read could observe a partially-migrated, inconsistent state that matters to it.

## After this phase

- **Every existing tenant**: `vertical` unchanged, `business_type_id` newly populated, correctly. Zero behavior change for any of the 5 confirmed call sites (`01-current-code-evidence.md` §2) — all five continue reading `vertical`, all five are unaware `business_type_id` exists.
- **New tenants provisioned after this phase**: `setTenantBusinessType()` sets both fields at creation time — no drift window, unlike Phase 3's finding where a tenant could exist with a plan-entitled-but-never-granted flag. This phase's write path has no equivalent gap by construction (single call site, both fields, always together).
- **Existing API consumers of `POST /admin/tenants`**: zero contract change (`07-api-contracts.md`).

## Rollback

Trivial and total — `DROP TABLE business_types, industries CASCADE; ALTER TABLE tenants DROP COLUMN business_type_id;` — nothing depends on the new data (no consumer built in this phase), so there is no "safe resting state" question the way Phase 3's rollback discussion needed (a backfilled-but-unenforced flag is safe; here, there's nothing to "unenforce" at all).

## Honest scope statement

Unlike Phase 3, this phase can honestly claim **zero behavior change for every tenant, without exception** — not a conditional claim. This is the direct consequence of adding no enforcement, no new route, and a provably total backfill function. State this plainly in `20-acceptance-criteria.md`/`23-executive-summary.md` rather than hedging it the way Phase 3 correctly had to.
