# 22 — Phase 12: Future Industry Expansion Framework Review

Per `16-phase-roadmap.md`'s own framing: "once 2 new industries have gone through the Business
Profile pipeline, review whether the model needs generalizing further — a review checkpoint, not
pre-built speculative infrastructure." Grocery and Distribution have both shipped. This is that
review, grounded in the actual code, not the original planning docs' assumptions.

## 1. What actually got proven

Distribution went through the pipeline cleanly: new `business_types` row, `VERTICAL_DEFAULTS`
entry, three capability-registry touch-points (`HR_PAYROLL`, `POS`, `INVENTORY_BATCH` — all
**already existing** entries, none new). Zero schema changes to `CAPABILITY_REGISTRY` itself.

**This is a weaker validation than it looks.** `19-first-industry-recommendation.md` flagged this
in advance: Distribution is "weakest as a validation case... too similar to existing verticals to
stress-test the Registry's ability to add genuinely new capability." That prediction held —
Distribution never needed a new `CAPABILITY_REGISTRY` entry, so the one part of the model a real
new industry would actually exercise (adding a brand-new capability, not just re-flagging
existing ones) has **not been tested yet** by either Grocery or Distribution.

## 2. A real, previously-undetected gap: two parallel, disagreeing mechanisms

`business_types.defaultCapabilityKeys` (seeded by migration `0170`, and again by Distribution's
own `0172`) is explicitly documented in its own schema comment as **"descriptive metadata only —
not read by capability resolution... seeded now so a later phase that builds the provisioning-
time consumer doesn't need a second migration."** That later phase was never built. The actual
provisioning-time source of truth is a completely different, code-only mechanism:
`apps/tenant-service/src/rbac/vertical-defaults.ts`'s `VERTICAL_DEFAULTS` record, keyed by
`TenantVertical` (a hardcoded union type), not `business_types.code`.

Concretely, today: `TenantProvisioner.provision()` reads `VERTICAL_DEFAULTS[vertical]` to decide a
tenant's feature flags. It never reads `business_types.defaultCapabilityKeys` at all — that column
is populated, seeded correctly for every business type shipped so far, and completely inert.

**This is duplication waiting to drift.** Two people (or two future sessions) could reasonably
each update "the" capability defaults for a business type — one in the DB seed migration, one in
`VERTICAL_DEFAULTS` — and never notice the other exists. It hasn't caused a real bug yet only
because every vertical shipped so far has kept both in sync by hand. A 3rd industry doesn't
increase the risk of drift on its own, but each additional vertical is one more place this could
silently diverge, and no test anywhere asserts the two stay consistent.

## 3. Does the model need to generalize before a 3rd industry? — No, not structurally

The flat `CAPABILITY_REGISTRY` shape (one entry = one flag + permissions + applicable business
types) has not shown any strain in the two verticals it's carried so far. Nothing found in this
review suggests the shape itself needs a new hierarchy level (e.g. Module → Capability) — that was
`04-domain-model.md` §6's original speculative escape hatch, and nothing built since has needed it.

**What should happen before a 3rd industry, in order of actual risk:**

1. **Resolve the `VERTICAL_DEFAULTS`/`business_types.defaultCapabilityKeys` duplication** — either
   build the promised provisioning-time consumer of the DB column and retire `VERTICAL_DEFAULTS`,
   or delete/rename the DB column's misleading "not yet consumed" framing and formally accept
   `VERTICAL_DEFAULTS` as the permanent, code-only source of truth. Small, mechanical, no new
   architecture either way — but should be a deliberate choice, not left ambiguous.
2. **Pick a 3rd industry that actually exercises new-capability creation**, not another reuse-heavy
   one. Per `19-first-industry-recommendation.md`'s own ranking (unchanged, re-confirmed by this
   review): **Manufacturing** is the right next candidate specifically _because_ it needs several
   genuinely new capabilities (BOM, Work Centers, MRP) under one business type — the actual test
   Distribution didn't provide. `production-service` already exists with known QA-flagged gaps
   (per `qa_production_module_2026_07_12` memory) to fix alongside.

## 4. Verdict

Model: **sound, not proven under load.** Two reuse-heavy verticals succeeded; the
harder case (composing multiple brand-new capabilities under one business type) remains
untested. Recommend closing item 1 above (small, mechanical) before or alongside starting
Manufacturing, so the 3rd industry doesn't inherit an already-known, silently-diverging
duplication.

This is a recommendation, not a decision this review makes unilaterally — matches
`19-first-industry-recommendation.md`'s own stated framing that vertical choice is a business call.
