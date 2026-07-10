# [PG-029] Tenant Provisioning — Real S3/MinIO Bootstrap

> Template version 1.0. Every gap-prompt file in this tree must follow this exact section order. Do not add sections; do not omit sections that apply. If a section genuinely does not apply to this gap, write "Not applicable — <one-line reason>" instead of deleting it, so the structure stays diffable across files.

**Category:** Platform
**Priority:** High
**Complexity:** S — one provisioning step becomes real, reusing an already-built `StorageClient`; no new service, no new table, one small class-extension.
**Depends on:** none
**Blocks:** none
**Primary service(s)/package(s):** apps/tenant-service, packages/platform-sdk (`@erp/sdk`)

---

## Overview

- **Business objective:** Tenant provisioning is supposed to make a new tenant fully operational end-to-end, including having a real place in object storage (MinIO/S3) for its documents (attachments, exports, logos). Today the provisioning step that claims to do this is a no-op — it only writes a string into the database. If a tenant's first real action (e.g. uploading an invoice attachment, per ES-20's `document_attachments` feature) assumes storage isolation exists, nothing in provisioning actually established it.

- **Current implementation:** Confirmed by direct read of `apps/tenant-service/src/domain/TenantProvisioner.ts:141-155` (STEP 6):
  ```ts
  const s3Prefix = `tenants/${tenantId}`;
  logger.info({ tenantId, s3Prefix }, 'Configuring S3 prefix');
  // In production: create the MinIO/S3 prefix by uploading a placeholder object
  // For now we just record the prefix — no actual S3 call needed for a prefix
  markStep('CONFIGURE_S3');
  ```
  The step computes a prefix string, logs it, writes it to `tenants.s3Prefix`, and marks the step done — no MinIO/S3 API call of any kind is made. This exactly matches the gap as given: "the 'configure S3 prefix' step is a no-op that only records a prefix string."

- **Current architecture:** `TenantProvisioner`'s constructor (`apps/tenant-service/src/domain/TenantProvisioner.ts:50-55`) takes `esUrl: string` and `minioBucket: string` — it already receives the bucket name but never constructs an S3 client or issues any S3 call with it; `minioBucket` is unused inside the class (confirmed by grep — `this.minioBucket` is never referenced anywhere in the file's body, only stored). Elsewhere in the codebase, `packages/platform-sdk/src/storage.ts` (package name `@erp/sdk`) already defines a real `StorageClient` (wraps `@aws-sdk/client-s3` + `@aws-sdk/s3-request-presigner`, `forcePathStyle: true` for MinIO compatibility) — built during ES-20 and genuinely wired into `sales-service`/`purchase-service`'s attachment routes via `PlatformContextFactory`'s optional `storageClient` construction (`packages/platform-sdk/src/context.ts:124-126`, `if (config.storage) { this.storageClient = new StorageClient(config.storage); } `). `tenant-service` itself does **not** currently depend on `@erp/sdk`'s `StorageClient` or `PlatformContextFactory` at all — confirmed via its `package.json` (`apps/tenant-service/package.json`), which lists `@erp/sdk` as a dependency already (used today only for `WorkflowEngine`/`RuleEngine` in the provisioning flow) but never imports `StorageClient` from it.

- **Current limitations:** No bucket/prefix is created or verified to exist in MinIO. No access policy scoping the tenant's prefix is applied (today, `erp-storage`/`erp-local` — check the actual configured bucket name via `MINIO_BUCKET` env var, per `apps/tenant-service/src/config.ts:28` and `ES-20_COMPLETION.md`'s note that the bucket must be created manually via `mc mb` before use — is one flat bucket with no per-tenant policy at all; isolation today is enforced only by the fact that `PlatformAttachments.upload()` always prefixes object keys with `tenant/${tenantId}/...`, i.e. **path-based convention only, not an enforced access policy**). If this step fails mid-provisioning, nothing rolls it back or retries it — and per the direct read of `provision()`, this is true of every step, not just this one (see the "checkpoint/resume" finding below, which corrects an assumption in how this gap was originally framed).

