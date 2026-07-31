# Notification Module — Production Readiness Audit (2026-07-25)

Scope: `apps/notification-service` (templates, delivery channels, preferences, in-app
notifications) + `apps/web-frontend/src/pages/settings` (NotificationTemplates*,
NotificationPreferences). Fresh ground-up audit; all claims below were verified live against
the running stack (gateway :3000, notification-service :3014, Postgres, Redis/BullMQ, Mailhog)
unless explicitly marked as code-review-only. Prior audit claims in ERP-PLANNING/ were treated
as unverified leads, not truth — several turned out to be stale or incomplete.

## Summary

The channel-delivery engine itself (templates → Handlebars render → BullMQ delivery queue →
provider adapter → notification_log → outbox event) is real, well-built, and works — verified
with real emails landing in Mailhog and real in-app notifications appearing/counting. However,
two platform-wide defects make the module unsafe to call "production ready":

1. **Every tenant provisioned since 2026-07-17 has zero notification templates** — password
   reset, welcome email, CRM birthday greetings and HR alteration notices are all silently
   broken for 15+ tenants (confirmed for a tenant created live during this audit), due to a
   self-contradictory Zod schema in the four `seed-*` template-bootstrap endpoints.
2. **The Notification Preferences page is functionally inert for every category it lists.**
   All 8 categories on that page are delivered via `sendRaw()`/`send-raw-internal`, and
   `NotificationEngine.sendRaw()` never reads `notification_preferences` at all. A user can
   toggle a channel off, have it save successfully, and keep receiving that exact notification
   forever. Live-reproduced with a real email landing in Mailhog after opting out.

The SendGrid-vs-Mailhog question from prior audits is resolved: notification-service's own
`EmailChannelProvider` **does** have a real SMTP/Mailhog fallback today (not hardcoded to
SendGrid) — this must have been fixed after the 2026-07-16 finding. It's the same path that
delivered the password-reset email observed in the Auth module audit.

## What works (verified live)

- **SMTP/Mailhog fallback in notification-service itself** — `apps/notification-service/src/domain/channels/EmailChannelProvider.ts:34-43`: if `SENDGRID_API_KEY` doesn't start with `SG.` (dev default is `test_key`), it builds a `nodemailer` transport against `SMTP_HOST`/`SMTP_PORT` (`localhost:1025`, Mailhog's SMTP port) instead of calling the real SendGrid API. Confirmed by triggering `POST /api/auth/auth/forgot-password` for `owner@qa-e2e.local` — auth-service calls notification-service's `/notifications/send-internal` (`apps/auth-service/src/routes/forgot-password.ts:22-30`), which rendered the real `PASSWORD_RESET_REQUESTED` template, queued it, and delivered it. Real Mailhog message landed (Subject "Reset your password", From `noreply@erp.local`), and `notification_log` row **id 1099** shows `status=SENT`, `external_message_id=<886f7561-...@erp.local>` matching the Mailhog Message-ID exactly.
- **Templated send + preferences opt-out/opt-in, full round trip** — created a scratch template `QA_AUDIT_PREF_TEST` (id 56), set `emailEnabled:false` via `POST /notifications/preferences`, sent via `POST /notifications/send` → result `SKIPPED, logId:0`, no row inserted, no email. Re-enabled the preference, sent again → `QUEUED`, log **id 1100**, `status=SENT`, real email in Mailhog. This proves preferences ARE honored — but only on the templated `send()` path (see Critical finding #2 below for why this doesn't extend to real production traffic).
- **In-app notifications end-to-end** — sent `ALTERATION_ASSIGNED` (real seeded HR template, id 15) as `IN_APP` to a real user; `unread-count` went 0→1, `GET /notifications` listed it (log **id 1101**), `POST /notifications/:id/read` set `readAt`.
- **IDOR protection on mark-as-read** — a different user (STAFF, userId 28) called `POST /notifications/1102/read` for a notification belonging to userId 2; the DB row's `read_at` stayed `NULL` (the route's WHERE clause correctly scopes by `recipientUserId`, not just `tenantId` — this was a documented fix from the 2026-07-23 audit and it holds).
- **RBAC on template management** — `staff@qa-e2e.local` (no `NOTIFICATION_CONFIG`) got `403` on both `GET /notifications/templates` and `POST /notifications/templates`; `owner` (has it) succeeded. Frontend's `PERMISSIONS.NOTIFICATION_CONFIG` gate in `App.tsx`/`navigation.ts` matches the backend guard — no dead-permission-constant mismatch here.
- **System templates are protected** — `PUT`/`DELETE` on `isSystem:true` templates (password reset, welcome email, etc.) is rejected with `SYSTEM_TEMPLATE_LOCKED` (code-reviewed, `template.routes.ts:139-147, 179-183`).
- **Multi-tenant isolation** — every template/preference/log query is scoped by `tenantId` (code-reviewed across `notification.routes.ts` and `template.routes.ts`); live check of `notification_templates` grouped by `tenant_id` confirms each tenant only ever sees its own rows, and `GET /notifications/templates` as tenant-2 owner returned exactly tenant 2's 6 rows.
- **SMS channel is a real integration, not a stub** — `SmsChannelProvider` really calls `https://api.msg91.com/api/v5/flow/`. Live-fired an SMS (after disabling quiet-hours override — see below) and it reached MSG91's real API (200 `{"type":"success"}` even with the dev `test_key`), log **id 1103** went `SENT`. Actual phone delivery is unverifiable without a real MSG91 account, but the code path is genuine, not mocked.
- **Quiet hours** — correctly skipped an SMS send at the live wall-clock time (05:0x IST, inside the default 22:00–08:00 window) with `status: SKIPPED`; explicitly disabling `quietHoursEnabled` on the preference row let it through.
- **Tests**: `apps/notification-service/src/__tests__` — 11 files, **81 passed, 3 skipped, 0 failed** (`pnpm`/`vitest run`, no filter needed — ran clean standalone, not one of the flaky parallel-batch cases from other modules).

