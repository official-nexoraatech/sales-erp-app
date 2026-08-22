# 15 — Rollout and Rollback

## Why the governing prompt's shadow-mode sequence is not needed for this specific phase

The governing prompt's suggested default (existing behavior → shadow/compatibility mode → validate → enable enforcement → expand → remove legacy path) is designed for rolling out **enforcement onto existing, live behavior** — exactly what the _next_ phase (wiring `requireCapability` onto real HR/Production routes) will need. This phase ships **only the mechanism**, proven entirely by tests, with zero production route or nav item depending on it (`00-overview.md`, `13-migration-and-backward-compatibility.md`). There is no "existing behavior" for this phase to shadow, because nothing existing changes.

## What this phase's rollout actually looks like

1. Merge new files (`capability-registry.ts`, `capability-guard.ts`, test files) + the one-line `platform-sdk` export addition.
2. Deploy normally — this is inert code, unreferenced by any running route, so deployment carries the same (near-zero) risk as deploying an unused utility library.
3. No feature flag needed to gate this phase's own rollout (ironic given the subject matter, but correct: there's nothing user-facing to flag off).

## Rollback

Revert the merge. No data to restore (no migration ran), no route behavior to restore (none changed), no cache to clear (no new cache layer was introduced).

## What the NEXT phase's rollout must look like (documented here for continuity, not built now)

When a future phase wires `requireCapability('HR_PAYROLL', ...)` onto a real `hr-service` route:

1. **Confirm the flag's current real-world state first** — every tenant currently has `hr.payroll.enabled` seeded per `TenantProvisioner`'s existing step (verify no tenant has it unexpectedly `false` today, which would mean this rollout silently cuts off an already-working feature for that tenant — a real regression risk the governing prompt is right to worry about).
2. **Shadow/log-only step recommended**: add the preHandler in a mode that logs what it _would_ deny without actually denying (a `dryRun` param on `requireCapability`, or simply deploying with the check commented out but the log line active) for one release cycle, to catch any tenant whose flag state would unexpectedly block them, before flipping to real enforcement.
3. Enable real enforcement.
4. Remove the shadow/dry-run flag once confidence is established.

This sequencing is deferred to that future phase's own detailed plan, generated after Phase 1 (this one) is implemented and validated, per `ERP-PLANNING/implementation/README.md`'s stated reasoning for not over-planning ahead of validated groundwork.