## Existing Code Analysis

- **What already exists and should be reused:**
  - `StorageClient` (`packages/platform-sdk/src/storage.ts`) — `uploadFile()`, `getSignedUrl()`, `deleteFile()`. This is the **one and only** S3/MinIO client in the codebase (confirmed: no other file in `apps/` imports `@aws-sdk/client-s3` or a `minio` package directly). This package must construct and use this class, not a second S3 client.
  - `apps/tenant-service/src/config.ts` already loads `minioEndpoint`/`minioAccessKey`/`minioSecretKey`/`minioBucket` from env (lines 25-28) — these map directly onto `StorageClientConfig` (`packages/platform-sdk/src/storage.ts:5-12`); tenant-service already has everything needed to construct a `StorageClient`, it just never does.
  - `TenantProvisioner`'s existing `markStep()`/`provisioningStatus` write-after-each-step pattern (`apps/tenant-service/src/domain/TenantProvisioner.ts:61-63` and the `await this.db.update(tenants).set({ provisioningStatus: ..., provisioningSteps: completedSteps })` calls after every step) — this package's real S3 step slots into the exact same position (STEP 6) with the exact same status-recording convention, no restructuring needed.
  - The tenant's already-computed `s3Prefix = tenants/${tenantId}` string (line 142) — reuse this exact prefix value as the object-key namespace root; do not compute a second prefix format.

- **What should never be modified:** The `PlatformAttachments`/`StorageClient` classes themselves (`packages/platform-sdk/src/attachments.ts`, `storage.ts`) — these are working, tested (`packages/platform-sdk/src/__tests__/attachments.test.ts`), and consumed by sales-service/purchase-service today; this package only adds a bucket-policy capability to `StorageClient` if genuinely needed (see Architecture) and must not change `uploadFile`/`getSignedUrl`/`deleteFile`'s existing signatures, since that would be a breaking change for two already-shipping services. The other 8 provisioning steps in `TenantProvisioner.provision()` are out of scope — do not touch `SEED_ROLES_PERMISSIONS`, `CREATE_ADMIN_USER`, `CREATE_ES_INDICES`, etc.

- **Prior related work:** `ES-20_COMPLETION.md` built `StorageClient`/`PlatformAttachments` and wired them into sales-service/purchase-service attachment routes — but that phase's scope was document attachments on existing tenants, not the provisioning flow for new tenants; it never touched `TenantProvisioner.ts`. That completion report's own "Deployment Checklist" also documents that the MinIO bucket itself (`erp-local`) was created **manually** via `mc mb local/erp-local` — i.e., even the bucket-existence assumption this whole feature depends on is currently a manual one-time step, not something any code (including this package, in its minimal v1 form) verifies. This package's step should verify the bucket exists (fail loudly if not) rather than assume it, since "the bucket was created manually once" is exactly the kind of undocumented tribal-knowledge dependency this backlog exists to close.

- **Correction to how this gap was originally framed:** The provisioning flow is described as "checkpointed" and this package was framed as needing to "extend" existing checkpoint/resume semantics. Direct read of `TenantProvisioner.provision()` shows this is **not accurate as a resume mechanism** — it is a **status ledger**, not a resumable saga. `completedSteps`/`provisioningStatus` are written to the DB after each step *for visibility* (so an operator can see how far a provisioning run got), but there is no `resume(tenantId)` method, no route that re-invokes provisioning from a partial state, and `provision()` itself always starts a brand-new tenant record from `CREATE_RECORD` — it cannot be re-entered partway through. If STEP 6 (or any step) throws today, the tenant is left in the DB with `status: 'PROVISIONING'` and a partial `provisioningSteps` map, permanently, with no code path that ever revisits it. **This package does not attempt to build a general resume mechanism for all 9 steps** (that would be a much larger, separate package, arguably its own PG entry, and out of scope for an S-complexity fix) — it makes the S3 step itself safe to fail without corrupting state (idempotent — safe to have "half-happened" — see Architecture) and, since it's the step being newly made real, gives it its own narrow, local rollback (delete any object it wrote) if a later step in the same run fails. It does not retroactively fix the other 8 steps' lack of resumability.