## Critical findings

### C1 — Every tenant created since 2026-07-17 has zero notification templates (welcome/password-reset/CRM/HR all silently dead)

- **Root cause**: `apps/notification-service/src/api/notification.routes.ts` lines 215, 262, 304, 344 — all four template-seed endpoints (`seed-crm`, `seed-hr`, `seed-auth`, `seed-tenant`) share the schema `createdBy: z.number().int().positive().default(0)`. In Zod, `.default()` re-validates the substituted value against the inner schema, and `0` fails `.positive()` — so **every call that omits `createdBy`** (exactly how `TenantProvisioner.sendWelcomeEmail()` calls all four, `apps/tenant-service/src/domain/TenantProvisioner.ts:457-468`) gets back `400 VALIDATION_ERROR {"message":"Number must be greater than 0"}`.
- **Why it's invisible**: `TenantProvisioner` calls these with a plain `fetch(...).catch(err => logger.warn(...))` — `fetch` does not reject on a 4xx/5xx response, so the `.catch` never fires. The subsequent `send-internal` call for `WELCOME_EMAIL` then finds no template row and `NotificationEngine.send()` returns `SKIPPED` (not an error) — so `res.ok` is `true` there too. The provisioning API response itself reports `"SEND_WELCOME_EMAIL":{"done":true}` — a **false positive**.
- **Live proof**: provisioned a brand-new real tenant during this audit via `POST /api/tenant/admin/tenants` (**tenant id 94**, "QA Notif Audit Tenant 1784935701", admin `qa-notif-audit-1784935701@example.com`). Provisioning response claimed `SEND_WELCOME_EMAIL: done`. Checked: `notification_templates` for tenant 94 = **0 rows**, `notification_log` for tenant 94 = **0 rows**, Mailhog search for that address = **0 messages**. Then called `POST /api/auth/auth/forgot-password` for that same new tenant's own admin — again 0 log rows, 0 Mailhog messages (silently `SKIPPED` — no `PASSWORD_RESET_REQUESTED` template exists for tenant 94 either).
- **Blast radius**: queried all 28 tenants in the DB — every tenant created **on or after 2026-07-17** (ids 20, 25, 26, 27, 34, 35, 38-43, 89, 90, 92, 93, 94 — 16 tenants) has **0** notification templates. Only tenants 1, 2, 5-13 (created 2026-07-12/13, before migration `0069_notification_templates_backfill.sql` backfilled them) have templates. That migration deliberately only backfilled pre-existing tenants and did not touch this endpoint bug, so it has been live in production-equivalent code for over a week with nothing to catch it (no test exercises any of the four seed endpoints).
- **Severity**: Critical. **Business impact**: no tenant onboarded in the last week+ can receive a welcome email, and — much worse — **no user in any of those tenants can complete a password reset via email**, since the same bug means `PASSWORD_RESET_REQUESTED` is never seeded either. This is a account-recovery-breaking bug for every recently-provisioned tenant.
- **Fix shape** (not applied — audit only): change `createdBy: z.number().int().positive().default(0)` to `z.number().int().min(0).default(0)` (or `.nonnegative()`) in all 4 places, and/or have the provisioning caller check `res.ok` and log loudly (not just warn) on failure so this class of bug surfaces next time.

