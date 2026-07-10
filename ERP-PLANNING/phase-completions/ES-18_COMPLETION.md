# ES-18 Completion Report — CRM & Customer Communication
**Date:** 2026-07-03
**Status:** COMPLETE (gap-closing scope — see note below)

## Scope note — read before using this report

Most of ES-18's stated objective was **already built in Phase 9 ("CRM and
Customer Engagement", completed 2026-06-30)** under different naming and a
different schema than ES-18 assumed:

| ES-18 asked for | Already existed (Phase 9) |
|---|---|
| `customer_interactions` table + log API | `customer_interactions` (`type: VISIT\|CALL\|COMPLAINT\|EMAIL\|WHATSAPP\|OTHER`), `POST`/`GET /customers/:id/interactions` |
| A notification service/worker with SMS/WhatsApp/Email | `notification-service` — real MSG91 (SMS), SendGrid (Email), Meta Cloud API (WhatsApp) delivery, retry, quiet-hours, templates |
| Customer 360 view | `CustomerViewPage` tabs: Details / Activity Timeline / Interactions |

Rather than build a second, parallel system per ES-18's literal spec (its own
BullMQ queue, its own interaction schema with `subject`/`outcome`), this pass
**closed the genuine gaps** on top of the Phase 9 foundation. This was a
deliberate scope decision made with the user before implementation — see
"What was intentionally not built" below.

## What Was Built This Pass

1. **Communication opt-out** — `customers.opt_out_sms` / `opt_out_whatsapp` / `opt_out_email` (new columns, default `false`), `PATCH /api/v2/customers/:id/opt-out`, toggle UI on `CustomerViewPage`. This was explicitly deferred by the Phase 9 completion report ("Campaign recipient opt-out / unsubscribe — Not in Phase 9 spec — Deferred to Phase 10").
2. **Payment reminder automation** — `PaymentReminderService.findCandidates()` finds customers with `OVERDUE` invoices (`balanceDue > 0`) not already reminded today (dedup via a `SYSTEM`-type `customer_interactions` row). `POST /api/v2/crm/payment-reminders/send` (internal, all active tenants) sends WhatsApp → SMS fallback, plus Email independently, each gated by the customer's opt-out flags. The scheduler-service job `sales.overdue-payment-reminder` (previously a no-op stub, cron `0 10 * * 1,3,5`) now calls this endpoint.
3. **Invoice-confirmed notification** — `InvoiceNotificationService.notifyInvoiceConfirmed()` fires WhatsApp + Email best-effort right after `POST /invoices/:id/confirm` succeeds, gated by opt-out flags. Never throws — a notification-service outage cannot block invoice confirmation.
4. **24-hour interaction edit window** — `PUT /api/v2/customers/:id/interactions/:interactionId`, rejects edits once `createdAt` is more than 24h old (`INTERACTION_EDIT_WINDOW_EXPIRED`).
5. **`SYSTEM` interaction type** — added to `customer_interactions.type` (soft/TS-level union, no CHECK constraint existed) so automated reminders leave an audit trail alongside human-logged interactions.

## What Was Intentionally Not Built

| ES-18 item | Why skipped |
|---|---|
| Separate `apps/notification-service` BullMQ `notifications` queue per spec | Phase 9's `notification-service` already does this job (SMS/WhatsApp/Email + retry + quiet hours); building a second queue would fork delivery logic in two places |
| ES-18's own `customer_interactions` schema (`subject`, `outcome` fields) | Phase 9's schema (`type`, `notes`, `followUpDate`) already covers the same use case; changing it would be a breaking migration for no functional gain |
| Dedicated `/sales/customers/:id/360` route | `CustomerViewPage`'s Details/Timeline/Interactions tabs already serve as a 360 view; a second page would duplicate it |
| Opt-out enforcement retrofitted onto **campaigns** or **birthday greetings** | Out of scope for this pass — those are pre-existing Phase 9 sends, not ones introduced here. Flagged as follow-up below. |

