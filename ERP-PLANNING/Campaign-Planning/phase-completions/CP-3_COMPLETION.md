# PHASE CP-3 — Segmentation & Personalization — COMPLETION REPORT

## Generated: 2026-07-15 | Status: COMPLETE

> **This document is the official handoff artifact for Phase CP-3.**
> **The next phase (CP-4) MUST start by reading this document.**
> **Never modify this document after generation.**

---

## 1. PHASE SUMMARY

| Field        | Value                                                                  |
| ------------ | ---------------------------------------------------------------------- |
| Phase Number | CP-3                                                                   |
| Phase Name   | Segmentation & Personalization                                         |
| Start Date   | 2026-07-15                                                             |
| End Date     | 2026-07-15                                                             |
| Status       | COMPLETE                                                               |
| Engineer(s)  | Claude (autonomous execution, Campaign Management Platform initiative) |

---

## 2. WHAT WAS BUILT

### 2.1 Database Schema

No new tables/migrations. `customer_custom_attributes` and `personalization_token_fallbacks`, both
planned in `17_DATA_MODEL_AND_API_DESIGN.md`'s original CP-3 section, were **not created** — see section 13.

### 2.2 APIs Implemented / Changed

No new endpoints. `POST /crm/segments`, `POST /crm/segments/preview`, `POST /crm/campaigns/preview` all keep
their existing request/response shapes — `previewSample`'s response gained one additive field
(`fallbackWarnings: string[]`), and `SegmentService.customWhere` now accepts a wider set of `field` values
in the existing `rules[]` array — no schema/contract change to the endpoints themselves.

### 2.3 Services Implemented / Changed

```
apps/sales-service/src/domain/SegmentService.ts
  - FIELD_COLUMNS: +branchId, +gender, +anniversary (direct customer columns)
  - NEW: COMPUTED_NUMERIC_FIELDS — orderCount, averageOrderValue, lifetimeValue,
    daysSinceLastPurchase (correlated-subquery aggregates against invoices, tenant-scoped,
    same subquery shape as the existing prebuiltWhere cases)
  - NEW: JSON_TEXT_FIELDS — city, state, pincode (customers.billingAddress->>'...')
  - NEW: customField:<key> rule syntax — reads customers.customFields->>'<key>' (reuses the
    existing jsonb column already on the customers table)
  - buildCondition() now dispatches by field kind (column / computed-numeric / json-text /
    custom-attribute) instead of only column lookup; compareColumn/compareText/compareNumeric
    split out, each still building parameterized SQL only (no string-concatenated user input)

apps/sales-service/src/domain/CampaignService.ts
  - renderCampaignMessage(): +lastPurchaseDate, +lastPurchaseAmount tokens, with configured
    fallback values (TOKEN_FALLBACKS) instead of rendering blank/broken tokens
  - NEW: detectFallbackTokens() — reports which tokens in a template would hit a fallback for
    a given recipient's data (FR-F2)
  - NEW: getLastPurchase() — most recent non-draft/non-cancelled invoice for a customer
  - previewSample() now returns fallbackWarnings: string[] alongside the existing fields
  - send() conditionally fetches lastPurchase per recipient only when the template actually
    references one of the purchase-history tokens (avoids an unconditional extra query/recipient)
```

### 2.4 Frontend Screens

```
apps/web-frontend/src/pages/crm/SegmentFormPage.tsx
  - Rewritten from a single hardcoded rule to an arbitrary-length rules[] array with an AND/OR
    toggle shown between rows — the backend already supported this (filter_definition.rules[]
    + logic), the UI simply never exposed it before this phase
  - SEGMENT_FIELDS list expanded to match SegmentService's new whitelist (gender, dateOfBirth,
    createdAt, displayName, phone, email, city, state, pincode, orderCount, averageOrderValue,
    lifetimeValue, daysSinceLastPurchase) — branchId and customField:<key> intentionally left out
    of this iteration (see section 13)
  - Default state (1 rule, field=status, operator=eq) unchanged, so the existing E2E flow needed
    no test changes

apps/web-frontend/src/pages/crm/CampaignFormPage.tsx
  - TEMPLATE_VARS + the Template Variables helper list gained {{lastPurchaseDate}}/
    {{lastPurchaseAmount}}
  - Preview panel now surfaces fallbackWarnings as a visible warning box ("Missing data for this
    recipient") when the sampled recipient would hit a fallback for a token used in the template
```

---

## 3. TESTS