### C2 — Notification Preferences page is inert: 100% of its 8 categories bypass the preference check entirely

- **Root cause**: `NotificationEngine.sendRaw()` (`apps/notification-service/src/domain/NotificationEngine.ts:266-325`) never queries `notificationPreferences` — only the templated `NotificationEngine.send()` path does (lines 126-151). Every production caller of scheduler-driven alerts uses `POST /notifications/send-raw-internal`, confirmed by grep of `apps/scheduler-service/src/jobs/system-jobs.ts` (5 call sites, covering `WORKFLOW_APPROVAL_REMINDER`, `DR_DRILL_REMINDER`, `CHAOS_DRILL_REMINDER`, `REORDER_REPORT`, `JOB_WORK_OVERDUE_ALERT`, and by the same pattern `PO_DELIVERY_REMINDER`/`PENDING_GRN_ALERT`/`PDC_CLEARING_ALERT`/`GSTR3B_FILING_REMINDER`/`EWAY_BILL_EXPIRY_ALERT`).
- `apps/web-frontend/src/pages/settings/NotificationPreferencesPage.tsx:13-54` curates its entire category list from exactly these scheduler alert types — i.e. **every single category the UI exposes** is one that the backend cannot actually gate.
- **Live proof**: as `owner@qa-e2e.local`, called the real preferences endpoint (the one the Settings page itself calls) to opt out of email for `WORKFLOW_APPROVAL_REMINDER`. Then made the exact same `send-raw-internal` call scheduler-service makes for that event type. Result: `status: SENT`, `notification_log` **id 1104**, and a real email ("QA Audit: Approval Reminder") landed in Mailhog — despite the opt-out.
- **Severity**: Critical. **Business impact**: the only user-facing notification opt-out mechanism in the product does not work for anything it claims to control. Users cannot silence any of these alert emails/SMS through the supported UI; this is both a broken-feature bug and (depending on jurisdiction) a consent/compliance concern for unsolicited notifications.
- Note: `INVOICE_CONFIRMED`, `PAYMENT_RECEIVED`, `QUOTATION_SENT` (customer-facing, sales-service) also go via `sendRaw`, but those are intentionally not preference-gated per the frontend's own comment ("customer-facing sends... go directly to the customer's phone/email, not through a staff user's notification_preferences row") — that part is a deliberate, reasonable design choice, not a bug. The bug is specifically that the _internal-staff_ alert categories the Preferences page exists for are wired to the same ungated path.

## High-severity findings

### H1 — Unread-notification bell count never decreases; it's a lifetime-sent counter, not an unread counter

