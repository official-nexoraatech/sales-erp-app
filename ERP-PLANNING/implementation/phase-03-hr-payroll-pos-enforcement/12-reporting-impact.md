# 12 — Reporting Impact

## No report changes

This phase adds no new report and modifies no existing report's data source, dimensions, or measures. `report-service`'s sales/payroll reports read already-written table data (`invoices`, `payroll_runs`, etc.) independent of which route originally wrote it — a POS-originated invoice and a manually-created invoice are indistinguishable to `report-service` today (confirmed by the existing architecture, not re-verified line-by-line this session, consistent with the trust-boundary reasoning `41-phase-2b-closure-review.md` §9 already applied to a structurally identical question for Phase 2B).

## Why no new report is needed

Unlike Phase 2B (which added a genuinely new operational view, Near-Expiry Stock), this phase gates access to existing write paths — it produces no new data shape a report could meaningfully surface. A tenant seeing `403 CAPABILITY_NOT_ENABLED` on a POS sale simply doesn't create the invoice; there is nothing new to report on that state (it's absence-of-data, not a new data category), and it is already observable via the metric/log path (`18-observability.md`), which is the correct instrument for an operational/security signal, not a business report.
