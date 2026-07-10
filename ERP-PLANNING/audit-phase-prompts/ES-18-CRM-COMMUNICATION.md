# ES-18 — CRM & Customer Communication
## STATUS: ✅ COMPLETED 
## Sprint: 4 | Effort: 4–5 days | Risk: Low
## Depends on: ES-07 (RBAC), ES-08 (sales workflow)
## Unlocks: ES-20

---

## YOUR ROLE

You are the **Principal Backend + Frontend Engineer** on the NEXORAA Multi-Tenant Cloth Retail ERP.
Your mission: implement CRM features — customer interaction logging, WhatsApp/SMS/email notification triggers, payment reminder automation, and opt-out management.

---

## ═══════════════════════════════════════════
## PRE-FLIGHT CHECKLIST
## ═══════════════════════════════════════════

- [ ] Read `ERP-PLANNING/TECH_AUDIT.md`
- [ ] Read `ERP-PLANNING/CODING_STANDARDS.md`
- [ ] Read `ERP-PLANNING/phase-completions/ES-07_COMPLETION.md`
- [ ] Read `ERP-PLANNING/phase-completions/ES-08_COMPLETION.md`
- [ ] Read `apps/sales-service/src/domain/CustomerService.ts` — full file
- [ ] Read `packages/db-client/src/schema/sales.ts` — customers table columns
- [ ] Check if any `notification-service` or `communication-service` exists
- [ ] Check if `packages/platform-sdk` has any email/SMS client
- [ ] Check `.env.example` for SMTP / WhatsApp API credentials
- [ ] Look for existing `customer_interactions` table or similar
- [ ] Run `pnpm build` — confirm clean baseline

---

## ═══════════════════════════════════════════
## COMPLETED PHASES
## ═══════════════════════════════════════════

| Phase | Status | Key Changes Relevant to You |
|-------|--------|----------------------------|
| ES-07 ✅ | RBAC | EXPORT_CUSTOMER_DATA permission defined |
| ES-08 ✅ | Sales | Payment tracking, overdue invoice logic |

---

## ═══════════════════════════════════════════
## PROJECT CONTEXT
## ═══════════════════════════════════════════

### Tech Stack
Node.js 20 + TypeScript 5 strict | Fastify 4 | PostgreSQL 16 + Drizzle ORM | BullMQ + Redis 7 |
Nodemailer (email) | React 18 + Vite 5 + Tailwind v4 | React Query v5 | Vitest

### Multi-Tenant Rules
- Every Drizzle query: `.where(eq(table.tenantId, ctx.tenantId))`
- Tenant ID: ALWAYS from `request.auth.tenantId`
- Notification credentials (SMTP, WhatsApp API) are per-tenant configuration

### Communication Rules
- **Opt-out:** Customer can opt out of each channel: `opt_out_sms`, `opt_out_whatsapp`, `opt_out_email`
- **NEVER send** if opted out — check before every notification
- **WhatsApp:** Use WhatsApp Business Cloud API (Meta) or Twilio WhatsApp
- **SMS:** Twilio or Indian DLT-registered SMS provider
- **Email:** SMTP via nodemailer (SMTP credentials from tenant config)
- **DLT Registration:** All promotional SMS in India must be DLT-registered — this is a configuration concern, not code concern

### BullMQ Queue Pattern
```typescript
// Queue: 'notifications'
// Job types: 'payment_reminder', 'invoice_sent', 'order_confirmed', 'invoice_overdue'
// Process jobs in notification-service (or a new notifications queue worker)

const notificationQueue = new Queue('notifications', { connection: redis });

// Enqueue:
await notificationQueue.add('payment_reminder', {
  tenantId, customerId, invoiceId, amount, dueDate
}, {
  attempts: 3,
  backoff: { type: 'exponential', delay: 60000 },
  removeOnComplete: 100,
});
```

### Auth Pattern
```typescript
fastify.get('/customers/:id/interactions', {
  preHandler: [authenticate, requirePermission(PERMISSIONS.CUSTOMER_VIEW)],
}, handler)
```

### Frontend Design System
- `ERPDataGrid` for interaction logs
- `ERPFormField` for communication forms
- `useToast()` for send confirmation
- Timeline component for customer interaction history

### Coding Standards
- TypeScript strict — no `any`
- Never log PII (customer name, phone, email) in info/debug logs — only in error logs with masking
- `/* global process */` at top of files using `process.env`

---

