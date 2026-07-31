# Schema Registry Admin — Production Readiness Audit (2026-07-25)

Scope: `apps/event-service/src/api/schema-registry.routes.ts` (backend) +
`apps/web-frontend/src/pages/admin/distributed/SchemaRegistryPage.tsx` (frontend), plus the
underlying engine at `packages/platform-sdk/src/schema-registry.ts`. All findings below are
live-verified against the running stack (gateway :3000, event-service :3023, Postgres via
`docker exec erp-postgres-primary psql`) unless explicitly marked code-inspection-only.

## Summary

The compatibility engine itself is real and was directly, adversarially tested in this session:
registering a version that adds a new required field, or that changes an existing field's type,
is correctly rejected with `422 SCHEMA_INCOMPATIBLE` — both via the standalone `/check` endpoint
and via the actual `POST /schemas` registration call. Non-breaking additive changes are correctly
accepted. This confirms the 2026-07-12 field-name-mismatch fix is still correct (catalog rows now
render eventType/schemaVersion/compatibilityMode/description/registeredBy exactly as the backend
returns them) and confirms the engine is not a stub.

But the feature as a whole is best described as **a passive, sparsely-populated, unenforced
catalog with a genuinely working — but functionally pointless — validator bolted onto it**. Three
compounding facts establish this:

1. **Zero enforcement in the real publish path.** `SchemaRegistry` is instantiated in exactly one
   file in the entire `apps/` tree — this routes file. Neither `PlatformEventBus.publishInTransaction()`
   (`packages/platform-sdk/src/events.ts:20-48`) nor any service's actual event-publishing code
   calls it. Traced the concrete case live: `apps/sales-service/src/domain/InvoiceService.ts:670-694`
   writes the real `INVOICE_CONFIRMED` event by `trx.insert(outboxEvents)` directly — bypassing
   not only `SchemaRegistry` but `PlatformEventBus` itself, the "official" outbox wrapper. A
   service can and does publish whatever payload shape it wants with zero validation anywhere.
2. **The one schema that is registered has already drifted from the real payload it claims to
   describe.** The catalog's `INVOICE_CONFIRMED` v2 schema declares fields `lines`, `tenantId`,
   `invoiceId`, `customerId`, `grandTotal`, `invoiceNumber`, `branchId`, `metadata`. The real
   payload sales-service publishes today (`InvoiceService.ts:676-692`) contains `invoiceDate`,
   `customerName`, `customerGstin`, `placeOfSupply`, `taxableAmount`, `cgstAmount`, `sgstAmount`,
   `igstAmount`, `cessAmount`, `isInterstate`, `grandTotal`, `branchId` — no `lines`, no
   `metadata`, and the schema's own `required: [...,"tenantId"]` can never be satisfied because
   `tenantId` lives on the outbox row, not inside `payload`. Nobody would ever notice this because
   nothing ever checks it.
3. **Catalog coverage is roughly 3% of real event traffic.** Live query: 68 distinct `event_type`
   values have actually flowed through `outbox_events`. The registry (excluding 7 junk rows) has
   ever cataloged exactly 4: `INVOICE_CONFIRMED`, `PAYMENT_RECEIVED`, `STOCK_RECEIVED`,
   `STOCK_DEDUCTED` — and the latter two have **zero** live occurrences ever (`SELECT count(*)
FROM outbox_events WHERE event_type IN ('STOCK_RECEIVED','STOCK_DEDUCTED')` → 0). Real stock
   events are published as `STOCK_LEVEL_CHANGED`/`STOCK_ADJUSTMENT_CREATED`/etc. — the seeded
   schemas describe event names the platform doesn't actually emit.

On top of that, the admin UI itself has a real usability defect: 7 of the 12 rows in the catalog
are leftover `QA_E2E_TEST_EVENT_<timestamp>` junk with empty `{required:[],properties:{}}`
schemas, and — because the catalog is sorted by `registeredAt DESC` with no filtering — they sit
at the **very top** of the table, meaning a real operator opening this page today sees 7 blank
junk rows before reaching a single real schema, with no API or UI mechanism to delete them.

## What works (verified live)

- **Field-name-mismatch fix (2026-07-12) holds.** `GET /api/v2/schema-registry/catalog` (via
  gateway: `GET /api/event/api/v2/schema-registry/catalog`) returns
  `{eventType, schemaVersion, jsonSchema, compatibilityMode, description?, registeredBy}` and the
  frontend's `SchemaEntry` interface matches exactly; Version/Registered-By columns render real
  values, not blanks.
