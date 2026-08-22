# 04 — Domain Model

## No new entities

This phase is authorization-boundary work on existing routes. It introduces zero new tables, zero new Drizzle schema, zero new domain entities.

| Concept                                                                                        | NEW / MODIFIED / UNCHANGED                                                                                                                       |
| ---------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| `CapabilityDefinition` (type)                                                                  | UNCHANGED                                                                                                                                        |
| `CAPABILITY_REGISTRY['HR_PAYROLL']`                                                            | UNCHANGED (value)                                                                                                                                |
| `CAPABILITY_REGISTRY['POS']`                                                                   | UNCHANGED (value)                                                                                                                                |
| `payroll_runs`, `payroll_slips`, `salary_structures`, `employee_salaries` (existing HR schema) | UNCHANGED                                                                                                                                        |
| `pos_sessions`, `pos_held_sales`, `invoices`, `invoice_lines` (existing sales schema)          | UNCHANGED                                                                                                                                        |
| `feature_flags` rows for `hr.payroll.enabled`/`pos.enabled`                                    | **Possibly MODIFIED in value (not shape)** — only if D1 resolves toward a backfill (`06-database-impact.md`). No column/table change either way. |

## Why no domain modeling is needed here (contrast with Phase 2B)

Phase 2B added a real domain concept (`items.fefoEnabled`, expiry-aware consumption ordering) alongside its capability wiring — that phase's `04-domain-model.md` had substantive content. This phase adds no analogous concept: `requireCapability` is a pure authorization preHandler, and the six/fifteen routes it's added to already have complete, correct domain logic (`PayrollEngine`, `InvoiceService`, etc.) that is not being touched. This document exists to state that explicitly, per the required documentation structure, not because there is a domain model to design.