| File                                                                   | Tests                      | Type                                                                                                                                                                  |
| ---------------------------------------------------------------------- | -------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `apps/sales-service/src/__tests__/segment-service.test.ts` (extended)  | +8 (22 total)              | Unit/integration — branchId, gender, city/state (jsonb), contains on jsonb, customField:<key>, empty-key rejection, computed orderCount, contains-rejected-on-numeric |
| `apps/sales-service/src/__tests__/campaign-service.test.ts` (extended) | +9 (45 total for the file) | Unit — new-token substitution/fallback, `detectFallbackTokens` (5 cases), `previewSample` fallback-warning integration (2 cases)                                      |

### Test Execution Results

- `sales-service` full suite: **176/176 passing** (22 files).
- `tsc --noEmit` clean on `sales-service` and `web-frontend`.
- `eslint`: 0 errors across all changed files (one pre-existing blocking error, unrelated to CP-3's
  changes, was fixed in `CampaignFormPage.tsx` — see section 13 — everything else is warnings only,
  consistent with pre-existing style).
- `apps/web-frontend/e2e/live-crm.spec.ts`: **passing** (13.4s) against the live dev stack — confirms the
  new multi-rule segment builder UI's default single-rule state is backward compatible with the existing
  E2E flow, and that no frontend regression was introduced.

### Not Executed This Phase (documented, not silently skipped)

- **The E2E run above exercises the OLD backend** (`sales-service` still runs from a `dist/` build predating
  this phase's `SegmentService.ts`/`CampaignService.ts` changes — same constraint as CP-2, see that
  completion report). The E2E pass confirms the _frontend_ changes are non-regressive against the
  currently-running backend's single-rule/original-field-set behavior; it does **not** exercise the new
  multi-rule AND/OR combination, the new fields (city/state/orderCount/etc.), or the new personalization
  tokens against a live server. Those are covered by the unit/integration test suite (167 assertions
  against the real dev Postgres, just not through the HTTP/UI layer). **Rebuild + restart sales-service and
  re-run the E2E suite (plus a manual multi-rule segment creation) before relying on this in a live
  environment** — same outstanding action as flagged in CP-2, now compounding across two phases; strongly
  recommended to do this rebuild+restart+verify pass before starting CP-4, since CP-4 also touches the
  campaign builder UI and will otherwise be building on an unverified stack.
- **Restart explicitly attempted and denied this session:** `pnpm --filter @erp/sales-service build` and
  `pnpm --filter @erp/notification-service build` were run successfully (both compile cleanly with all
  CP-1/CP-2/CP-3 changes), but the subsequent restart of the running processes was blocked by this
  environment's safety classifier — correctly, since those processes were not started by this session and
  this repo has a documented pattern of concurrent sessions sharing the same dev stack. **This restart+
  verify pass must be done by a human, or a session that can confirm ownership of the running dev stack**,
  before this code is relied on live — flagging explicitly rather than working around the block.

---

## 7. KNOWN ISSUES AND TECHNICAL DEBT

