# [PG-XXX] <Gap Title>

> Template version 1.0. Every gap-prompt file in this tree must follow this exact section order. Do not add sections; do not omit sections that apply. If a section genuinely does not apply to this gap, write "Not applicable — <one-line reason>" instead of deleting it, so the structure stays diffable across files.

**Category:** <Architecture | Security | Infrastructure | Platform | Inventory | Accounting | GST | HR | Production | Notifications | Reporting | Search | POS | Web | Testing | Deployment>
**Priority:** <Critical | High | Medium | Low>
**Complexity:** <S | M | L | XL> — <1-line justification>
**Depends on:** <PG-IDs or "none">
**Blocks:** <PG-IDs or "none">
**Primary service(s)/package(s):** <e.g. apps/event-service, packages/db-client>

---

## Overview

- **Business objective:** why this matters to the business, in plain language — what breaks or what's missed today.
- **Current implementation:** what exists right now, grounded in real file paths (verify via grep/read before writing this — do not guess a path).
- **Current architecture:** how this piece fits into the surrounding system today.
- **Current limitations:** the specific, concrete gap — quote the exact stub/TODO/mismatch, not a generic description.

## Existing Code Analysis

- **What already exists and should be reused:** name the actual functions/modules/patterns.
- **What should never be modified:** call out adjacent working code that is out of scope and must not be touched.
- **Prior related work:** reference any completion reports in `ERP-PLANNING/phase-completions/` or audit docs that already touched this area, if any exist.

## Architecture

- Required/updated architecture for the fix — only as much redesign as the gap needs. Prefer extending the existing pattern (outbox, CQRS projection, saga registry, RBAC preHandler, etc.) over introducing a new one.
- Component interactions and data flow (describe in prose or a simple flow list; use a sequence-of-steps diagram only where genuinely non-obvious, not for every file).

## Database Changes

- Tables / columns / indexes / constraints needed, or "Not applicable — no schema change."
- Migration approach consistent with this repo's Drizzle migration convention (`packages/db-client` migrations, sequential numbering).
- Rollback strategy for the migration.

## Backend

- Routes, controllers/handlers, services, repositories to add or change (Fastify route + Zod schema convention, matching this repo's existing service structure).
- Events/Kafka topics touched, outbox usage, CQRS projection impact.
- Validation, authorization (`requirePermission`), audit logging, telemetry (OTel spans / Prometheus counters), error handling, idempotency, caching — call out only what's actually relevant to this gap.

## Frontend

- Pages/components/hooks/forms/tables/dialogs to add or change, or "Not applicable — backend-only gap."
- State management, permission gating (`PermissionGate`/`usePermission`), feature flags, accessibility, responsive behavior.

## API Contract

- Concrete REST endpoints: method, path, request shape, response shape, error codes. Or "Not applicable."

## Multi-Tenant Considerations

- Tenant isolation (`tenant_id` scoping), branch isolation, permission model, feature-flag gating, any data-partitioning or scale implication.

## Integration

- Which of the 14 backend services / 2 frontends this touches, and how (event consumed/produced, API called, shared package used). Name only the real integration points — don't list all 14 services if most aren't touched.

## Coding Standards

- Confirms this plan reuses existing conventions (Fastify preHandler auth, Zod validation, Winston logging, `@erp/logger`, `@erp/utils`, the design-token/ERP component library on frontend, the existing audit/telemetry helpers) rather than introducing new patterns. Call out anything genuinely novel this gap requires and justify why the existing pattern doesn't fit.

## Performance

- Caching, indexing, pagination, batching, concurrency/locking implications — only what applies.

## Security

- RBAC/permission checks, audit coverage, encryption, input validation, rate limiting, relevant OWASP category if any.

## Testing

- Unit, integration, E2E, and (if relevant) performance/security/regression tests to add. Name the actual test file(s) or test suite this belongs in, following this repo's existing test layout.

## Acceptance Criteria

- Concrete, verifiable checklist. Each item must be checkable by running something (a test, a manual repro, a query) — not vague ("works well").

## Deliverables

- **Files to create:** explicit list.
- **Files to modify:** explicit list.
- **Migrations:** explicit list/number.
- **APIs added/changed:** explicit list.
- **Events added/changed:** explicit list.
- **Tests added:** explicit list.

---

## Context Preservation (for a fresh AI session with no prior history)

**Previous Work Summary:** one paragraph — what state the codebase is in before this package starts.
**Current Objective:** one paragraph — exactly what this package delivers.
**Architecture Snapshot:** the 3-6 facts about the surrounding system a new session needs to not re-derive them.
**Completed Components:** what related work is already done (link other PG-IDs or completion reports).
**Pending Components:** what related work is explicitly NOT part of this package (so the session doesn't scope-creep).
**Known Constraints:** hard constraints (no live DB in some dev sessions, single shared Postgres, no per-tenant schema, etc.) that shape the implementation.
**Coding Standards:** one-paragraph pointer back to the Coding Standards section above.
**Reusable Components:** the concrete functions/modules to import, not rebuild.
**APIs Already Available:** existing endpoints this package can call rather than duplicate.
**Events Already Available:** existing Kafka event types/topics relevant here.
**Shared Utilities:** `@erp/logger`, `@erp/utils`, `@erp/types`, `@erp/sdk` helpers relevant here.
**Feature Flags:** any tenant feature flag this work should be gated behind, if applicable.
**Multi-Tenant Rules:** the tenant/branch isolation rule that applies here.
**Security Rules:** the permission constant(s) this must check.
**Database State:** relevant tables/migrations this package depends on or extends.
**Testing Status:** what test coverage exists today for this area, if any.
**Next Session Plan:** if this package is itself too large for one session, how to split it; otherwise "single session."

**Prompt for the Next Session:** a ready-to-paste paragraph a developer/AI can hand to a fresh chat to resume exactly here, referencing this file by path.