## Architecture

- **Make STEP 6 real, using the existing `StorageClient`, no second client:**
  1. Construct a `StorageClient` inside `TenantProvisioner` (constructor currently takes `esUrl`/`minioBucket` as raw strings — extend it to accept the full `StorageClientConfig`, or construct the `StorageClient` in `tenant.routes.ts` where `TenantProvisioner` is instantiated and pass it in, matching whichever wiring style keeps `TenantProvisioner`'s constructor from growing an unwieldy parameter list — check current call site at `apps/tenant-service/src/api/tenant.routes.ts:27` before deciding).
  2. On STEP 6, call `storageClient.uploadFile(tenantId, 'provisioning', '.tenant-init', Buffer.from(''), 'application/octet-stream')` (or equivalent) — a zero-byte placeholder object at the tenant's prefix root, which both (a) proves the bucket is reachable and writable before marking the step done, and (b) makes the tenant's prefix "exist" in the sense that S3-compatible storage understands (S3/MinIO has no real concept of an empty "folder" — a prefix only becomes visible/listable once at least one object exists under it, which is exactly why the original code comment says "create the MinIO/S3 prefix by uploading a placeholder object" — this package finishes exactly that stated intent).
  3. If the upload throws (bucket missing, MinIO unreachable, credentials wrong), **do not silently continue** (unlike the best-effort `CREATE_ES_INDICES`/`SEND_WELCOME_EMAIL` steps, which the existing code deliberately treats as non-fatal via try/catch-and-log) — this step should be fatal to provisioning, since a tenant with no verified storage location is a tenant that will fail its first real attachment upload later, silently, at a much less debuggable point. Mark `provisioningStatus: 'FAILED'` (a new value — see Database Changes) with the specific failure reason recorded, and surface a clear error back through `POST /admin/tenants`'s existing catch block (`apps/tenant-service/src/api/tenant.routes.ts:47-53`) rather than a generic 500.
  4. **Bucket-policy scoping (the "apply access policy" half of this gap):** confirm whether the actual production intent is per-tenant IAM-style bucket policies (MinIO supports this via its policy API) or whether path-convention isolation (already in place via `tenant/${tenantId}/...` object-key prefixing in `PlatformAttachments.upload()`) is considered sufficient for this codebase's threat model. **This is worth flagging rather than assuming:** MinIO bucket policies are typically applied at the bucket level or via prefix-scoped IAM policies tied to per-tenant access credentials — but this codebase issues **one shared set of MinIO credentials to every service** (`MINIO_ACCESS_KEY`/`MINIO_SECRET_KEY` env vars, same for all tenants), so a true per-tenant IAM policy would require per-tenant credentials, which is a materially bigger change (credential provisioning + rotation + secrets storage — and Vault, the natural place to store such credentials, is itself unintegrated per PG-004). Given the Complexity: S rating requested for this package, the recommended v1 scope is: **verify the bucket exists and is writable at provisioning time (the placeholder-object upload above), keep isolation enforced via the existing prefix convention, and explicitly document per-tenant IAM policies as a deferred hardening item** rather than building it now under a small-complexity budget. If per-tenant credential isolation is actually required before go-live, that is a separate, larger package (reasonably PG-029b or folded into PG-004's Vault work) — flag this back to the user/product owner rather than silently descoping it without saying so.
- **Component interactions and data flow:** `TenantProvisioner.provision()` STEP 6 → `StorageClient.uploadFile()` → MinIO/S3 → success updates `tenants.s3Prefix`/`provisioningStatus` as today; failure updates `provisioningStatus: 'FAILED'` and re-throws, which `POST /admin/tenants`'s existing try/catch surfaces to the platform operator as a clear provisioning failure (today, per the existing catch block, only duplicate-slug/email errors get a specific `BusinessError` — a new `BusinessError('S3_PROVISIONING_FAILED', ...)` should be added alongside it).