- `NotificationEngine.getUnreadCount()` (`apps/notification-service/src/domain/NotificationEngine.ts:397-411`) filters only on `tenantId`, `recipientUserId`, `channel='IN_APP'`, `status='SENT'` — **it never checks `readAt IS NULL`**. `GET /notifications/:id/read` correctly sets `read_at` in the DB, but the count endpoint (and the SSE `/notifications/stream` heartbeat, which calls the same method) ignores it.
- **Live proof**: sent 2 in-app notifications (log ids 1101, 1102) to `owner`, unread-count reported `2`; marked both read (confirmed `read_at` populated in DB for both); unread-count **still reported `2`** afterward.
- **Impact**: the notification bell badge in the UI will only ever grow, never shrink — after using the app for any length of time the badge becomes permanently meaningless (shows a large stale number regardless of actual unread state).

## Medium-severity findings

### M1 — `POST /notifications/preferences` does a full overwrite, not a partial update, despite an all-optional schema

- `PreferencesSchema` (`notification.routes.ts:80-87`) makes every channel field optional, but the route body (lines 507-534) applies `?? <hardcoded default>` to every field and writes all of them on every call (both insert and `onConflictDoUpdate`). Any caller that sends a true partial payload (e.g. `{eventType, quietHoursEnabled:false}` only) silently resets every other channel toggle for that event type back to its hardcoded default.
- **Live proof**: created a fresh preference row via `{eventType:'QA_AUDIT_WA_TEST', quietHoursEnabled:false}` only — the resulting row set `whatsappEnabled:false` (the hardcoded default) even though I never mentioned that field.
- **Mitigated in practice today**: `NotificationPreferencesPage.tsx`'s `toggle()` (line 98-100) always spreads the full current preference object and sends the complete set, so the shipped UI does not currently trigger this. Still a real API-contract footgun for any other/future caller (mobile app, integration, a different admin script) — the optional schema actively invites a partial call that will silently corrupt other settings.

### M2 — `/notifications/:id/read` returns 200 "Marked as read" even when the target row doesn't match (no-op response looks like success)

- The route (`notification.routes.ts:405-430`) never checks the DB update's affected-row count. A cross-user call (correctly) updates zero rows due to the `recipientUserId` scoping (good — not an IDOR), but the response is indistinguishable from a real success. Minor UX/API-honesty gap, not a security issue (verified separately as IDOR-safe above).

## SendGrid vs. Mailhog — resolved

