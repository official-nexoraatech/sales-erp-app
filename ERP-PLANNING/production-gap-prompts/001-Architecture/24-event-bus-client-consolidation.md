# [PG-003] Event-Bus-Client Consolidation

> Template version 1.0. Every gap-prompt file in this tree must follow this exact section order. Do not add sections; do not omit sections that apply. If a section genuinely does not apply to this gap, write "Not applicable — <one-line reason>" instead of deleting it, so the structure stays diffable across files.

**Category:** Architecture
**Priority:** High
**Complexity:** M — mostly deletion + documentation; no new wrapper needs to be built
**Depends on:** none
**Blocks:** none
**Primary service(s)/package(s):** packages/event-bus-client (orphaned), packages/platform-sdk (`@erp/sdk`, `PlatformEventBus`/`PlatformEventConsumer`/`OutboxPublisher`), apps/event-service

---

## Overview

- **Business objective:** avoid two competing "the way to talk to Kafka" stories in the codebase — one abandoned package and one actually-used pattern — which otherwise confuses new contributors into either resurrecting the dead package or hand-rolling a third approach.
- **Current implementation:** `packages/event-bus-client/` has **no `package.json` and no `src/` directory at all** — only a stale `dist/index.d.ts`/`dist/index.js` build output survives from some earlier commit. Its declared shape (from the committed `.d.ts`) was a minimal `createEventProducer`/`createEventConsumer` pair returning `EventProducer`/`EventConsumer` interfaces (`publish`, `publishBatch`, `subscribe`, `disconnect`) — functionally a thin kafkajs wrapper, never implemented beyond the type declarations, and with the source deleted at some point while the compiled output was left committed (the same "stale compiled artifact" pattern noted elsewhere in this codebase's history — see `[[erp_db_vitest_barrel_export_bug]]` in project memory for a similar root cause in a different package).
- **Current architecture — corrected from FEATURE_INVENTORY.md §7:** the inventory doc states "every service rolled its own raw `kafkajs` client instead" of using the orphaned wrapper. **This is only true for the low-level connection bootstrap, not for the actual publish/consume logic.** Verified by direct read of `apps/accounting-service/src/main.ts` and `apps/gst-service/src/main.ts`: each service does call `new Kafka({ clientId, brokers, retry })` directly (unavoidable — some concrete client instance has to be constructed and injected), but immediately wraps it: `new PlatformEventConsumer(kafka, '<service>-group', '<service-name>')`. `PlatformEventConsumer` (in `packages/platform-sdk/src/events.ts`, exported from `@erp/sdk`) already provides the shared consumption logic: topic subscription, an inbox-table-based idempotency check (`inboxEvents` — an `onConflictDoUpdate` claim pattern that prevents double-processing on redelivery, with an explicit code comment documenting why it replaced an earlier racy SELECT-then-INSERT check), and per-message error handling that marks the inbox row `FAILED` without crashing the consumer loop. On the producer side, `PlatformEventBus.publish()`/`publishInTransaction()` write to the `outbox_events` table via `TenantScopedDatabase.insertIntoOutbox()` — services never call `producer.send()` directly; that only happens inside the outbox relay (see PG-007).
- **Current limitations:** the actual, real gap is that **`@erp/sdk` itself ships a second, unused outbox publisher** — `OutboxPublisher` in the same `events.ts` file (a "hardened, M12.3" 100ms-poll version with schema validation and DLQ-on-retry-exceeded) — that is exported from the package's `index.ts` but has **zero callers anywhere in `apps/`**. The actually-running relay is `event-service`'s own hand-written `OutboxRelayWorker` (`apps/event-service/src/outbox/OutboxRelayWorker.ts`, 500ms poll / 100-row batch / 5-retry, matching `FEATURE_INVENTORY.md`'s description exactly). So there are, in effect, **three** outbox-relay-shaped things in this codebase: the orphaned `event-bus-client` package (dead, no source), `@erp/sdk`'s `OutboxPublisher` (dead, no callers, more "hardened" per its own comments but never adopted), and `event-service`'s `OutboxRelayWorker` (the one actually running in production). This is a more precise and more actionable finding than the inventory doc's framing.

## Existing Code Analysis

- **What already exists and should be reused:** `PlatformEventBus` (producer side, transactional outbox writes) and `PlatformEventConsumer` (consumer side, inbox-idempotent Kafka subscription) in `packages/platform-sdk/src/events.ts` — this pair is the real, working, already-adopted shared event-bus wrapper. It lives in `@erp/sdk`, not in a standalone `event-bus-client` package, but it fulfills exactly the role the orphaned package's type declarations describe.
- **What should never be modified:** do not touch `event-service`'s `OutboxRelayWorker` as part of this package — it is the correctly-running relay and is explicitly in scope for a different, narrower fix (PG-007, the DLQ-replay gap). Do not touch any service's `main.ts` `new Kafka({...})` bootstrap call — that low-level construction is necessary and correct; only the orphaned package and the unused `OutboxPublisher` are in scope here.
- **Prior related work:** none in `ERP-PLANNING/phase-completions/` names `event-bus-client` specifically. `ERP_MASTER_SPEC` §4.1 (quoted verbatim in `platform-sdk/src/index.ts`'s own top comment: "All infrastructure access MUST go through the SDK") is the existing house rule this package's recommendation aligns with.

## Architecture

- **Decision, with justification:** delete the orphaned `packages/event-bus-client` (no source exists to "finish" — there is nothing to migrate off of since it was never actually used; recreating it from its stale `.d.ts` would be pure duplication of `PlatformEventBus`/`PlatformEventConsumer`, which already do the same job and are already the adopted pattern). Do **not** build a new wrapper — the "avoid duplicate implementations" principle here argues directly against resurrecting this package, and the "don't redesign unless absolutely necessary" principle argues against inventing a fourth Kafka abstraction when a working third one (`@erp/sdk`'s pair) is already in place. This is the more conservative reading of the task's own two competing heuristics: churn-avoidance wins because there are, in fact, zero current callers of the orphaned package to migrate — migration risk is zero, deletion risk is zero.
- **Secondary finding requiring its own decision:** `OutboxPublisher` in `@erp/sdk` is unused dead code sitting alongside the two classes that ARE used. Recommend deleting `OutboxPublisher` and its export from `packages/platform-sdk/src/index.ts` as well, since keeping an unused "hardened" alternative next to the real one is exactly the kind of confusing duplicate-implementation this whole package is meant to prevent — a future engineer could easily wire it in by mistake, creating two relays racing over the same `outbox_events` rows. If there is a reason to keep it (e.g. a documented intent to migrate `event-service`'s relay onto it later for its faster poll interval and schema validation), that should become its own explicitly-scoped follow-up gap, not silently-coexisting dead code.
- **Component interactions:** no new components — this package only removes two dead artifacts and adds documentation making the sanctioned pattern explicit.

## Database Changes

Not applicable — no schema change.

## Backend

- **Deletions:** `packages/event-bus-client/` (entire package — no `package.json` exists to even register it as a workspace member; confirm it isn't referenced in `pnpm-workspace.yaml` or any `package.json` `dependencies`/`devDependencies` before deleting, though this pass found no such reference). `OutboxPublisher` class and its export line in `packages/platform-sdk/src/index.ts` (and its source in `events.ts`), after confirming zero callers via a final grep pass at implementation time (concurrent work could theoretically have added one since this file was written — re-verify per the roadmap's own "hypothesis to confirm, not a fact to build on blind" rule).
- **Documentation addition:** add a short section to `packages/platform-sdk/README.md` (create if it doesn't exist) titled "Kafka usage convention" stating: services construct their own `Kafka` client for connection bootstrap, then always wrap it with `PlatformEventConsumer` for consumption and always publish via `PlatformEventBus`/`TenantScopedDatabase.insertIntoOutbox()` for the transactional-outbox producer side — never call `producer.send()` directly outside the outbox relay itself.
- **Validation/authorization/telemetry/idempotency:** not applicable — no behavior change, only removal of unused code and documentation of the existing (already-secure, already-idempotent-via-inbox) pattern.

## Frontend

Not applicable — backend-only gap.

## API Contract

Not applicable — no API surface change.

## Multi-Tenant Considerations

Not applicable beyond what `PlatformEventConsumer`/`PlatformEventBus` already enforce (every event carries `tenantId` in its payload per `ERPEventPayload`, and the inbox/outbox tables are tenant-scoped columns already) — this package changes no isolation behavior.

## Integration

- **event-service:** no functional change (its `OutboxRelayWorker` is untouched); only the sibling dead-code removal in `@erp/sdk` touches a file it also happens to import from (`import { OutboxPublisher } ...` — confirm event-service does not import `OutboxPublisher` before deleting; this pass found no such import in `apps/event-service/src/main.ts`).
- **accounting-service, gst-service, search-service** (and any other Kafka-consuming service): no functional change — they keep using `PlatformEventConsumer` exactly as today; this package only removes an unrelated dead sibling class and an orphaned package neither of them imports.

## Coding Standards

- This package is itself an application of "reuse over rebuild" and "avoid duplicate implementations" from the Enterprise Architecture Guidance — it removes duplicates rather than adding a new pattern.

## Performance

Not applicable — no runtime behavior changes; dead-code removal has no performance impact.

## Security

Not applicable — no security-relevant behavior changes. (Removing dead code marginally reduces attack surface / audit burden, but this is not a security fix.)

## Testing

- Add a workspace-hygiene check (can share the same small script proposed in PG-002 for the `@erp/cache` guard) asserting no file imports `event-bus-client` or `OutboxPublisher` from `@erp/sdk`, so their removal is enforced going forward rather than just a one-time cleanup.
- No new functional tests needed — no functional code changed.
- Run the full existing test suite for `event-service`, `accounting-service`, `gst-service`, `search-service` after the `platform-sdk` export removal to confirm nothing broke (`pnpm --filter @erp/event-service --filter @erp/accounting-service --filter @erp/gst-service --filter @erp/search-service test`).

## Acceptance Criteria

- [ ] `packages/event-bus-client/` no longer exists in the repository.
- [ ] `OutboxPublisher` is removed from `packages/platform-sdk/src/events.ts` and its export from `packages/platform-sdk/src/index.ts`, after a final confirm-zero-callers grep.
- [ ] `packages/platform-sdk/README.md` documents the sanctioned Kafka usage convention (bootstrap `Kafka` client per service, wrap with `PlatformEventConsumer`/`PlatformEventBus`).
- [ ] `pnpm build` at the workspace root succeeds with both artifacts removed.
- [ ] `pnpm --filter @erp/event-service --filter @erp/accounting-service --filter @erp/gst-service --filter @erp/search-service test` all pass unchanged.

## Deliverables

- **Files to create:** `packages/platform-sdk/README.md` (or an addition to it if one already exists — verify at implementation time).
- **Files to modify:** `packages/platform-sdk/src/events.ts` (remove `OutboxPublisher`), `packages/platform-sdk/src/index.ts` (remove its export).
- **Files to delete:** `packages/event-bus-client/` (entire directory).
- **Migrations:** none.
- **APIs added/changed:** none.
- **Events added/changed:** none.
- **Tests added:** workspace-hygiene import guard (can be the same script as PG-002's, extended with this package's forbidden-import list).

---

## Context Preservation (for a fresh AI session with no prior history)

**Previous Work Summary:** the codebase has a real, working, shared Kafka wrapper (`PlatformEventBus` for transactional-outbox publishing, `PlatformEventConsumer` for inbox-idempotent consumption) inside `@erp/sdk`, already adopted by every Kafka-consuming service. Separately, a standalone `event-bus-client` package exists only as a stale compiled build artifact with no source and no callers, and `@erp/sdk` itself carries a second, unused outbox-publisher class (`OutboxPublisher`) alongside the one actually used.

**Current Objective:** delete both dead artifacts (the orphaned package and the unused `OutboxPublisher` class) and document the already-working pattern so it isn't rediscovered/reinvented later.

**Architecture Snapshot:** each service bootstraps its own `Kafka` client instance, then wraps it with `PlatformEventConsumer` (consumption, inbox-idempotent) and publishes exclusively via `PlatformEventBus`/`insertIntoOutbox` (transactional outbox, relayed to Kafka by `event-service`'s `OutboxRelayWorker` — that relay itself is a separate, narrower gap, see PG-007).

**Completed Components:** `PlatformEventBus`/`PlatformEventConsumer` (already built, already adopted) — this package does not build them, only removes their dead siblings.

**Pending Components:** whether `event-service`'s `OutboxRelayWorker` should eventually migrate onto `@erp/sdk`'s (about-to-be-deleted, per this package) `OutboxPublisher` for its faster poll interval is explicitly NOT decided here — if that migration is ever desired, it needs its own gap-prompt with its own justification, not a silent revival of the class this package removes.

**Known Constraints:** re-verify zero-callers for both deletion targets immediately before deleting, per the roadmap's standing "re-verify current-state claims" rule — concurrent sessions may have changed this since authoring.

**Coding Standards:** pure consolidation — no new pattern introduced.

**Reusable Components:** `PlatformEventBus`, `PlatformEventConsumer` (both already in active use — this package documents, does not change, their usage).

**APIs Already Available:** not applicable.

**Events Already Available:** not applicable — no event schema changes.

**Shared Utilities:** `@erp/sdk`'s `events.ts` exports.

**Feature Flags:** not applicable.

**Multi-Tenant Rules:** unchanged — every event already carries `tenantId`.

**Security Rules:** not applicable.

**Database State:** not applicable.

**Testing Status:** existing Kafka-consumer tests across accounting/gst/search-service already cover `PlatformEventConsumer` usage; this package adds only a hygiene guard, no functional tests.

**Next Session Plan:** single session — this is small (M complexity, mostly deletion).

**Prompt for the Next Session:** "Implement `ERP-PLANNING/production-gap-prompts/001-Architecture/24-event-bus-client-consolidation.md` (PG-003). This file already corrects the master roadmap's framing: don't build the orphaned `event-bus-client` package — delete it, since a working shared wrapper (`PlatformEventBus`/`PlatformEventConsumer` in `@erp/sdk`) already exists and is already adopted everywhere. Also delete the unused sibling `OutboxPublisher` class in the same SDK file. Re-verify zero-callers for both via grep before deleting."