## Database Changes

- **`tenants.provisioningStatus` type union extension:** add `'FAILED'` to the existing `$type<'NOT_STARTED' | 'SCHEMA_CREATED' | ... | 'COMPLETE'>()` union (`packages/db-client/src/schema/tenant.ts:42-55`) — this is a TypeScript-level type change on an existing `varchar` column, not a structural migration (the column is already a loosely-typed `varchar(30)`, so no `ALTER TYPE`/enum migration is needed — this is the one genuine advantage of that column not being a Postgres native enum).
- **No new table.** No new column beyond what already exists (`s3Prefix`, `provisioningStatus`, `provisioningSteps` all pre-exist).
- **Migration approach:** Not applicable for the schema itself (a TS union-type widening on an already-loose `varchar` column requires no SQL migration) — **but** if the team wants a DB-level `CHECK` constraint on `provisioning_status` values (none currently exists — confirmed by reading the column definition, it's a bare `varchar(30)` with no check constraint), adding `'FAILED'` to that constraint would need a migration. Recommend **not** adding a new CHECK constraint as part of this small package (out of scope creep) unless one already exists elsewhere that this change would violate — verify via `\d tenants` or the migration history before assuming either way.
- **Rollback strategy:** Not applicable — no schema migration in the minimal path described above.

## Backend

- **Modify `apps/tenant-service/src/domain/TenantProvisioner.ts`:**
  - Constructor: accept a `StorageClient` instance (constructed by the caller in `tenant.routes.ts` from `config.minioEndpoint`/`.minioAccessKey`/`.minioSecretKey`/`.minioBucket`, following the existing `StorageClientConfig` shape) instead of the raw `minioBucket: string` it currently takes.
  - STEP 6 body: replace the comment-only no-op with the real `uploadFile()` call described in Architecture, wrapped so a failure sets `provisioningStatus: 'FAILED'` and re-throws (fatal), unlike the deliberately-best-effort `CREATE_ES_INDICES`/`SEND_WELCOME_EMAIL` steps which must remain untouched and still non-fatal.
- **Modify `apps/tenant-service/src/api/tenant.routes.ts`:** construct the `StorageClient` at route-registration time (line 27, where `TenantProvisioner` is currently constructed) and pass it in; add a new `catch` branch for the S3-specific failure alongside the existing duplicate-slug/email branch (lines 47-53).
- **Add `apps/tenant-service/package.json` dependency:** `@erp/sdk` is already listed (used for `WorkflowEngine`/`RuleEngine`) — no new package dependency needed, only a new import (`StorageClient`) from the package it already depends on. Confirm `@aws-sdk/client-s3`/`@aws-sdk/s3-request-presigner` resolve transitively through `@erp/sdk`'s own dependency on them (per `ES-20_COMPLETION.md`'s file list, these were added to `platform-sdk`'s own `package.json`) — if pnpm's workspace hoisting doesn't surface them for direct import in a strict setup, tenant-service may need them added to its own `package.json` too; verify by running a type-check/build after wiring, not by assuming either way.
- **Events/Kafka:** Not applicable — provisioning already doesn't emit outbox events for its own steps (confirmed: no `PlatformEventBus` usage anywhere in `TenantProvisioner.ts`); this package does not add one, since that would be scope creep beyond "make the S3 step real."
- **Idempotency:** the placeholder-object upload is naturally idempotent (uploading the same zero-byte object to the same key twice is harmless — S3/MinIO `PutObject` overwrites, no error) — this matters because, per the "correction" finding above, there is no automatic retry of a failed provisioning run, but if an operator manually re-runs `POST /admin/tenants` after fixing a MinIO connectivity issue (creating a *new* tenant record, since `provision()` cannot resume an old one), the new run's STEP 6 behaves identically and safely.

## Frontend

- Not applicable — no frontend change. Tenant provisioning is a platform-operator, API-only flow today (per `FEATURE_INVENTORY.md` §2, "tenant provisioning" is listed under platform administration with no dedicated provisioning-wizard UI referenced) — if a provisioning UI exists, verify it surfaces the new `FAILED` status and the specific error message, but do not build a new UI as part of this package if none currently reads `provisioningStatus` client-side.

## API Contract

- `POST /admin/tenants` — no change to the request shape. Response on S3 failure: `500` (or a more specific `502 BusinessError('S3_PROVISIONING_FAILED', 'Tenant storage could not be provisioned — check MinIO connectivity')`) instead of today's behavior, where the step "succeeds" unconditionally and the caller has no way to know storage isn't actually ready.
- No new endpoints.

## Multi-Tenant Considerations

- Isolation remains enforced via the existing `tenant/${tenantId}/...` object-key prefix convention (`PlatformAttachments.upload()`), unchanged by this package.
- Per-tenant IAM bucket policies are explicitly deferred (see Architecture) — flagged as a real gap for a future, larger package rather than silently scoped out.
- The `esIndexPrefix`/`CREATE_ES_INDICES` step (STEP 7, immediately after this one) is a separate, already-real integration (it does issue actual `PUT` calls to Elasticsearch, per `TenantProvisioner.ts:295-347`) — not touched by this package, mentioned only to make clear it does not have the same gap this package is fixing.

## Integration

- **tenant-service:** the only service touched — `TenantProvisioner.ts` and `tenant.routes.ts`.
- **`@erp/sdk` (packages/platform-sdk):** consumed (not modified, unless a bucket-verification helper is added — see below), specifically its already-shipping `StorageClient`.
- **Not touched:** every other service. sales-service/purchase-service's own use of `StorageClient` for attachments is unaffected (same class, same bucket, no shared state between this package's provisioning-time call and their per-request calls).
- Optional, small addition to `StorageClient` itself: a `bucketExists(): Promise<boolean>` helper (via `HeadBucketCommand`) so provisioning can give a clearer "bucket does not exist — run `mc mb` first" error message distinct from a generic connectivity failure. This is the one place this package might touch shared platform-sdk code — keep it additive (a new method), never changing `uploadFile`/`getSignedUrl`/`deleteFile`.