**notification-service itself now has a real SMTP/Mailhog dev fallback**, contradicting the
2026-07-16 finding that it was hardcoded to SendGrid with no fallback. `EmailChannelProvider`
picks nodemailer→SMTP whenever the configured `SENDGRID_API_KEY` doesn't start with `SG.`
(the dev-default `test_key` doesn't), pointed at `SMTP_HOST=localhost`/`SMTP_PORT=1025`
(Mailhog). This was confirmed by an actual live send through notification-service's own
`/notifications/send-internal` endpoint — not inferred from another service's behavior. So for
the earlier open question ("did Auth/CRM's observed Mailhog emails bypass notification-service
entirely, or does notification-service support SMTP now") — **the answer is: notification-service
supports it directly**, and it is the one that rendered and delivered the password-reset email.
This must have been fixed sometime between 2026-07-16 and now; there's no dated comment pinning
exactly when, but the code is unambiguous and the live test proves it works today.

## SMS/Push/WhatsApp — real or stub?

- **SMS (MSG91)**: real integration, not a stub — code makes a genuine HTTPS call to
  `api.msg91.com`; live-fired and got a real 200 response from MSG91's actual API even with a
  placeholder auth key (MSG91 apparently doesn't reject malformed/test keys synchronously at
  this endpoint) and the platform stored `SENT`. Whether an SMS is truly delivered to a phone is
  unverifiable without a paid MSG91 account/real key, but the code path itself is real.
- **WhatsApp (Meta Cloud API)**: code is a real integration (`graph.facebook.com/v18.0/.../messages`),
  not exercised end-to-end in this session — `WHATSAPP_ACCESS_TOKEN` is unset in `.env`
  (empty string default), and no live send was attempted against Meta's real API (would just
  401). Code-reviewed only for this channel: implementation looks structurally sound
  (text vs. media message shapes), but is unverified live.
- **"Push" (mobile push notification)**: **does not exist** as a channel. The four channels are
  `SMS`, `EMAIL`, `WHATSAPP`, `IN_APP` only — there is no push-notification provider anywhere
  in `ChannelRegistry`/`ChannelName`. If the product roadmap expects native mobile push, it has
  not been built.

## Platform-wide silent-Kafka-consumer-failure pattern — does notification-service share it?

**No.** `apps/notification-service/src/main.ts` has **no Kafka consumer at all** — the service
never imports/uses `PlatformEventConsumer`. All notification triggers across the platform are
plain HTTP calls (`fetch(...send-internal/send-raw-internal...)`) made directly from the
triggering service's request handlers or scheduler-service's cron jobs, not from inside any
Kafka event-consumer dispatch loop. Cross-checked the 5 services that DO use
`PlatformEventConsumer` (accounting, gst, sales, scheduler, search) — none of their Kafka
dispatch handlers call notification-service. So the specific "same-transaction rollback erases
the failure trace" risk does not apply here.

That said, the module has its own, distinct silent-failure pattern that this audit proved is a
real, live problem: essentially every caller treats notification delivery as fire-and-forget
(`fetch(...).catch(err => logger.warn(...))`, never checking `res.ok`), which is precisely how
finding C1 above went undetected for over a week in a running environment.

## Untested/unknown areas

- WhatsApp channel not live-fired (no real Meta access token available in this environment).
- Delivery-status webhooks (`webhook.routes.ts` — SendGrid/MSG91/Meta callbacks updating
  `notification_log` post-send) were code-reviewed only (signature verification logic present
  and unit-tested per `webhookVerification.test.ts`), not live-triggered from a real provider
  callback.
- CRM campaign send path (`CampaignService` → `send-raw-internal`) was not re-triggered live
  this session; a prior session's Mailhog history shows it working previously ("Webhook trigger
  test CRM Audit Test Customer..." messages present), treated as corroborating but not
  re-verified fresh here.
- Retry/dead-letter behavior (`retryFailed`/`retrySingle`, `MAX_TOTAL_ATTEMPTS`) was
  code-reviewed, not live-exercised (would require forcing real provider failures).
- SSE `/notifications/stream` was code-reviewed (inherits the H1 unread-count bug), not opened
  from a real browser `EventSource` in this session.

## Test data created this session (tenant 2 unless noted)

- Custom templates: id 56 `QA_AUDIT_PREF_TEST` (EMAIL), id 57 `QA_AUDIT_SMS_TEST` (SMS), plus
  one `QA_AUDIT_WA_TEST` (WHATSAPP) — all tenant-2, non-system, safe to delete.
- Preference rows for `owner@qa-e2e.local` (userId 2) on eventTypes `QA_AUDIT_PREF_TEST`,
  `QA_AUDIT_SMS_TEST`, `QA_AUDIT_WA_TEST`, `WORKFLOW_APPROVAL_REMINDER` (the last one now has
  `emailEnabled:false` saved — real, harmless since nothing in prod actually reads it, per C2).
- `notification_log` rows: 1099-1104 (real, harmless).
- **New tenant 94** ("QA Notif Audit Tenant 1784935701", admin `qa-notif-audit-1784935701@example.com`
  / `QaNotifAudit@2026`) — created live to prove C1. Left in place as evidence; has no
  notification templates by design of the bug.

## Readiness score: 48/100

Justification: the delivery mechanics (queueing, retries, Handlebars rendering, multi-channel
adapters, RBAC, tenant isolation, IDOR protection) are solid engineering and all passed live
verification — that alone would be a 75-80. But two Critical, live-confirmed defects sit
directly on the module's core promises: (1) new tenants — the majority of tenants in this
database — cannot receive password-reset or welcome emails at all, a security/account-recovery
blocker, not a cosmetic one; and (2) the entire user-facing preferences feature does not
function for anything it claims to control, which is either a trust/compliance problem or a
"why does this page exist" problem depending on how it's framed to users. Both are
straightforward, contained fixes (a one-line schema change; wiring a preferences check into
`sendRaw`), but until fixed this module cannot be called production-ready.