## ═══════════════════════════════════════════
## OBJECTIVE
## ═══════════════════════════════════════════

1. Customer interaction log (call notes, meeting notes, email log)
2. Automated payment reminders (overdue invoice notifications)
3. Invoice-sent notifications (WhatsApp/email/SMS on invoice confirmation)
4. Order confirmation notifications
5. Customer opt-out management
6. Customer 360 view page

---

## ═══════════════════════════════════════════
## SCOPE
## ═══════════════════════════════════════════

### IN SCOPE

**Step 1 — Schema**

`packages/db-client/src/schema/sales.ts`:

Add to `customers` table (if missing):
```sql
opt_out_sms BOOLEAN NOT NULL DEFAULT false
opt_out_whatsapp BOOLEAN NOT NULL DEFAULT false
opt_out_email BOOLEAN NOT NULL DEFAULT false
mobile VARCHAR(15)
whatsapp_number VARCHAR(15)
email VARCHAR(255)
```

New table `customer_interactions`:
```sql
id UUID PRIMARY KEY DEFAULT gen_random_uuid()
tenant_id UUID NOT NULL
customer_id UUID NOT NULL REFERENCES customers(id)
interaction_type VARCHAR(30) NOT NULL  -- 'CALL' | 'EMAIL' | 'WHATSAPP' | 'MEETING' | 'NOTE' | 'SYSTEM'
subject VARCHAR(200)
notes TEXT
outcome VARCHAR(50)  -- 'INTERESTED' | 'NOT_INTERESTED' | 'FOLLOW_UP' | 'CLOSED'
follow_up_date DATE
created_by UUID NOT NULL
created_at TIMESTAMPTZ DEFAULT NOW()
INDEX: (tenant_id, customer_id, created_at DESC)
```

Migration: `000X_es18_crm_interactions.sql`

**Step 2 — Customer Interaction API**

`apps/sales-service/src/api/interaction.routes.ts` (new file):

```
GET  /api/v1/sales/customers/:id/interactions  — list interactions (paginated)
POST /api/v1/sales/customers/:id/interactions  — log new interaction
PUT  /api/v1/sales/customers/:id/interactions/:interactionId  — edit (within 24h only)
```

All routes: `authenticate` + `requirePermission(PERMISSIONS.CUSTOMER_VIEW)`
POST: `requirePermission(PERMISSIONS.CUSTOMER_UPDATE)`

**Step 3 — Notification Service (or worker)**

`apps/notification-service/` (new service if not exists, or add queue worker to existing service):

`src/workers/notification.worker.ts`:

Process BullMQ jobs from `notifications` queue:
```typescript
worker.on('payment_reminder', async (job) => {
  const { tenantId, customerId, invoiceId, amount, dueDate } = job.data;
  
  // Load customer's opt-out preferences + contact details
  const customer = await loadCustomer(customerId, tenantId);
  
  if (!customer.optOutWhatsapp && customer.whatsappNumber) {
    await sendWhatsApp(customer.whatsappNumber, buildPaymentReminderTemplate(amount, dueDate));
  }
  if (!customer.optOutEmail && customer.email) {
    await sendEmail(customer.email, 'Payment Reminder', buildPaymentReminderEmail(amount, dueDate));
  }
  // SMS if opted in
  
  // Log interaction
  await logInteraction(customerId, tenantId, 'SYSTEM', 'Payment reminder sent', { channel: ['whatsapp', 'email'] });
});
```

**Step 4 — Payment Reminder Automation**

`apps/report-service/src/domain/OverdueInvoiceChecker.ts` (new file, or add to existing):

Cron: daily at 9 AM:
```typescript
// Find all overdue invoices (due_date < today AND status NOT IN ('PAID', 'CANCELLED'))
// Group by customer
// For each customer: enqueue 'payment_reminder' BullMQ job
// Do NOT resend if already sent today (check customer_interactions for today's SYSTEM interaction)
```

**Step 5 — Invoice sent notification**

`apps/sales-service/src/consumers/` (or in the Kafka event handler for INVOICE_CONFIRMED):

On `INVOICE_CONFIRMED`:
- Enqueue BullMQ job `invoice_sent` with invoice details
- Worker sends: WhatsApp/email to customer with invoice number, amount, due date
- Do NOT send if customer opted out of all channels

**Step 6 — Customer opt-out management**