| Issue                                                                                                                                                                       | Severity                  | Resolution Plan                                                                                              |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------- | ------------------------------------------------------------------------------------------------------------ |
| Live/E2E verification of CP-2 **and now CP-3**'s backend changes against the running dev stack is still pending                                                             | Medium-High (compounding) | Do a rebuild+restart+full-E2E pass before CP-4 starts, not after                                             |
| `branchId` and `customField:<key>` are supported by the backend but not exposed in the segment builder UI (no branch picker, no key+value pair input)                       | Low                       | Tracked as a UI gap, natural fit for CP-4's builder work since it already touches this page's surrounding UX |
| Segment builder UI has no field-type awareness (e.g. it doesn't render a date picker for `dateOfBirth` or a numeric-only input for `orderCount`) — all values are free-text | Low                       | Cosmetic; the backend validates/coerces correctly regardless. A future UX pass, not blocking                 |

---

## 12. WHAT IS NOT DONE (REMAINING TODO)

- "Save ad-hoc campaign filter as a segment" flow (`SH-18`) — deferred to CP-4, which builds the multi-step
  campaign wizard this naturally belongs inside.
- Segment overlap/de-dup preview (`NH-02`) — not scheduled.
- Additional personalization tokens from `11_SEGMENTATION_AND_PERSONALIZATION.md`'s full list
  (`recommendedProduct`, `couponCode`, `storeName`/`storeAddress`, `salespersonName`,
  `membershipTier`/`membershipExpiryDate`) were **not** built this phase — none of them have a real backing
  data source yet in this codebase (no recommendation engine, no coupon entity, no salesperson-assignment
  field on customers, no membership entity). Only `lastPurchaseDate`/`lastPurchaseAmount` were added because
  they're the only new tokens with real, already-existing data to back them (`invoices`). Building the rest
  would mean inventing placeholder data sources — explicitly avoided per this codebase's simplicity
  guidance; revisit once/if those entities exist elsewhere in the ERP.

---

## 13. ARCHITECTURE DECISIONS MADE IN THIS PHASE

| Decision                                                                                                                                                             | Why                                                                                                                                                                                                                                                                                                            | Alternatives Considered                                                                                                                                                                 |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Reused `customers.customFields` (existing jsonb column) instead of a new `customer_custom_attributes` table**, deviating from the original CP-3 data-model plan.   | The `customers` table already has a general-purpose `customFields: jsonb` column with zero current consumers — building a separate key/value table would duplicate what already exists and fragment where "custom data about a customer" lives.                                                                | Build the originally-planned table (rejected: pure duplication, same reasoning as CP-2's media-library decision).                                                                       |
| **Did not build `personalization_token_fallbacks`** (tenant-configurable fallback values) — fallbacks are hardcoded per-token constants (`TOKEN_FALLBACKS`) instead. | No UI or use case yet asks a tenant to customize a fallback string; hardcoded, sensible defaults ("no purchases yet", "0.00", "") satisfy FR-F2's actual requirement (never render a broken `{{token}}` literal) without speculative configurability.                                                          | Build the configurable table now (rejected: no consumer, premature — CLAUDE.md simplicity guidance). Revisit if/when a tenant-configuration UI for campaigns is built (CP-8 territory). |
| **Segment builder UI's new fields are typed as plain text inputs**, not field-type-aware widgets (date pickers, number inputs, branch dropdowns).                    | The existing single-rule UI already used a plain text `Input` for `value` regardless of field type — extending the same input for more fields is consistent with current UX rather than a scope-expanding redesign; CP-4's wizard is the natural place to revisit builder UX holistically.                     | Build type-aware inputs now (rejected: scope creep beyond "expose the AND/OR capability that already exists on the backend," which was this phase's actual mandate).                    |
| **`branchId` and `customField:<key>` intentionally left out of the frontend field list** despite being supported server-side.                                        | `branchId` needs a branch-name dropdown (not a raw ID text field) to be usable by a non-technical user; `customField:<key>` needs a two-part key+value input, not a single value field — both need actual UI design work beyond "add a string to an array," which belongs with CP-4's broader builder UX pass. | Ship a raw numeric branchId text input / a hacky "customField:X" combined-string input now (rejected: actively bad UX, not simplification).                                             |

---

## 14. RISKS FOR NEXT PHASE

| Risk                                                                                                                                                                                                | Impact                               | Mitigation                                                                                                                                                                               |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Live-stack verification debt now spans CP-2 and CP-3 (two phases of backend changes never run against a rebuilt server)                                                                             | Medium-High                          | **Do the rebuild+restart+E2E pass before starting CP-4** — this is now a recommended prerequisite, not just a nice-to-have, since CP-4 will build UI on top of both phases' backend work |
| The `contains` operator on jsonb text fields (`ILIKE` against a `->>'key'` expression) has not been checked for index usage at scale — no functional index exists on `billingAddress->>'city'` etc. | Low (current data volumes are small) | Watch during CP-8's performance pass (`18_PERFORMANCE_AND_SCALABILITY.md`); add a functional/GIN index only if profiling shows it's needed                                               |

---

## 15. FINAL ARCHITECTURE SUMMARY

CP-3 closed the gap between what `SegmentService`'s backend already supported (multi-rule AND/OR filter
definitions) and what the UI ever exposed (a single hardcoded rule) — `SegmentFormPage.tsx` now renders an
arbitrary number of rule rows with a logic toggle, using the exact same `filter_definition` storage shape
that already existed. The backend's targeting whitelist grew from 12 flat columns to include purchase-
history aggregates (order count, average/lifetime order value, days since last purchase), geography (city/
state/pincode via the existing jsonb address columns), and tenant-defined custom attributes — reusing the
`customers.customFields` jsonb column already on the table rather than adding new schema. Personalization
gained two new, data-backed tokens (`lastPurchaseDate`/`lastPurchaseAmount`) with fail-safe fallback
rendering and a preview-time warning surfaced in the campaign builder UI. As with CP-2, this phase's backend
changes have not yet been verified against a rebuilt, restarted `sales-service` — the E2E pass this phase
confirms frontend non-regression against the currently-running (pre-CP-3) backend only. **A rebuild+
restart+full-verification pass is recommended before CP-4 begins**, to avoid compounding unverified backend
changes across three phases. CP-4 (Campaign Builder 2.0) is next — it depends on both CP-2 (media) and CP-3
(segmentation/personalization).

---

_Generated by: Claude Sonnet 5 | Date: 2026-07-15 | Next Phase: CP-4 — Campaign Builder 2.0_
