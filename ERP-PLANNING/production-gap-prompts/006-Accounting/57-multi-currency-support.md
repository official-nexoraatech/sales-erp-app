# [PG-036] Multi-currency support

> Template version 1.0. Every gap-prompt file in this tree must follow this exact section order. Do not add sections; do not omit sections that apply. If a section genuinely does not apply to this gap, write "Not applicable — <one-line reason>" instead of deleting it, so the structure stays diffable across files.

**Category:** Accounting
**Priority:** Low
**Complexity:** XL — touches invoice/PO/journal schema across at least 3 services, introduces a new exchange-rate domain concept, and requires a functional-vs-transaction-currency accounting convention with no existing partial implementation to build on
**Depends on:** none
**Blocks:** none — this is Phase 9 (Enterprise Enhancements), explicitly deferred past core production-readiness (see `000-Master-Roadmap.md`, Phase 9 section)
**Primary service(s)/package(s):** apps/accounting-service, apps/sales-service, apps/purchase-service, packages/db-client

---

## Overview

- **Business objective:** this ERP is built for a domestic (India) cloth-retail business — every amount, everywhere, is implicitly INR. A tenant that starts importing fabric from overseas suppliers or exporting to international customers needs invoices, purchase orders, and journal entries denominated in a foreign currency, converted to INR (the functional/reporting currency) at the applicable exchange rate, with realized/unrealized gain-or-loss tracked as rates move between transaction and settlement dates. **This is explicitly out of scope for core production-readiness** — the business this ERP currently serves (per `ERP-PLANNING/reports/FEATURE_INVENTORY.md`'s scope note: "a B2B/retail-operations ERP for a clothing business") is domestic-only today, and no part of the codebase has begun to model currency beyond a cosmetic default. This package exists so that if/when a specific tenant with import/export operations is signed, there's a scoped starting plan — it is **not** a gap blocking go-live for the ERP's current target customers, and should not be pulled forward into Phase 0-8 without an explicit product decision to do so.
- **Current implementation:** confirmed by direct grep across the codebase — a `currency` column exists in `packages/db-client/src/schema/sales.ts`, `purchase.ts`, `items.ts`, and `tenant.ts`, but every instance is a cosmetic `varchar(3).default('INR')` with **no exchange-rate field anywhere**. `apps/accounting-service`'s Chart of Accounts, journal entries (`accounts`, `journals`, `financial_entries` in `packages/db-client/src/schema/accounting.ts`), and every report (`ReportsEngine.ts`) have **zero currency awareness** — no currency column exists on any of them, and every amount is treated as a single implicit unit throughout.
- **Current architecture:** all monetary amounts flow through the system as plain `numeric(15,2)` columns with no currency tag beyond the cosmetic tenant-level default, and all cross-service postings (`InvoiceAccountingConsumer`, `PaymentAccountingConsumer`, `GRNAccountingConsumer`, etc. in `apps/accounting-service/src/consumers/`) assume the amount they receive is already in the tenant's single operating currency.
- **Current limitations:** there is no functional-vs-transaction-currency distinction, no exchange-rate table/source, no realized/unrealized FX gain-or-loss account or posting logic, and no UI anywhere to enter a non-INR amount that would be meaningfully different from just relabeling the currency symbol.

## Existing Code Analysis

- **What already exists and should be reused:** the cosmetic `currency` columns on `sales.ts`/`purchase.ts`/`items.ts`/`tenant.ts` are a reasonable place to *start* from — they establish the naming convention (`varchar(3)`, ISO 4217 codes, default `'INR'`) that a real implementation should keep rather than replace. The existing Posting Matrix (`PostingMatrixService`) pattern for event-driven journal construction is the right place to add FX-gain/loss postings once real conversion exists, rather than inventing a parallel posting mechanism.
- **What should never be modified:** none of this package should touch the existing single-currency (INR) path's behavior for tenants that don't opt into multi-currency — every existing report, journal, and invoice computation must continue to work identically for the ERP's current (100% domestic) customer base. This is a hard backward-compatibility requirement, not just a style preference, per the Master Roadmap's "Enterprise Architecture Guidance": "these are gap-closures on a live schema/API surface, not a rewrite... no package here should require a breaking API version bump."
- **Prior related work:** none — `ERP-PLANNING/reports/FEATURE_INVENTORY.md` §5.6 states plainly "No multi-currency, no departments/cost-centers," and no phase-completion report or audit doc has previously scoped this feature. This package is the first time it's been broken down.

## Architecture

**This section deliberately stays at scoping depth, not implementation depth — appropriate for an XL, Phase-9, not-yet-committed feature.**

- **Functional vs. transaction currency convention:** every tenant has one functional/reporting currency (today implicitly INR, matching the existing `tenant.currency` default). A multi-currency-enabled tenant can additionally record transactions (invoices, POs, journal entries) in a different *transaction currency*, always storing both the transaction-currency amount and its functional-currency-equivalent (converted at the rate in effect on the transaction date) side by side — this is the standard double-amount-column convention (similar to how many ERPs store `amount` + `amount_base`), not a single-column currency swap.
- **Exchange-rate source and storage:** a new `exchange_rates` table (tenant-scoped or platform-shared — needs a product decision, since rates are objectively the same across tenants but sourcing/caching strategy affects whether it's platform-level or per-tenant) storing `(currency_pair, rate, effective_date, source)`. Rate *source* needs a product decision too: manual entry by an accountant (simplest, matches this ERP's manual-heavy accounting conventions elsewhere e.g. TDS/GST manual entry patterns) vs. an external rate-API integration (adds an outbound dependency this codebase currently has none of, comparable in shape to the NIC e-invoice integration but for a different domain).
- **Realized vs. unrealized FX gain/loss:** at invoice/PO creation, the transaction-date rate is locked in. At payment/settlement, if the rate has moved, the difference between the locked-in and settlement-date functional-currency amounts is a *realized* FX gain/loss, posted through a new dedicated FX Gain/Loss income/expense account (following the exact same seeded-system-account pattern as `default-accounts.ts`'s existing entries). At period-end, any *open* (unsettled) foreign-currency receivable/payable needs *unrealized* FX gain/loss revaluation against the period-end rate — this is a new scheduled/manual process with no existing analog in this codebase (the closest existing pattern is Fixed Asset monthly depreciation's batch-run convention in `FixedAssetService`, which could be a structural reference for a periodic FX revaluation job).
- **Entities needing a currency field beyond the existing cosmetic one:** `invoices`/`quotations` (sales-service), `purchase_orders`/`grns` (purchase-service), `journals`/`financial_entries` (accounting-service) — each needs both a `transaction_currency` and a `exchange_rate_used`/`functional_currency_amount` pairing, not just the existing single cosmetic `currency` column.
- This is explicitly **not** designed further in this document — an XL, Phase-9 feature of this shape needs its own dedicated architecture-design session (with product sign-off on the open questions above: rate source, rate-table scope, and whether unrealized-FX revaluation is in v1 or a v2 follow-up) before schema/backend work starts, per the Master Roadmap's own multi-session guidance for XL packages.

## Database Changes

- **Not designed in this document** — this is intentionally deferred pending the product decisions in Architecture above (rate source, table scope). At a minimum, any future implementation will need: a new `exchange_rates` table; new `transaction_currency`/`exchange_rate_used`/`functional_currency_amount` columns (additive, nullable, backward-compatible defaults) on `invoices`, `purchase_orders`, `journals` (or `financial_entries`); and a new FX Gain/Loss system account seeded per multi-currency-enabled tenant (following the `default-accounts.ts` pattern, same as PG-033's Income Summary account).
- **Migration approach:** whenever implemented, must follow this repo's additive/reversible migration convention (`packages/db-client/migrations/NNNN_*.sql`) — every new column nullable/defaulted so existing single-currency tenants are completely unaffected.
- **Rollback strategy:** not designed here — deferred to the dedicated implementation session, which should treat this as any other additive migration (new tables/columns droppable without touching existing single-currency data).

## Backend

Not designed in this document — deferred. At minimum, future work will touch: `apps/sales-service` (invoice/quotation creation to accept transaction currency), `apps/purchase-service` (PO/GRN equivalent), `apps/accounting-service` (journal posting to carry both amounts, new FX gain/loss posting logic, a period-end unrealized-revaluation job comparable in shape to `FixedAssetService`'s depreciation batch run). No Kafka event schema is currently equipped to carry a second currency-amount pair — every consumer (`InvoiceAccountingConsumer`, `PaymentAccountingConsumer`, etc.) would need a payload-shape review.

## Frontend

Not designed in this document — deferred. At minimum: invoice/PO creation forms need a currency selector + live-converted-amount preview, and every financial report needs either a currency toggle or an explicit "reporting currency" label to avoid ambiguity once more than one currency exists in the system.

## API Contract

Not applicable — no concrete endpoint is being added or changed in this planning package; that's the dedicated implementation session's job once product scope is confirmed.

## Multi-Tenant Considerations

Multi-currency should be a **per-tenant opt-in feature flag** (following this codebase's existing tenant feature-flag convention — e.g. `einvoice_enabled`, `fifo_valuation` in `tenant-service`'s seeded flag list) rather than a global behavior change, so the ERP's current 100%-domestic tenant base sees zero change in behavior, UI, or report shape unless explicitly enabled for a specific enterprise customer.

## Integration

Would eventually touch `apps/sales-service`, `apps/purchase-service`, and `apps/accounting-service` at minimum, plus `apps/report-service` (every financial report needs currency-awareness once this exists). Not designed further here.

## Coding Standards

Any future implementation must follow this repo's existing conventions (Fastify + Zod + Drizzle, `requirePermission()`, the existing feature-flag mechanism for gating) — explicitly called out here so a future session doesn't invent a parallel currency-handling pattern instead of extending the existing cosmetic `currency` columns' naming convention.

## Performance

Not applicable at this planning depth — no implementation-level performance concern has been analyzed yet.

## Security

Not applicable at this planning depth beyond the general observation that an exchange-rate source (if externally sourced rather than manually entered) would be this codebase's first outbound rate-API dependency, and would need the same input-validation/rate-limiting scrutiny any new external integration gets.

## Testing

Not applicable at this planning depth — no implementation exists yet to test. A future implementation session should define its own test plan once schema/backend scope is finalized.

## Acceptance Criteria

- [ ] This document exists and clearly states multi-currency is Phase 9 / enterprise-only, not a core production-readiness gap — done, per the framing above.
- [ ] No further acceptance criteria are defined here; a dedicated implementation session must first resolve the open product questions (rate source, rate-table scope, v1-vs-v2 unrealized-FX-revaluation) before any code-level acceptance criteria can be written.

## Deliverables

- **Files to create:** none in this planning pass — deferred to implementation.
- **Files to modify:** none in this planning pass.
- **Migrations:** none in this planning pass.
- **APIs added/changed:** none in this planning pass.
- **Events added/changed:** none in this planning pass.
- **Tests added:** none in this planning pass.

---

## Context Preservation (for a fresh AI session with no prior history)

**Previous Work Summary:** this ERP has zero multi-currency capability. Existing `currency` columns on `sales.ts`/`purchase.ts`/`items.ts`/`tenant.ts` are cosmetic (`varchar(3).default('INR')`, no rate field, never read for conversion anywhere). `accounting-service`'s Chart of Accounts, journals, and every report are entirely currency-unaware. This is a deliberate, explicitly-scoped-out gap for the ERP's current domestic-only customer base, not an oversight.

**Current Objective:** this document is a *scoping* package, not an implementation plan — it exists so that if a specific enterprise customer with import/export operations is signed, there's a starting point for the real design conversation (rate source, rate-table scope, functional-vs-transaction-currency convention, realized-vs-unrealized FX gain/loss) rather than starting from zero. **Do not implement this package without an explicit, separate product decision to prioritize it** — it is Phase 9 (Enterprise Enhancements) in `000-Master-Roadmap.md`, deliberately sequenced after all of Phase 0-8's production-readiness work.

**Architecture Snapshot:** (1) all amounts today are implicit single-currency `numeric(15,2)` with no conversion concept anywhere; (2) the existing cosmetic `currency` columns establish a naming convention worth keeping; (3) the existing per-tenant feature-flag mechanism (`tenant-service`) is the right gating mechanism, not a global schema change; (4) `default-accounts.ts`'s system-account-seeding pattern (reused by PG-033 for Income Summary) is the right pattern for a future FX Gain/Loss account; (5) `FixedAssetService`'s monthly batch-depreciation-run convention is a structural reference for a future periodic unrealized-FX-revaluation job.

**Completed Components:** none — this is 100% net-new capability with no partial implementation anywhere in the codebase.

**Pending Components:** everything — schema design (rate table + dual-amount columns), backend (sales/purchase/accounting posting logic + FX gain/loss), frontend (currency selectors, converted-amount previews, currency-aware reports), and the underlying product decisions (rate source: manual vs. external API; rate-table scope: per-tenant vs. platform-shared; v1 scope: realized-only vs. realized+unrealized).

**Known Constraints:** must be additive and feature-flag-gated — zero behavior change for the ERP's current 100%-domestic tenant base is non-negotiable, per this repo's "no breaking API version bump" convention for gap-closure packages.

**Coding Standards:** any future implementation reuses this repo's existing Fastify + Zod + Drizzle + feature-flag conventions — no new architectural pattern should be introduced without strong justification.

**Reusable Components:** `default-accounts.ts` (system-account seeding pattern), `FixedAssetService` (periodic batch-job structural reference), the existing tenant feature-flag mechanism.

**APIs Already Available:** not applicable — no multi-currency API exists to build on.

**Events Already Available:** not applicable.

**Shared Utilities:** not applicable at this planning depth.

**Feature Flags:** a new flag (e.g. `multi_currency_enabled`) would need to be added to `tenant-service`'s seeded flag list, following the existing convention (`einvoice_enabled`, `fifo_valuation`, etc.).

**Multi-Tenant Rules:** must be strictly opt-in per tenant; must never change computed report output for a tenant that hasn't enabled it.

**Security Rules:** not applicable at this planning depth beyond noting a future external rate-API integration would need the same scrutiny as any new outbound dependency.

**Database State:** no schema exists yet for this feature; depends on whatever migration baseline is current at implementation time.

**Testing Status:** none — no implementation exists.

**Next Session Plan:** this package itself needs splitting once a product decision is made to proceed — recommended split: (1) a dedicated architecture/design session resolving the open questions in this document; (2) schema + accounting-service backend (rate table, dual-amount journal posting, FX gain/loss); (3) sales/purchase-service integration (invoice/PO transaction-currency capture); (4) frontend (currency selectors, currency-aware reports); (5) unrealized-FX period-end revaluation job, if included in v1 scope.

**Prompt for the Next Session:** "Before implementing anything from `ERP-PLANNING/production-gap-prompts/006-Accounting/57-multi-currency-support.md` (PG-036), confirm with the product owner that multi-currency is now prioritized (it is Phase 9 / enterprise-only, deliberately deferred past core production-readiness). If confirmed, start with the open architecture questions in that document's Architecture section (exchange-rate source: manual vs. external API; rate-table scope: per-tenant vs. platform-shared; v1 scope: realized-FX-only vs. realized+unrealized) before writing any schema or code — this is an XL package that needs its own design session, not a direct implementation start."