- **Registration works correctly.** Registered a brand-new event type
  (`AUDIT_TEST_SCHEMA_EVENT` v1) via `POST /schemas`; it was stored and retrievable via both
  `GET /schemas/:type` (latest) and `GET /schemas/:type/:version` (specific version), with a
  correct `registeredBy` (the caller's email, not a numeric id — consistent with the 2026-07-12
  fix).
- **Compatibility engine genuinely rejects breaking changes**, live-tested three ways against
  `AUDIT_TEST_SCHEMA_EVENT` v1 (`{required:["id","amount"], properties:{id:integer,amount:number}}`):
  - New required field not in old schema → `422`, `BACKWARD_INCOMPATIBLE: New required field
'newRequiredField' not present in existing schema` (both `/check` and `POST /schemas`).
  - Existing field type change (`id`: integer → string) → `422`,
    `BACKWARD_INCOMPATIBLE: Field 'id' type changed from 'integer' to 'string'`.
  - A genuinely non-breaking additive optional field (`AUDIT_TEST_SCHEMA_EVENT2` v2 adding
    `newOptional`) was correctly **accepted**.
    This is a real diff engine, not a rubber stamp — see Gaps below for the caveat on
    `compatibilityMode: NONE`.
- **RBAC is correctly enforced**, both directions, live-confirmed: STAFF role (no
  `SCHEMA_REGISTRY_VIEW`) → `403 FORBIDDEN` on the catalog endpoint; OWNER (tenant 2) → `200` with
  full read/write. `role-defaults.ts` grants `SCHEMA_REGISTRY_VIEW` to
  AUDITOR/ACCOUNTANT_SUPERVISOR-class roles and `SCHEMA_REGISTRY_MANAGE` (bundled in the
  `TENANT_SCOPED_PERMISSIONS` blanket grant) to OWNER/ADMIN/SUPER_ADMIN.
- **Gateway routing works end-to-end for the real frontend call shape**: confirmed
  `GET http://localhost:3000/api/event/api/v2/schema-registry/catalog` (the actual path
  `endpoints.ts`'s `schemaRegistryApi` produces through the gateway's `apiV2:false` +
  `/api/event` prefix rule) returns `200` with a real bearer token.

## Bugs/gaps found

