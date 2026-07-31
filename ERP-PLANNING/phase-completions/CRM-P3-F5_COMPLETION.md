# CRM-ROADMAP Phase 3, Feature 5 — Multi-language Communication — Completion Report

**Date:** 2026-07-30
**Status:** Complete.

## Summary

Regional-language template variants for campaigns, resolved per-recipient at send time by a
customer's preferred language, with an explicit fallback to the campaign's existing base template
when there's no match — additive throughout, so a campaign that never uses this feature sends
exactly as it does today.

- **`customers.preferredLanguage`** — a nullable BCP-47-ish tag (e.g. `'hi'`, `'ta'`, `'en'`). Null
  means no preference; `CampaignService.send()` falls back to the campaign's base
  `messageTemplate` for these customers, unchanged from today.
- **Translation-set model, not 1-template-1-language** — the roadmap's own acceptance criterion
  ("a template with two language variants") requires a single template/campaign to carry multiple
  language variants at once, so two new tables were added rather than a single `language` column:
  - `crm_campaign_template_translations` — per-language variants of a saved, reusable
    `campaignTemplates` row.
  - `crm_campaign_message_translations` — per-language variants of one concrete campaign, either
    snapshotted from a source template's translations at creation time (same "copy at creation,
    not a live link" convention `campaigns.messageTemplate` itself already uses) or authored
    directly on the campaign.
- **`CampaignService.send()` resolution, extracted as a pure, directly-testable function**
  (`resolveRecipientTemplate`): a matching-language translation wins outright for a recipient;
  A/B variant assignment (Phase 2 Feature 6) only runs when there isn't one. This is a deliberate
  scope decision — the two features are never combined for the same recipient in this pass (see
  Decisions #1).
- **API**: `PUT`/`GET /crm/campaign-templates/:id/translations` and
  `PUT`/`GET /crm/campaigns/:id/translations` — both replace-the-whole-set semantics (delete +
  bulk insert per call) rather than per-language granular routes, simpler for both the API and a
  "one save button" editor UX. The campaign-level PUT is blocked once the campaign has left
  DRAFT/SCHEDULED (same "can't rewrite content post-send" reasoning that already makes A/B
  variants create-only).
- **Frontend**: a "Language Variants" section on `CampaignDetailPage.tsx` (add/remove per-language
  variant, visible whenever any exist, editable while the campaign is still editable); a
  "Preferred Language" field on the customer form.

## Decisions / deviations (flagged during implementation, not silently decided)

1. **Language translations and A/B variants are deliberately not combined for the same
   recipient.** The roadmap doesn't address this interaction, and combining them would require a
   variant×language matrix — real scope growth beyond this feature's own "Medium complexity"
   framing. The chosen rule (language wins outright when it matches; A/B assignment runs only for
   recipients without a match) is simple, explicit, and tested — not left ambiguous.
2. **No frontend "template editor" exists to attach a language selector to** — `campaignTemplates`
   (the reusable template library, CP-4) already has full backend CRUD but genuinely zero frontend
   UI beyond a read-only dropdown inside `CampaignFormPage.tsx` (`createCampaignTemplate` is a
   pre-existing, entirely unused API function — confirmed by grep, not assumed). Building a full
   template-editor page from scratch is a separate, larger pre-existing gap, not part of this
   feature's scope. The template-translation backend routes were still built (so a tenant can
   populate them via direct API call today, and so a future template editor has something real to
   call), but the frontend language-variant UI was placed on the campaign detail page instead,
   which does have a real editor and directly delivers the roadmap's actual acceptance criterion
   ("send correctly-localized campaigns without manual per-language campaign duplication").
3. **A real bug found and fixed during test-writing**: the module-level `templatesToCheck` list
   (used for the pre-send DLT-compliance check) initially excluded the campaign's base
   `messageTemplate` whenever variants OR translations existed — but the base template is still a
   genuine possible send target whenever there are no A/B variants (recipients without a matching
   translation fall through to it). Fixed to include the base template whenever `variants.length
=== 0`, regardless of whether translations exist, with every translation template appended
   unconditionally.
4. **`preferredLanguage` uses free-form BCP-47-ish text, not an enum** — this codebase has no
   fixed language list anywhere, and a tenant may serve any regional language; validating against a
   closed set would need a first real language-taxonomy decision this feature doesn't require.

## Acceptance Criteria

- [x] A template/campaign with two language variants delivers the correct variant to each
      recipient in a mixed-language list — covered directly (live-DB `send()` test: a Hindi-
      preference recipient gets the Hindi variant; a no-preference recipient in the same send
      falls through to normal A/B variant assignment).
- [x] A customer with a preferred language that has no template variant falls back to the tenant
      (campaign) default without erroring — covered directly (`resolveRecipientTemplate` unit
      tests for the no-match and no-preference-at-all cases).
- [x] A tenant can send correctly-localized campaigns without manual per-language campaign
      duplication — covered directly (one campaign, one `send()` call, per-recipient resolution).

## Verification performed this session