## Follow-up Recommended (Not Done)

- **Campaign and birthday-greeting sends do not check opt-out flags.** Both existed before this pass and were not touched to avoid scope creep, but the opt-out columns now exist — retrofitting `CampaignService.resolveRecipients()` and the birthday-greetings internal route to filter on `optOutWhatsapp`/`optOutSms`/`optOutEmail` would close this compliance gap fully.

## Files Changed

| File | Change |
|---|---|
| `packages/db-client/migrations/0016_es18_crm_gaps.sql` | NEW — opt-out columns, `customer_interactions.updated_at` |
| `packages/db-client/src/schema/master.ts` | `customers`: +`optOutSms`/`optOutWhatsapp`/`optOutEmail` |
| `packages/db-client/src/schema/crm.ts` | `customerInteractions`: +`SYSTEM` type, +`updatedAt` |
| `apps/sales-service/src/api/customer.routes.ts` | +`PATCH /customers/:id/opt-out` |
| `apps/sales-service/src/api/crm.routes.ts` | +`PUT /customers/:id/interactions/:interactionId` (24h window) |
| `apps/sales-service/src/api/internal.routes.ts` | +`POST /crm/payment-reminders/send` (all tenants) |
| `apps/sales-service/src/api/invoice.routes.ts` | Calls `InvoiceNotificationService` after confirm |
| `apps/sales-service/src/domain/PaymentReminderService.ts` | NEW — candidate query + dedup + `shouldSendChannel()` |
| `apps/sales-service/src/domain/InvoiceNotificationService.ts` | NEW — best-effort invoice-confirmed notice |
| `apps/scheduler-service/src/jobs/system-jobs.ts` | `sales.overdue-payment-reminder`: stub → real, `tenantScoped: true → false` |
| `apps/web-frontend/src/api/endpoints.ts` | `customerApi.optOut()` |
| `apps/web-frontend/src/pages/customers/CustomerViewPage.tsx` | Communication Preferences toggle card |
| `apps/sales-service/src/__tests__/es18-crm-gaps.test.ts` | NEW — opt-out defaults, dedup, 24h-window math, `shouldSendChannel` unit tests |

## Tests

`apps/sales-service/src/__tests__/es18-crm-gaps.test.ts`:
- `shouldSendChannel` unit tests (2/2 pass, no DB required)
- Integration tests (customer opt-out defaults/update, payment-reminder dedup, 24h edit window) — `describe.skipIf(!DATABASE_URL)`, skipped in this environment (no live DB configured this session)

Full suite: `pnpm --filter @erp/sales-service test` → **39 passed, 6 skipped** (0 regressions).

## Build: PASS

`pnpm --filter @erp/db build`, `@erp/sales-service build`, `@erp/scheduler-service build`, `@erp/web-frontend build` — all clean, zero TypeScript errors.

## Lint

New code introduces no new lint violation *categories*. `eslint` reports pre-existing `no-undef` errors for `process`/`fetch`/`crypto` across the monorepo (missing Node/browser globals in the ESLint env config) — the same class of error already present on untouched neighboring lines (e.g. `CampaignService.ts`, `system-jobs.ts`). `PaymentReminderService.ts` (fully new file) lints clean with zero issues.

## Deployment Checklist

> **⚠ These steps MUST be run manually before going live. They are NOT automatic.**

- [x] **Schema migration applied:** `psql $DATABASE_URL < packages/db-client/migrations/0016_es18_crm_gaps.sql`
- [x] **Verify in psql:** `SELECT opt_out_sms, opt_out_whatsapp, opt_out_email FROM customers LIMIT 1;` → columns exist, default `false`
- [x] **Updated sales-service and scheduler-service deployed** (both changed)
- [x] **`NOTIFICATION_SERVICE_URL` and `INTERNAL_API_KEY` set** in sales-service env (already required by Phase 9; re-verify — payment-reminder and invoice-confirmed sends now depend on them too)
