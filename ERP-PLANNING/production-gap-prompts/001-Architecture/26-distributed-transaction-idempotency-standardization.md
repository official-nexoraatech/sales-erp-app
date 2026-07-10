# [PG-011] Distributed Transaction / Idempotency Standardization

> Template version 1.0. Every gap-prompt file in this tree must follow this exact section order. Do not add sections; do not omit sections that apply. If a section genuinely does not apply to this gap, write "Not applicable — <one-line reason>" instead of deleting it, so the structure stays diffable across files.

**Category:** Architecture
**Priority:** Medium
**Complexity:** M — no behavior change to any existing call site is required (this is a documentation-plus-extraction package); the work is identifying every ad hoc reimplementation and giving new work a single, obvious place to reach for instead
**Depends on:** none
**Blocks:** none (relates to PG-006's saga registration and PG-007's DLQ replay — both are the other two pillars of this codebase's actual distributed-consistency story)
**Primary service(s)/package(s):** packages/platform-sdk (new `idempotency.ts`), apps/sales-service, apps/notification-service (existing patterns documented/referenced, not rewritten), ERP-PLANNING documentation

---

## Overview

- **Business objective:** this codebase has **no 2PC/XA distributed transaction coordinator** and — correctly, for a system built on Kafka + a shared Postgres — never should have one; the outbox pattern (`event-service`'s `OutboxRelayWorker`) plus at-least-once Kafka delivery is the deliberate, sanctioned alternative already in production use. But there is no single document saying so, and no shared helper for the idempotency half of that story — every service that needs "don't double-process a retried request/message" today reinvents it independently, in at least three visibly different shapes, none of which know about each other. New work (the next service that needs idempotent writes) has no obvious place to look and will likely invent a fourth shape, compounding the inconsistency this package exists to stop.
- **Current implementation, verified by direct grep across the codebase — three independent idempotency shapes exist today:**
  1. **DB unique-constraint + typed-error translation** (`sales-service`): `apps/sales-service/src/domain/InvoiceService.ts:44-61` defines its own `DuplicateOperationError` class and its own local `isUniqueViolation(err, constraintName)` function that inspects a raw Postgres error for `code === '23505'` and a specific `constraint_name`, translating it into a typed `409 DUPLICATE_OPERATION` instead of an opaque `500`. This same pattern (client-generated `clientOperationId` + a `(tenantId, clientOperationId)` unique constraint) is repeated for customers (`customer.routes.ts:310-321`, OFFLINE-05) and POS sales (`pos.routes.ts:97, 240`, OFFLINE-02) — each call site re-deriving its own constraint-name string and its own catch logic, with no shared function between them despite being the identical pattern three times in the same service.
  2. **Derived time-bucketed hash key** (`notification-service`): `apps/notification-service/src/domain/NotificationEngine.ts:40-55` — `deriveIdempotencyKey()` builds a SHA-256 hash of `tenantId:eventType:channel:recipient:templateData:timeBucket` when no explicit key is supplied, with its own explicit code comment recommending callers with a natural dedup key pass `idempotencyKey` directly instead of relying on the derived hash. This is a genuinely different idempotency *strategy* (time-windowed dedup of at-least-once-retried sends, not a hard uniqueness constraint) — appropriately so, since notifications and financial-record inserts have different consistency needs, but there is no shared vocabulary distinguishing "hard idempotency key" (must never duplicate, ever) from "soft/time-windowed dedup" (acceptable to re-send after N minutes) anywhere in the codebase; a new engineer has to read both files to discover this is even a deliberate distinction rather than an oversight.
  3. **Outbox pattern for producer-side exactly-once-publish** (`event-service`): `OutboxRelayWorker` (`apps/event-service/src/outbox/OutboxRelayWorker.ts`) guarantees an event is eventually published to Kafka at least once by writing it transactionally alongside the business change and relaying it out-of-band — this is the correct, already-standard pattern for the "how do I make a side-effecting write and a Kafka publish atomic without 2PC" problem, and it is the thing every future service-to-service consistency need should reach for first. It is well-documented in its own file but not cross-referenced from anywhere that discusses distributed consistency as a topic — a new session grepping for "idempotency" or "distributed transaction" today would not be led to it.
- **Current architecture:** all three of the above coexist correctly for their respective use cases — this package is not proposing to unify them into one mechanism (a hash-based dedup key is wrong for financial record creation; a hard unique constraint is wrong for "resend within 5 minutes is fine" notification dedup). The gap is that #1's DB-unique-constraint-translation logic is **mechanically identical** across every call site that uses it and is copy-pasted rather than shared, and there is no document tying #1/#2/#3 together as "here is this system's actual answer to distributed consistency" for a new session to find before reinventing a fourth approach.
- **Current limitations:** the concrete, fixable waste is the duplicated `isUniqueViolation`-shaped logic (#1) — three-plus call sites in `sales-service` alone, and any future service adopting the same `clientOperationId`-style pattern (a near-certainty, since offline-sync idempotency is a recurring need across this ERP's POS/CRM-quick-create flows per project history) will otherwise write a fourth copy. There is also no shared `IdempotentOperationError`-equivalent type in `@erp/types`/`@erp/sdk` — `DuplicateOperationError` is currently private to `sales-service`'s `InvoiceService.ts`, unusable by any other service without duplicating the class definition too.

## Existing Code Analysis

- **What already exists and should be reused:** `OutboxRelayWorker`/the outbox pattern (unchanged, just documented as the sanctioned answer — see Architecture); `SagaOrchestrator` (`@erp/sdk`, hardened further in PG-006) as the sanctioned answer for "multi-step process needing compensation," which this package documents as the third pillar alongside outbox and idempotency keys; the exact shape of `isUniqueViolation()` (`InvoiceService.ts:54-61`) and `DuplicateOperationError` (`InvoiceService.ts:44-48`) as the reference implementation to extract, not redesign — the new shared helper should behave identically to what `sales-service` already does, just in one place instead of three-plus.
- **What should never be modified:** the actual constraint names/columns already in use (`invoices_tenant_client_operation_id`, the customer/POS equivalents) — this package changes where the *catching logic* lives, not the database constraints themselves or the business behavior of any existing endpoint. `NotificationEngine.ts`'s time-bucketed hash strategy stays exactly as-is — it is correct for its use case and is not being replaced by the hard-uniqueness helper.
- **Prior related work:** `[[es24_saga_orchestrator_design]]` and OFFLINE-02/OFFLINE-05 (project memory: `[[offline02_completion_2026_07_05]]`, `[[offline05_completion_2026_07_05]]`) are the origin of the `clientOperationId` pattern this package generalizes — read those before touching `InvoiceService.ts`'s call sites, since they carry real context about why the pattern was shaped the way it was (offline POS sync retry semantics specifically).

## Architecture

- **Document the three-pillar distributed-consistency story** (new doc, see Backend/Deliverables) rather than inventing a fourth mechanism:
  1. **Outbox pattern** (existing, `event-service`) — for "I made a local write and need to reliably tell other services about it," when the other services' reaction doesn't need to be waited on synchronously.
  2. **Saga orchestration** (existing, `@erp/sdk`'s `SagaOrchestrator`, real usage landing via PG-006) — for "I need to call out to 2+ systems in sequence within one logical operation, and a later step failing should compensate earlier ones."
  3. **Idempotency keys** (this package's new shared helper) — for "the same logical operation might arrive more than once (client retry, offline-queue replay, at-least-once Kafka redelivery, DLQ replay per PG-007) and must not be double-applied."
- **New shared helper: `packages/platform-sdk/src/idempotency.ts`**, exporting:
  - `DuplicateOperationError` (moved here from `sales-service`'s private definition, generalized to accept an `operationId`/`entityType` pair rather than being invoice-specific — `sales-service`'s existing usages update their imports to `@erp/sdk` instead of the local class, with zero behavior change).
  - `isUniqueConstraintViolation(err: unknown, constraintName: string): boolean` — the exact logic already in `InvoiceService.ts:54-61`, moved and generalized (parameter name only; behavior identical).
  - `withIdempotentInsert<T>(fn: () => Promise<T>, constraintName: string, operationId: string): Promise<T>` — a small convenience wrapper doing the try/catch-and-translate dance that today is manually repeated at every call site (`InvoiceService.create`, `customer.routes.ts`'s create-with-`operationId` handler, `pos.routes.ts`'s sale-sync handler) — new call sites call this instead of writing their own try/catch, existing call sites are optionally migrated to it (not required in the same package if it risks destabilizing working offline-sync code — see Testing) but new code has zero excuse to reinvent the catch logic going forward.
  - Re-export `deriveTimeBucketedDedupKey` (generalized from `notification-service`'s private `deriveIdempotencyKey`, same SHA-256/time-bucket shape) for the "soft dedup" case, clearly named and documented as distinct from `DuplicateOperationError`'s hard-uniqueness case, so a reader choosing between the two sees the distinction in the function names themselves, not just in a comment.
- **This package does not migrate every existing call site by force** — `sales-service`'s three current `clientOperationId` call sites may be left as-is if migrating them risks touching working, recently-shipped offline-sync code (OFFLINE-02/05) for a purely cosmetic win; the acceptance bar is "the shared helper exists, is documented, and at least one real call site uses it" (either a migrated `sales-service` site or a genuinely new one), not "every historical call site is rewritten." This mirrors CLAUDE.md's "surgical changes" principle — do not touch working, recently-hardened offline-sync code merely to satisfy a refactor's symmetry.

## Database Changes

Not applicable — no schema change. Existing unique constraints (`invoices_tenant_client_operation_id` and its siblings) are unchanged; this package only relocates the application-side error-translation logic.

## Backend

- **Files to create:** `packages/platform-sdk/src/idempotency.ts` (the helper described above), plus a new cross-cutting doc — either `ERP-PLANNING/DISTRIBUTED_CONSISTENCY.md` or a new section appended to `ERP_MASTER_SPEC.md` (check this repo's existing documentation convention at implementation time and prefer extending an existing doc over creating a new one if a natural home already exists) — stating the three-pillar story from Architecture, with a short "when to use which" decision guide and links to `OutboxRelayWorker`, `SagaOrchestrator`, and the new `idempotency.ts`.
- **Files to modify:** `packages/platform-sdk/src/index.ts` (export the new helper's public surface), `apps/sales-service/src/domain/InvoiceService.ts` (replace the private `DuplicateOperationError`/`isUniqueViolation` with imports from `@erp/sdk` — behavior-identical, so this is a safe, low-risk migration to do as this package's one "real call site" proof, since it's a rename/re-source of logic that's already covered by `offline02-idempotency.test.ts`'s existing assertions).
- **Events/Kafka:** not applicable — this package doesn't add new event types; it documents the outbox pattern that already handles them.
- **Validation, authorization:** not applicable — no new routes or permission surface.

## Frontend

Not applicable — this is a backend/shared-package consistency-pattern package with no UI surface.

## API Contract

Not applicable — no new or changed endpoints. Existing endpoints that already return `409 DUPLICATE_OPERATION` (via `DuplicateOperationError`) continue to do so identically after the class moves to `@erp/sdk`.

## Multi-Tenant Considerations

- The new helper carries no tenant-scoping logic itself — every existing and future call site is responsible for including `tenantId` in whatever unique constraint or dedup key it uses, exactly as `invoices_tenant_client_operation_id` already does (`tenantId` is the first column in every one of these constraints today, confirmed by grep) — the helper's documentation should say this explicitly (a global, non-tenant-scoped idempotency key would be a cross-tenant collision risk) so a future call site doesn't omit it.

## Integration

- **packages/platform-sdk**: owns the new shared helper.
- **sales-service**: migrates its one real call site (`InvoiceService.ts`) to import from `@erp/sdk` instead of its private definitions — proves the extraction is behavior-preserving without touching the other two `clientOperationId` call sites' risk surface.
- **notification-service**: not modified — its existing `deriveIdempotencyKey` stays private and correct; the new `deriveTimeBucketedDedupKey` in the SDK is documented as "the same pattern, available to other services," not a replacement of `notification-service`'s own copy (forcing that migration is optional future work, not required here).

## Coding Standards

- This package's entire purpose is strengthening adherence to the "reuse over rebuild" cross-cutting rule already stated in `000-Master-Roadmap.md`'s Enterprise Architecture Guidance — it introduces exactly one new file in `@erp/sdk` (consistent with that package's existing role as "the single mandatory layer between services and infrastructure," per its own `index.ts` header comment) and no new pattern beyond what already exists in `sales-service`/`notification-service` today, just relocated and named clearly.

## Performance

Not applicable — the helper is a thin wrapper around the identical error-inspection logic already running today; no new query, no new round-trip.

## Security

Not applicable — no new permission surface; the helper does not change what data any endpoint exposes, only where the duplicate-detection code lives.

## Testing

- New `packages/platform-sdk/src/__tests__/idempotency.test.ts`: `isUniqueConstraintViolation` correctly identifies a matching Postgres 23505 error by constraint name and correctly returns `false` for a different constraint name or a non-Postgres error; `withIdempotentInsert` translates a caught unique-violation into `DuplicateOperationError` and passes through any other error unchanged; `deriveTimeBucketedDedupKey` produces a stable hash within the same time bucket and a different hash across buckets (mirroring `notification-service`'s own existing test coverage for the pattern it's generalized from).
- `sales-service`'s existing `offline02-idempotency.test.ts` must continue to pass unmodified after `InvoiceService.ts`'s migration to the shared helper — this is the regression check proving the extraction was behavior-preserving, not just a new test in isolation.

## Acceptance Criteria

- [ ] `packages/platform-sdk/src/idempotency.ts` exists, exporting `DuplicateOperationError`, `isUniqueConstraintViolation`, `withIdempotentInsert`, `deriveTimeBucketedDedupKey`, all re-exported from `@erp/sdk`'s `index.ts`.
- [ ] `apps/sales-service/src/domain/InvoiceService.ts` imports `DuplicateOperationError`/the constraint-check helper from `@erp/sdk` instead of defining them locally, with `offline02-idempotency.test.ts` still passing unmodified.
- [ ] A distributed-consistency doc exists (new file or a section of an existing one) stating the outbox/saga/idempotency-key three-pillar story with a "when to use which" guide.
- [ ] `pnpm --filter @erp/platform-sdk test` and `pnpm --filter @erp/sales-service test` pass.
- [ ] No 2PC/XA library or dependency is introduced anywhere in the codebase as part of this package (the doc explicitly states this is a deliberate non-goal).

## Deliverables

- **Files to create:** `packages/platform-sdk/src/idempotency.ts`, `packages/platform-sdk/src/__tests__/idempotency.test.ts`, the distributed-consistency doc (new file or section — confirm placement against existing docs at implementation time).
- **Files to modify:** `packages/platform-sdk/src/index.ts`, `apps/sales-service/src/domain/InvoiceService.ts`.
- **Migrations:** none.
- **APIs added/changed:** none (existing `409 DUPLICATE_OPERATION` behavior preserved, not changed).
- **Events added/changed:** none.
- **Tests added:** `idempotency.test.ts`; `offline02-idempotency.test.ts` re-verified, not rewritten.

---

## Context Preservation (for a fresh AI session with no prior history)

**Previous Work Summary:** this codebase has three independently-evolved idempotency/consistency mechanisms with no shared vocabulary or shared code between them: (1) DB-unique-constraint-plus-typed-error-translation, duplicated across at least three call sites in `sales-service` (`InvoiceService.ts`, `customer.routes.ts`, `pos.routes.ts`, all under the OFFLINE-02/OFFLINE-05 `clientOperationId` pattern); (2) a time-bucketed SHA-256 dedup hash, private to `notification-service`'s `NotificationEngine.ts`; (3) the outbox pattern (`event-service`'s `OutboxRelayWorker`) and, as of PG-006, real saga orchestration (`@erp/sdk`'s `SagaOrchestrator`) as the sanctioned answers for producer-side reliable publish and multi-step compensation respectively. None of the three are documented together as "this system's answer to distributed consistency," and #1's logic is copy-pasted rather than shared.

**Current Objective:** extract #1's proven, working logic (`isUniqueViolation`/`DuplicateOperationError`, currently private to `InvoiceService.ts`) into a shared `packages/platform-sdk/src/idempotency.ts`, migrate `sales-service`'s one call site to it as a behavior-preserving proof, generalize (without forcing a migration of) `notification-service`'s time-bucketed hash pattern into the same file for future reuse, and write a short cross-cutting doc naming outbox + saga + idempotency-key as this system's deliberate, sanctioned three-pillar alternative to 2PC/XA — so the next service that needs any of these three things has an obvious place to look instead of inventing a fourth shape.

**Architecture Snapshot:** `@erp/sdk` (`packages/platform-sdk`) is already documented as "the single mandatory layer between services and infrastructure" (its own `index.ts` header comment, referencing `ERP_MASTER_SPEC §4.1`) — this package's new file belongs there for exactly that reason. `invoices_tenant_client_operation_id` (and its customer/POS siblings) are real Postgres unique constraints already in production use, unchanged by this package. `SagaOrchestrator` and `OutboxRelayWorker` are both real, already-built mechanisms this package documents rather than modifies.

**Completed Components:** the three consistency mechanisms themselves are all already fully functional in their current, scattered form — this package does not fix a bug, it consolidates and documents. PG-006 (saga registration) and PG-007 (DLQ real replay) are the other two packages that make the "saga" and "at-least-once redelivery" pillars of this story fully real in production, and should be cross-linked from the new doc.

**Pending Components:** migrating `notification-service`'s `deriveIdempotencyKey` or the other two `sales-service` `clientOperationId` call sites (`customer.routes.ts`, `pos.routes.ts`) to the new shared helper is explicitly optional, not required — do not destabilize working, recently-shipped offline-sync code for symmetry alone (see Architecture's explicit note on this).

**Known Constraints:** no 2PC/XA coordinator exists or should be introduced — this is a documented, deliberate architectural stance, not an oversight, and the new doc should say so explicitly so a future engineer doesn't propose one without reading why it was rejected. Single shared Postgres, no RLS — every idempotency key/constraint must include `tenantId` as the first component, per existing convention.

**Coding Standards:** see Coding Standards section — one new file in `@erp/sdk`, matching that package's existing charter; no new pattern beyond what `sales-service`/`notification-service` already do today, just relocated and named clearly.

**Reusable Components:** `InvoiceService.ts:44-61`'s existing, working `DuplicateOperationError`/`isUniqueViolation` logic (the extraction source, not a redesign); `NotificationEngine.ts:40-55`'s `deriveIdempotencyKey` (the generalization source for `deriveTimeBucketedDedupKey`).

**APIs Already Available:** not applicable — no new endpoints.

**Events Already Available:** not applicable — the outbox pattern this package documents already handles event delivery; no new topic.

**Shared Utilities:** the new `@erp/sdk` `idempotency.ts` module itself is the deliverable shared utility.

**Feature Flags:** not applicable.

**Multi-Tenant Rules:** every idempotency key/unique constraint must scope by `tenantId` first — the new helper's documentation states this as a hard rule, matching every existing constraint's actual column order today.

**Security Rules:** not applicable — no new permission surface.

**Database State:** no migration; existing constraints (`invoices_tenant_client_operation_id` and siblings) are read-only reference points for this package, not altered.

**Testing Status:** `offline02-idempotency.test.ts` and `offline05-customer-idempotency.test.ts` already cover the existing `sales-service` behavior this package must not regress. `notification-service`'s own test suite already covers `deriveIdempotencyKey`'s existing behavior (verify exact test file name at implementation time) and is unaffected since that file isn't modified.

**Next Session Plan:** single session — Complexity M reflects the documentation/decision-guide work (getting the "three pillars, when to use which" framing right) more than code volume, since the code change itself is a small, low-risk extraction plus one migrated call site.

**Prompt for the Next Session:** "Implement `ERP-PLANNING/production-gap-prompts/001-Architecture/26-distributed-transaction-idempotency-standardization.md` (PG-011). Before writing code, re-read `apps/sales-service/src/domain/InvoiceService.ts:40-61` and `apps/notification-service/src/domain/NotificationEngine.ts:40-55` to confirm both patterns still exist as described — they are the extraction source, not something to redesign. Build `packages/platform-sdk/src/idempotency.ts`, migrate `InvoiceService.ts`'s one call site to it (confirm `offline02-idempotency.test.ts` still passes unmodified), then write the cross-cutting distributed-consistency doc referencing PG-006/PG-007 and the existing `OutboxRelayWorker`/`SagaOrchestrator`. Do not migrate `customer.routes.ts`/`pos.routes.ts`/`notification-service` unless it can be done with zero behavior risk to their existing offline-sync tests."