1. **CRITICAL — Schema validation is enforced nowhere in the real event pipeline; it is a
   catalog with no gate.** `SchemaRegistry` is referenced only in
   `apps/event-service/src/api/schema-registry.routes.ts` (grepped all of `apps/`). Confirmed via
   code that neither `PlatformEventBus.publishInTransaction()` nor `PlatformEventConsumer`'s
   handling ever calls `.validate()` or `.checkCompatibility()`. Confirmed live/concretely that
   the flagship event type (`INVOICE_CONFIRMED`) is published by sales-service via a _direct_
   `trx.insert(outboxEvents)` (`InvoiceService.ts:670-694`) that doesn't even go through
   `PlatformEventBus` — so wiring validation into `PlatformEventBus` alone would not even catch
   this specific real-world case; it would need to be at the outbox-insert or Kafka-producer
   layer to have any effect. **Business impact**: any service can publish any payload shape for
   any event type, including ones with a "protected" schema, with zero warning, block, or audit
   trail anywhere. The feature name and admin UI ("Register Schema", "Check Payload
   Compatibility") strongly imply enforcement to an operator; there is none.
2. **HIGH — The one real schema on file has already drifted from the real payload.** Registered
   `INVOICE_CONFIRMED` v2 schema (`lines`, `tenantId`, `invoiceId`, `customerId`, `grandTotal`,
   `invoiceNumber`, `branchId`, `metadata`) does not match the real payload sales-service
   publishes today (`taxableAmount`, `cgstAmount`, `sgstAmount`, `igstAmount`, `cessAmount`,
   `customerName`, `customerGstin`, `placeOfSupply`, `invoiceDate`, `isInterstate`, plus
   `grandTotal`/`branchId`) — no overlap on the GST/tax fields that matter most, and the schema's
   own `required: [...,"tenantId"]` could never be satisfied since `tenantId` is an outbox-row
   column, never a `payload` key. This is direct evidence that catalog entries silently rot the
   moment nobody manually re-syncs them — because nothing ever checks. Two of the four seeded
   "real" schemas (`STOCK_RECEIVED`, `STOCK_DEDUCTED`) describe event types with **zero live
   occurrences ever** in `outbox_events` (confirmed via `SELECT count(*) FROM outbox_events WHERE
event_type IN (...)` → 0); the platform actually emits `STOCK_LEVEL_CHANGED` /
   `STOCK_ADJUSTMENT_CREATED`/etc. instead.
3. **HIGH — Catalog coverage is ~3% of real event traffic.** Live query:
   `SELECT count(DISTINCT event_type) FROM outbox_events` → 68. The registry has ever cataloged 4
   real event types (2 of which don't correspond to anything actually published, per #2). An
   operator using this page to answer "what event contracts does this platform have" would get a
   answer that is off by roughly 95%.
4. **MEDIUM — `compatibilityMode` is chosen per-registration-call by the registrant, not pinned
   to the event type, so the compatibility guarantee is trivially self-bypassable.** Reproduced
   live: registered `AUDIT_TEST_SCHEMA_EVENT` v1 under `BACKWARD`; a v2 with a new required field
   - a field type change was correctly rejected under `BACKWARD` (`422`); the _identical_ breaking
     payload was then resubmitted with `compatibilityMode: "NONE"` and registered successfully with
     no warning, no flag distinguishing "deliberately unchecked" from "dodged a rejection," and no
     requirement that it match the mode any prior version used. Any caller with
     `SCHEMA_REGISTRY_MANAGE` (i.e. every tenant OWNER/ADMIN by default) can silently defeat the
     compatibility guarantee for any event type by simply choosing `NONE` on their own submission —
     there is no concept of a "subject-level" compatibility policy independent of the registrant's
     choice, unlike e.g. Confluent Schema Registry's per-subject config. This is arguably by design
     (NONE is documented as an explicit "no check" mode) but the UI presents it as an equal dropdown
     option with no warning, and the register endpoint doesn't compare against the mode used by the
     prior version.
5. **MEDIUM — 7 junk test rows dominate the top of the real admin UI, with no cleanup path.**
   Catalog is sorted `registeredAt DESC` (`packages/platform-sdk/src/schema-registry.ts:97`) with
   no filter. Live catalog fetch returned exactly 12 rows: the **first 7**, in order, are
   `QA_E2E_TEST_EVENT_1783920556004` / `...1783920391848` / `...1783919987214` / `...1783919741965`
   / `...1783894773099` / `...1783894744898` / `...1783894310255`, all `registeredBy:
"owner@qa-e2e.local"`, all with an empty `{required:[],properties:{}}` schema — then the 5 real
   entries. There is no `DELETE` route in `schema-registry.routes.ts` (confirmed — only GET
   catalog, GET latest, GET version, POST register, POST check) and no filter/search control in
   the frontend page. A real platform operator opening this page for the first time would see 7
   meaningless blank rows before a single useful one, permanently, with no way to remove them
   short of a manual DB delete. This is not "somewhat hidden" — it is the majority of the visible
   list and it's first.
6. **LOW — "Version history" is raw data with no history UI.** The catalog does return every
   version of every event type (verified `INVOICE_CONFIRMED` v1 and v2 are both present and each
   individually fetchable/accurate via `GET /schemas/:type/:version`), so the underlying data is
   correct. But the frontend renders it as one flat table sorted by registration time, not grouped
   by event type or version — `INVOICE_CONFIRMED` v1 and v2 are not adjacent rows, they're wherever
   their individual `registeredAt` timestamp happens to sort them, interleaved with unrelated
   event types and the junk rows above. There is no per-event-type version list, no diff/compare
   view between two versions, despite the audit brief's premise that one might exist — grepped the
   page for "history"/"diff" and found neither.
7. **INFORMATIONAL — Schema registry is platform-wide, not tenant-scoped, but gated behind
   tenant-level RBAC, and the platform operator (who could naturally own a global config) cannot
   see it at all.** `schema_registry` (migration `0006_phase12_distributed.sql`) has no
   `tenant_id` column and no RLS policy; `SchemaRegistry`'s methods use `this.db.raw` directly
   (`schema-registry.ts:44,62,80,94`), bypassing `TenantScopedDatabase`'s automatic tenant-filter
   wrapper entirely (confirmed by inspecting `database.ts` — the wrapper only auto-filters tables
   that have a `tenantId` column). So the catalog is one single global list shared by every tenant
   on the platform — verified live: tenant 2's owner registered `AUDIT_TEST_SCHEMA_EVENT` and it
   appeared in the same catalog the seeded "system" schemas live in, with no tenant boundary. Any
   tenant's OWNER/ADMIN (default role grant, not a special permission — `SCHEMA_REGISTRY_MANAGE`
   is not in `PLATFORM_ONLY_PERMISSIONS`) can register/overwrite catalog entries visible to and
   shared by every other tenant on the platform. Meanwhile `PLATFORM_OPERATOR`'s live JWT (logged
   in as `operator@platform.local`) carries only `PLATFORM_TENANT_MANAGE`/`PLATFORM_CONTENT_MANAGE`
   — **no** `SCHEMA_REGISTRY_VIEW`/`MANAGE` at all, so the role that conceptually "owns" a global,
   cross-tenant resource cannot even view this page. This is not exploitable for cross-tenant data
   leakage today (schemas contain no tenant business data), but it is an architectural
   inconsistency worth fixing before this ever becomes an enforcement gate: a feature whose data
   model is unambiguously global is currently administered by whichever tenant happens to click it
   first, not by the platform.