## Coding Standards

- Reuses `StorageClient` exactly as-is (or with one additive `bucketExists()` method) — no second S3/MinIO client introduced anywhere.
- `@erp/logger`'s `createLogger` — already used throughout `TenantProvisioner.ts`, continue the same `logger.info(...)`/`logger.warn(...)` call style for the new failure path (`logger.error(...)` for the fatal case, since this is the first genuinely fatal, non-best-effort external-call failure in this file).
- No new pattern introduced — this is a textbook "finish what the code comment already said to do" fix.

## Performance

- One additional small (zero-byte) S3 `PutObject` call per tenant provisioning — provisioning is a low-frequency, operator-initiated action (not a hot path), so no caching/batching concern.
- No index/query changes.

## Security

- Confirms/relies on MinIO credentials already being environment-scoped (`MINIO_ACCESS_KEY`/`MINIO_SECRET_KEY`) — this package does not change credential handling, only starts actually using the client those credentials already configure.
- The deferred per-tenant IAM policy question (see Architecture) is the one security-relevant gap this package does **not** close — flagged explicitly rather than silently left as an unstated assumption, per this backlog's own standard.
- No new external-facing surface — MinIO is an internal, backend-to-backend call, same trust boundary as every other `StorageClient` usage today.

## Testing

- **Unit:** `TenantProvisioner`'s STEP 6 logic with a mocked `StorageClient` — success path sets `provisioningStatus` correctly and records `s3Prefix`; failure path sets `provisioningStatus: 'FAILED'` and the `provision()` promise rejects with a message the route layer can pattern-match on. Add to (or create alongside) `apps/tenant-service/src/__tests__/tenant.integration.test.ts`.
- **Integration (real MinIO, `describe.skipIf` gated on a running MinIO instance, mirroring this repo's `describe.skipIf(!DATABASE_URL)` convention for Postgres-dependent tests):** provision a real tenant end-to-end against a local MinIO container, then assert the placeholder object actually exists at `tenant/${tenantId}/provisioning/.tenant-init` via a `HeadObjectCommand`/`getSignedUrl` round-trip.
- **Route-level:** `POST /admin/tenants` with a deliberately-misconfigured `StorageClient` (wrong bucket name) returns the new `S3_PROVISIONING_FAILED` business error, not a 201.

## Acceptance Criteria

- [ ] Provisioning a new tenant against a real (or locally-run) MinIO instance results in a real, verifiable object existing under `tenant/${tenantId}/...` — checkable via `mc ls local/<bucket>/tenant/<id>/` or an S3 `ListObjectsV2` call, not just a DB row.
- [ ] If MinIO is unreachable or the configured bucket doesn't exist, `POST /admin/tenants` fails with a clear, specific error (not a silent "success" with a broken `s3Prefix`), and the tenant record reflects `provisioningStatus: 'FAILED'`.
- [ ] `CREATE_ES_INDICES` and `SEND_WELCOME_EMAIL` steps remain best-effort/non-fatal exactly as before — verify by re-running the existing provisioning integration test suite and confirming no behavior change to those two steps.
- [ ] No second S3/MinIO client class exists anywhere in the codebase after this change (grep for `@aws-sdk/client-s3` imports — should still resolve to exactly the same single `StorageClient` usage sites as before, plus tenant-service).
- [ ] The deferred per-tenant IAM policy question is documented (in this file, already) rather than silently unaddressed.

## Deliverables

- **Files to create:** none (this is a modification-only package).
- **Files to modify:**
  - `apps/tenant-service/src/domain/TenantProvisioner.ts` (STEP 6 real implementation, constructor signature change).
  - `apps/tenant-service/src/api/tenant.routes.ts` (construct `StorageClient`, pass to `TenantProvisioner`, new catch branch).
  - `packages/db-client/src/schema/tenant.ts` (add `'FAILED'` to `provisioningStatus` union type).
  - `apps/tenant-service/package.json` (only if transitive `@aws-sdk/*` resolution doesn't work — verify before adding).
  - Optionally `packages/platform-sdk/src/storage.ts` (additive `bucketExists()` method).
- **Migrations:** none.
- **APIs added/changed:** `POST /admin/tenants` — same shape, new possible failure response (`S3_PROVISIONING_FAILED`).
- **Events added/changed:** none.
- **Tests added:** unit test for STEP 6 success/failure in `TenantProvisioner`, integration test against real MinIO, route-level failure-path test.

---

## Context Preservation (for a fresh AI session with no prior history)

**Previous Work Summary:** `TenantProvisioner.provision()` (`apps/tenant-service/src/domain/TenantProvisioner.ts`) runs a 9-step tenant setup, recording per-step completion status in `tenants.provisioningStatus`/`.provisioningSteps` as it goes (a status ledger, not a resumable saga — confirmed by direct read, no `resume()` method exists). STEP 6 ("configure S3 prefix") is a documented no-op: it computes a prefix string and marks itself done without ever calling MinIO/S3. Separately, ES-20 already built a real, working `StorageClient` (`packages/platform-sdk/src/storage.ts`, package name `@erp/sdk`) that sales-service and purchase-service already use for document attachments — tenant-service just never adopted it for its own provisioning step.

**Current Objective:** Make STEP 6 real — construct and use the existing `StorageClient` to actually verify/create a real object at the tenant's prefix in MinIO, fail provisioning loudly (not silently) if storage isn't reachable, and explicitly document (not silently skip) the question of per-tenant IAM bucket policies as a deferred hardening item.

**Architecture Snapshot:**
1. `StorageClient` (`packages/platform-sdk/src/storage.ts`) is the one S3/MinIO client in the codebase — `uploadFile`/`getSignedUrl`/`deleteFile`. Reuse it; never build a second one.
2. Tenant isolation in object storage today is path-convention-only (`tenant/${tenantId}/...` object-key prefix, enforced by `PlatformAttachments.upload()`), not an enforced bucket/IAM policy — because all services share one set of MinIO credentials.
3. `TenantProvisioner`'s "checkpointing" is a DB status ledger for operator visibility, not a resume mechanism — a failed step today leaves the tenant permanently stuck in `PROVISIONING` status with no automatic retry path. This package does not fix that generally; it only makes its own step (S3 config) fail loudly and be safely re-runnable (idempotent) if an operator manually starts a fresh provisioning attempt.
4. The MinIO bucket itself (`erp-local`/`erp-storage`, whichever `MINIO_BUCKET` resolves to) is currently created **manually** (`mc mb`) per `ES-20_COMPLETION.md`'s deployment checklist — this package's provisioning step should verify the bucket is reachable/writable, not assume it, but does not automate bucket creation itself (that's arguably infra/deployment scope, not application code).

**Completed Components:** `StorageClient`, `PlatformAttachments`, the attachment upload/download/delete flow in sales-service and purchase-service (all ES-20) — reused, not rebuilt, by this package.

**Pending Components:** Per-tenant IAM bucket policies (deferred — would require per-tenant MinIO credentials, which this codebase doesn't issue today, and likely depends on PG-004's Vault integration for safe credential storage). General provisioning resume/retry mechanism for all 9 steps (out of scope — a much larger, separate concern).

**Known Constraints:** Dev-phase — safe to test against a local MinIO/Docker instance; no production tenant data at risk.

**Coding Standards:** See Coding Standards section — this package introduces no new pattern, it completes an already-written code comment's stated intent using an already-built client.

**Reusable Components:** `StorageClient.uploadFile()`, tenant-service's existing `config.ts` MinIO env-var loading (already maps 1:1 onto `StorageClientConfig`).

**APIs Already Available:** Not applicable — no external API this package calls beyond MinIO/S3 itself via the existing client.

**Events Already Available:** Not applicable — provisioning doesn't emit outbox events today and this package doesn't add one.

**Shared Utilities:** `@erp/logger`, `@erp/sdk` (`StorageClient`), `@erp/types` (`BusinessError` for the new failure case).

**Feature Flags:** Not applicable.

**Multi-Tenant Rules:** Object-key prefix `tenant/${tenantId}/...` is the existing isolation convention — this package writes its placeholder object at exactly that prefix, introducing no new convention.

**Security Rules:** No new permission needed (this is internal to the already-`PLATFORM_TENANT_MANAGE`-gated `POST /admin/tenants` route). Per-tenant credential/IAM isolation explicitly flagged as deferred, not silently skipped.

**Database State:** No migration required — `provisioningStatus`'s `'FAILED'` addition is a TypeScript union-type widening on an already-loose `varchar(30)` column with no existing CHECK constraint (verify this remains true before implementing, in case a constraint was added by concurrent work since this doc was written).

**Testing Status:** `apps/tenant-service/src/__tests__/tenant.integration.test.ts` and `tenant-admin-authz.test.ts` are the existing test files most relevant to extend. `packages/platform-sdk/src/__tests__/attachments.test.ts` shows the existing mocking convention for `StorageClient` in unit tests.

**Next Session Plan:** Single session — this is an S-complexity, single-file-cluster fix.

**Prompt for the Next Session:** "Resume `ERP-PLANNING/production-gap-prompts/004-Platform/27-tenant-provisioning-s3-bootstrap.md` (PG-029). Before writing any code, re-read `apps/tenant-service/src/domain/TenantProvisioner.ts` STEP 6 to confirm it is still a no-op (concurrent work may have changed it since this doc was written), and re-check whether `apps/tenant-service/package.json` already transitively resolves `@aws-sdk/client-s3` through `@erp/sdk` or needs it added directly — verify via a real build, not an assumption."
