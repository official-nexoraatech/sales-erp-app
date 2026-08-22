# 18 — Observability and Audit

## Minimal, by design

No new metric needed — this phase adds no request-time decision point (no `requireCapability`-style gate), so there is nothing analogous to `erp_capability_check_denied_total` to instrument. A migration-completion log line (standard for any migration in this repo, not phase-specific) is sufficient.

## Audit

`tenant.routes.ts:154`'s existing `TENANT_CREATED` audit-log entry already records `vertical` — optionally extended to also record `businessTypeId`/`code` (`05-service-impact.md`'s optional item). Not required for this phase's acceptance criteria.

## No dashboard

Nothing here warrants one — two small, rarely-changing reference tables and a backfilled column carry no ongoing operational signal worth a dashboard.