## Untested/unknown

- Did not attempt a second live cross-tenant login to double-confirm catalog sharing
  interactively (no second tenant's credentials were available in `TEST_CREDENTIALS.md`); the
  global-scope conclusion above rests on code/schema inspection (no `tenant_id` column, no RLS,
  `db.raw` bypass of the tenant-filter wrapper) rather than a second live login, which is
  considered conclusive given the table structure itself.
- Did not test malformed/adversarial `jsonSchema` payloads (e.g. deeply nested schemas, `$ref`,
  arrays-of-objects) against `checkCompatibility` — the engine only inspects top-level
  `required`/`properties`/`type`, so nested-object or array-item incompatibilities are very likely
  silently missed, but this wasn't explicitly reproduced live in this session.
- `permission-granularity.test.ts` (which is supposed to cover Schema Registry RBAC boundaries)
  was already reported failing on a pre-existing JWT-issuer 401-vs-403 test-infra issue by
  today's sibling event-service audit; not independently re-run here, live manual RBAC check
  above is the only current evidence.

## Readiness score: 30/100

**Justification.** The engine itself — the part that would be hardest to build — genuinely works:
BACKWARD/FORWARD/FULL diffing correctly catches real breaking changes and correctly passes real
non-breaking ones, live-verified with adversarial inputs in this session, not just code review.
CRUD, RBAC, and the frontend rendering are all solid and match the backend contract exactly.

But the score is dominated by the central finding the audit brief asked to weight heavily: this is
a passive catalog, not enforcement, and the evidence for that is not merely "grep found no
callers" — it's that the one schema that exists has already drifted unnoticed from the real
payload it claims to describe, and the catalog covers roughly 3% of the event types the platform
actually emits, with two of its four seed entries describing event names that have never once been
published. That is exactly the failure mode you'd predict for a validator nobody runs: it doesn't
just fail to add value, it accumulates confidently-wrong metadata that would actively mislead
anyone who trusted it. Stacked on top: 7 junk rows dominate the first screen of the real admin UI
with no cleanup path, the compatibility guarantee is self-bypassable by any tenant OWNER via
`compatibilityMode: NONE` with no audit trail, "version history" is raw sortable data rather than
a coherent per-event view, and the feature's data model (global) doesn't match its access model
(tenant-gated, with the actual platform-level role unable to see it at all). None of this is
data-corrupting — the catalog isn't in the write path of anything that matters yet — but as a
production-readiness feature it currently provides negative net value: an operator who discovers
this page and takes its green checkmarks and "Compatible" badges at face value would conclude the
platform has schema governance it does not have.

## Recommendations (not implemented — audit only)

1. Decide the actual scope: either wire `SchemaRegistry.validate()`/`checkCompatibility()` into
   the outbox-insert path (would need to intercept every direct `trx.insert(outboxEvents)` call
   site, not just `PlatformEventBus`, since that's the pattern real producers actually use) with a
   soft-fail/log-only mode first to avoid breaking existing traffic, or relabel the feature
   honestly (e.g. "Event Contract Documentation") so operators don't infer enforcement that isn't
   there.
2. Re-sync or regenerate the 4 seeded schemas against real current payloads, and delete/replace
   the 2 that describe event types that don't exist (`STOCK_RECEIVED`, `STOCK_DEDUCTED`).
3. Add a `DELETE` (or archive/hide) admin route + UI action so junk/test entries don't accumulate
   permanently at the top of a sorted-by-recency list.
4. Move `compatibilityMode` to be a per-event-type ("subject") setting checked against the
   registrant's declared mode, not a free choice on every individual registration call — or at
   minimum, log/flag when a new version is registered under a weaker mode than its predecessor.
5. Group the catalog UI by event type with versions nested/expandable, and add a real diff view
   between two versions of the same event type.
6. Resolve the ownership mismatch: either move Schema Registry under
   `PLATFORM_ONLY_PERMISSIONS`/grant it to `PLATFORM_OPERATOR` (consistent with its genuinely
   global data model), or add a real `tenant_id` column + RLS if per-tenant schemas were actually
   intended.