- `pnpm --filter @erp/db build` / `@erp/sdk build` (unaffected but rebuilt regardless) — clean.
- `pnpm --filter sales-service type-check` / `web-frontend type-check` / `tenant-service
type-check` / `scheduler-service type-check` — all clean.
- `eslint` scoped to every touched/new file — 0 new errors (only the same pre-existing-style
  warnings already present throughout this codebase).
- **Live migration** `0132_crm_multilanguage_communication.sql` applied directly to the local dev
  Postgres (`customers.preferred_language` column; both new translation tables + indexes).
- **`campaign-service.test.ts`** — extended with `resolveRecipientTemplate` pure-function tests (5)
  and a live-DB `send()` integration test proving a matched-language recipient never receives an
  A/B variantId even when variants are configured, while an unmatched recipient still does —
  **115/115 passing** (109 pre-existing + 6 new).
- **New `crm-multilanguage-routes.test.ts`** (live-DB, real Fastify app) — **5/5 passing**:
  duplicate-language rejection, replace-not-merge semantics, template→campaign snapshot-copy on
  creation, and the DRAFT/SCHEDULED-only edit guard.
- **`customer.integration.test.ts`** — extended with a `preferredLanguage` persistence test —
  **6/6 passing**.
- **Full regression sweep**: targeted run of every file this feature (and Feature 6, same
  session) touched or added — **152/152 passing**. `pnpm --filter web-frontend test` — 430/430.
  `tenant-service`/`scheduler-service` type-check clean (schema-only consumers, no test changes
  needed there).

**Pre-existing, unrelated noise observed during this sweep (not fixed, not this feature's
scope)**: a full (untargeted) `pnpm --filter sales-service test` run shows the same 12
JWT-issuer-mismatch failures documented in Feature 6's completion report, plus one additional
file (`journey-service.test.ts`) that failed only in the full-suite run but passed cleanly
standalone (19/19) — that file and its underlying `JourneyService.ts` are both untracked/new in
git status, indicating a concurrent session's in-progress work on this shared repo (see
[[concurrent_sessions_on_same_repo]]), not a regression from this feature.

## Files touched

- `packages/db-client/src/schema/master.ts` — `customers.preferredLanguage`.
- `packages/db-client/src/schema/crm.ts` — `crmCampaignTemplateTranslations`,
  `crmCampaignMessageTranslations` tables + type exports.
- `packages/db-client/migrations/0132_crm_multilanguage_communication.sql` — new; applied live.
- `packages/db-client/migrations/meta/_journal.json` — appended entry.
- `apps/sales-service/src/domain/CampaignService.ts` — `resolveRecipientTemplate()`; `send()`
  wired to fetch translations and use it; `templatesToCheck` bug fix.
- `apps/sales-service/src/api/crm.routes.ts` — `TranslationsSchema`; 4 new routes (template + campaign
  translation GET/PUT); snapshot-copy on campaign creation from a template.
- `apps/sales-service/src/api/customer.routes.ts` — `preferredLanguage` in `CustomerSchema`.
- `apps/sales-service/src/domain/CustomerService.ts` — `preferredLanguage` in
  `CreateCustomerParams`.
- `apps/sales-service/src/__tests__/campaign-service.test.ts` — 6 new tests.
- `apps/sales-service/src/__tests__/crm-multilanguage-routes.test.ts` — new.
- `apps/sales-service/src/__tests__/customer.integration.test.ts` — 1 new test.
- `apps/web-frontend/src/api/endpoints.ts` — `campaignTranslations`/`updateCampaignTranslations`.
- `apps/web-frontend/src/pages/crm/CampaignDetailPage.tsx` — "Language Variants" section.
- `apps/web-frontend/src/schemas/customer.schema.ts` — `preferredLanguage` field.
- `apps/web-frontend/src/pages/customers/CustomerFormPage.tsx` — "Preferred Language" input.

## What is not done (remaining TODO)

| Item                                                                                   | Why deferred                                                                                                                                                                                 | Target                                                 |
| -------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------ |
| Playwright E2E specs for the 2 acceptance-criteria scenarios                           | Not run this session; logic covered instead by unit + live-DB integration tests                                                                                                              | Follow-up before Phase 3 sign-off                      |
| A real template-editor UI (language selector on it, per the roadmap's literal wording) | `campaignTemplates` has no frontend UI at all today, pre-existing gap; language-variant UI was placed on the campaign detail page instead, which delivers the same real acceptance criterion | Whenever the template-editor gap itself gets addressed |
| RTL / non-Latin script rendering verification in email templates                       | Roadmap's own stated edge case ("don't assume") — not verified against the existing Handlebars rendering this session                                                                        | Follow-up                                              |
| A/B variant × language combination                                                     | Deliberately out of scope (see Decisions #1)                                                                                                                                                 | Only if a real need for combining them surfaces        |

## Deployment Checklist

- [ ] Run migration `0132_crm_multilanguage_communication.sql` against every target database
      (staging/prod) — verified applied against the local dev DB this session only.
- [ ] No new environment variables.
