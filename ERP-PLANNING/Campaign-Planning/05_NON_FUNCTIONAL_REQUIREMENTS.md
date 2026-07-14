# 05 — Non-Functional Requirements

`NFR-xx`. These apply across all phases; each phase's Definition of Done checks the subset relevant to what
it touches (see `22_DEFINITION_OF_DONE_AND_RELEASE_CHECKLIST.md`).

## Performance

- **NFR-01**: Campaign creation, preview, and list endpoints respond in < 500ms p95 at current data volumes
  (tenant with up to ~50k customers).
- **NFR-02**: Recipient fan-out for a campaign of up to 10,000 recipients completes without blocking any
  single HTTP request beyond a few seconds — enforced by moving to a background worker (CP-5), not by
  raising timeouts.
- **NFR-03**: Segment preview/count queries use existing indexes on `customers`; new targeting fields added
  in CP-3 must not require a full table scan (add indexes as needed, e.g. on computed purchase-aggregate
  columns or a materialized summary table if a raw aggregate proves too slow).

## Scalability

- **NFR-04**: The channel-provider abstraction (CP-2) must allow adding a provider without redeploying or
  modifying `CampaignService`, `SegmentService`, or the campaign schema.
- **NFR-05**: The dispatch/send path must scale horizontally (multiple workers consuming a queue) rather
  than relying on a single service instance's in-process concurrency.
- **NFR-06**: Multi-tenant isolation (`tenant_id` scoping) must be preserved on every new table and query
  added in this roadmap — no query may cross tenant boundaries.

## Reliability

- **NFR-07**: The existing circuit-breaker/retry pattern is preserved and extended to every new channel
  adapter, not reimplemented per-channel.
- **NFR-08**: A campaign send that partially fails must leave the system in a resumable state (per-recipient
  status already supports this — CP-5 must not regress it when moving to a queue).
- **NFR-09**: Delivery-webhook receivers (CP-6) must be idempotent — a provider redelivering the same
  webhook must not double-count analytics.

## Accessibility

- **NFR-10**: All new/changed frontend surfaces meet the same axe-core-verified accessibility bar already
  established elsewhere in the ERP UI redesign (see `erp_ui_redesign_docset_2026_07_07` memory) — keyboard
  navigable, screen-reader labeled, HC-mode compatible.

## Internationalization

- **NFR-11**: Multi-language campaign content (FR-D7) must not assume a fixed language list — language codes
  are data, not enum values.
- **NFR-12**: Timezone handling (FR-E2) stores UTC internally and only converts for display/scheduling
  decisions, consistent with existing ERP date-handling conventions (see the raw-SQL Date-interpolation bug
  pattern in memory — always `.toISOString()` before any raw SQL date interpolation).

## Security

- **NFR-13**: All new endpoints require authentication + explicit permission checks (see
  `15_ROLES_PERMISSIONS_SECURITY_COMPLIANCE.md`), consistent with every existing route in `crm.routes.ts`.
- **NFR-14**: Delivery-webhook receivers (public-facing, called by MSG91/SendGrid/Meta) must verify
  provider-signature/HMAC where the provider supports it, and must not accept arbitrary tenant/campaign IDs
  without cross-checking the webhook's own auth context.
- **NFR-15**: Media uploads (CP-2) are validated for file type/size server-side, not just client-side, and
  stored with tenant-scoped access control.
- **NFR-16**: No secrets (provider API keys) are ever logged, consistent with the existing pattern in
  `notification-service/src/config.ts`.

## Compliance

- **NFR-17**: Opt-out enforcement (already real today) must remain a non-bypassable gate in every new send
  path, including automation (CP-5) and any new channel (CP-2).
- **NFR-18**: Consent basis and preference-center changes (CP-7) are themselves audit-logged (who changed
  what preference, when).

## Maintainability

- **NFR-19**: Every phase ships with tests at the bar defined in `23_TESTING_STRATEGY.md` for the code it
  touches — testing is not deferred entirely to CP-9.
- **NFR-20**: Documentation in this folder is updated in the same PR/session as the code it describes
  becomes stale otherwise (see the "Living Documentation" principle in the README).

## Backward Compatibility

- **NFR-21**: No phase may remove or rename an existing column, endpoint, or status value that the current
  frontend/E2E test depends on without a compatibility shim and a migration note in
  `19_MIGRATION_AND_BACKWARD_COMPATIBILITY.md`.