Route: `PATCH /api/v1/sales/customers/:id/opt-out`
Body: `{ optOutSms: true, optOutWhatsapp: false, optOutEmail: false }`
Guard: `authenticate` + `requirePermission(PERMISSIONS.CUSTOMER_UPDATE)`

Frontend: opt-out toggles on customer detail page

**Step 7 — Customer 360 View**

`apps/web-frontend/src/pages/sales/Customer360Page.tsx` (new file):

Sections:
1. Customer details (name, GSTIN, address, contact)
2. Outstanding balance + credit limit usage (progress bar)
3. Recent invoices (last 5, with status chips)
4. Payment history (last 5)
5. Interaction timeline (ERPDataGrid with icon per interaction type)
6. "Log Interaction" button → slide-in form
7. Communication preferences (opt-out toggles)

Route: `/sales/customers/:id/360`
Link from customer list page's "View" action.

**Add to `.env.example`:**
```
SMTP_HOST=
SMTP_PORT=587
SMTP_USER=
SMTP_PASS=
SMTP_FROM=noreply@nexoraa.com
WHATSAPP_API_URL=
WHATSAPP_API_TOKEN=
WHATSAPP_PHONE_NUMBER_ID=
SMS_API_URL=
SMS_API_KEY=
```

### OUT OF SCOPE
- WhatsApp catalog integration
- CRM pipeline / deal management
- Live chat widget
- Social media integration
- Marketing campaign automation

---

## ═══════════════════════════════════════════
## TESTING REQUIREMENTS
## ═══════════════════════════════════════════

`apps/sales-service/src/__tests__/crm.test.ts`:
1. Log interaction for customer → interaction in list
2. Edit interaction after 24h → error (read-only after 24h)
3. Update customer opt-out → `opt_out_whatsapp = true`
4. Overdue invoice + opt-out WhatsApp → BullMQ job NOT enqueued for WhatsApp
5. Overdue invoice + not opted out → BullMQ job enqueued
6. Customer 360 API: returns invoices, payments, and interactions

---

## ═══════════════════════════════════════════
## BUILD VERIFICATION
## ═══════════════════════════════════════════

```bash
pnpm --filter @erp/sales-service build
pnpm --filter @erp/sales-service type-check
pnpm --filter @erp/web-frontend build
pnpm lint
pnpm test --filter @erp/sales-service
```

---

## ═══════════════════════════════════════════
## VERIFICATION CHECKLIST
## ═══════════════════════════════════════════

- [ ] Log interaction via API → appears in customer interaction list
- [ ] Customer opt-out respected: opted-out customer gets no notification job enqueued
- [ ] Overdue invoice checker enqueues payment reminder jobs
- [ ] `Customer360Page.tsx` renders all 7 sections
- [ ] Interaction timeline shows icons per type
- [ ] All 6 CRM tests pass
- [ ] `pnpm lint` passes

---

## ═══════════════════════════════════════════
## REGRESSION CHECKLIST
## ═══════════════════════════════════════════

- [ ] Customer create/edit still works
- [ ] Invoice confirmation flow still works (ES-08)
- [ ] EXPORT_CUSTOMER_DATA permission from ES-07 still wired

---

## ═══════════════════════════════════════════
## DEFINITION OF DONE
## ═══════════════════════════════════════════

- [ ] Customer interaction log working
- [ ] Payment reminder automation enqueuing jobs
- [ ] Opt-out respected for all notification channels
- [ ] Customer 360 page renders
- [ ] 6 tests pass
- [ ] Completion report saved at `ERP-PLANNING/phase-completions/ES-18_COMPLETION.md`

---

## ═══════════════════════════════════════════
## COMPLETION REPORT TEMPLATE
## ═══════════════════════════════════════════

**Save as:** `ERP-PLANNING/phase-completions/ES-18_COMPLETION.md`

```markdown
# ES-18 Completion Report — CRM & Communication
**Date:** [YYYY-MM-DD]
**Status:** COMPLETE

## Communication Channels Implemented
- Email (nodemailer): [WORKING / STUB — needs SMTP config]
- WhatsApp: [WORKING / STUB — needs API token]
- SMS: [WORKING / STUB — needs API key]

## Automation
- Payment reminder cron: [IMPLEMENTED — runs daily at 9 AM]
- Invoice-sent notification: [IMPLEMENTED — on INVOICE_CONFIRMED Kafka event]

## Opt-Out Compliance
- Customer opt-out respected: [VERIFIED]

## Files Changed
[Table]

## Tests: 6/6 PASS | lint: PASS | build: PASS
```
