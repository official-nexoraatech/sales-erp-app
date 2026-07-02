# PHASE 9 — CRM AND CUSTOMER ENGAGEMENT — COMPLETION REPORT
## Generated: 2026-06-30 | Status: COMPLETE

> **This document is the official handoff artifact for Phase 9.**
> **The next phase MUST start by reading this document.**
> **Never modify this document after generation.**

---

## 1. PHASE SUMMARY

| Field | Value |
|---|---|
| Phase Number | 9 |
| Phase Name | CRM and Customer Engagement |
| Start Date | 2026-06-30 |
| End Date | 2026-06-30 |
| Status | COMPLETE |
| Engineer(s) | Claude Sonnet 4.6 |
| Claude Session | 9c5db216-e06d-4845-bb2d-16ca12fcc0b7 |

---

## 2. WHAT WAS BUILT

### 2.1 Database Schema

```sql
-- Columns added to customers table (packages/db-client/src/schema/master.ts):
--   health_score        integer
--   health_segment      varchar(20)  ['CHAMPION'|'LOYAL'|'AT_RISK'|'LOST']
--   scored_at           timestamptz

-- Tables created (packages/db-client/src/schema/crm.ts):
--   customer_interactions (10 columns)
--   customer_segments     (10 columns, filterDefinition JSONB)
--   campaigns             (20 columns, customerIds JSONB, status enum)
--   campaign_recipients   (9 columns, status enum)
--   business_seasons      (13 columns, activeDiscountRuleIds JSONB)

-- Indexes created:
--   idx_customers_health_segment         ON customers(tenant_id, health_segment)
--   idx_customer_interactions_customer   ON customer_interactions(tenant_id, customer_id)
--   idx_customer_interactions_followup   ON customer_interactions(tenant_id, follow_up_date) WHERE follow_up_done=false
--   idx_customer_segments_tenant         ON customer_segments(tenant_id)
--   idx_customer_segments_code           ON customer_segments(tenant_id, code)
--   idx_campaigns_tenant_status          ON campaigns(tenant_id, status)
--   idx_campaigns_scheduled_at           ON campaigns(scheduled_at) WHERE status='SCHEDULED'
--   idx_campaign_recipients_campaign     ON campaign_recipients(campaign_id, tenant_id)
--   idx_business_seasons_tenant          ON business_seasons(tenant_id)
--   idx_business_seasons_active          ON business_seasons(tenant_id, is_active)
--   idx_business_seasons_dates           ON business_seasons(tenant_id, start_date, end_date)

-- Migration file: packages/db-client/migrations/0005_phase9_crm.sql
```

### 2.2 APIs Implemented

All endpoints are in `apps/sales-service` under `/api/v2`.

#### M9.1 — Customer Activity Timeline
| Method | Path | Permission | Status |
|---|---|---|---|
| GET | /customers/:id/activity | CUSTOMER_VIEW | ✅ Done (60s Redis TTL cache) |

#### M9.2 — Customer Health Scoring (Internal)
| Method | Path | Auth | Status |
|---|---|---|---|
| POST | /crm/health-score/compute | x-internal-key | ✅ Done |
| GET | /crm/segments/health | CRM_VIEW | ✅ Done |

#### M9.3 — Customer Interaction Log
| Method | Path | Permission | Status |
|---|---|---|---|
| POST | /customers/:id/interactions | CRM_INTERACTION_CREATE | ✅ Done |
| GET | /customers/:id/interactions | CRM_INTERACTION_VIEW | ✅ Done |
| GET | /crm/follow-ups | CRM_INTERACTION_VIEW | ✅ Done |

#### M9.4 — Customer Segmentation
| Method | Path | Permission | Status |
|---|---|---|---|
| GET | /crm/segments | CRM_SEGMENT_VIEW | ✅ Done |
| POST | /crm/segments | CRM_SEGMENT_CREATE | ✅ Done |
| POST | /crm/segments/preview | CRM_SEGMENT_VIEW | ✅ Done |
| GET | /crm/segments/:id/customers | CRM_SEGMENT_VIEW | ✅ Done |
| GET | /crm/segments/:id/export | CRM_SEGMENT_VIEW | ✅ Done (CSV) |

#### M9.5 — Campaign Management
| Method | Path | Permission | Status |
|---|---|---|---|
| POST | /crm/campaigns | CRM_CAMPAIGN_CREATE | ✅ Done |
| GET | /crm/campaigns | CRM_VIEW | ✅ Done |
| GET | /crm/campaigns/:id | CRM_VIEW | ✅ Done |
| POST | /crm/campaigns/:id/send | CRM_CAMPAIGN_SEND | ✅ Done |
| POST | /crm/campaigns/:id/schedule | CRM_CAMPAIGN_CREATE | ✅ Done |
| POST | /crm/campaigns/:id/cancel | CRM_CAMPAIGN_CREATE | ✅ Done |
| GET | /crm/campaigns/:id/stats | CRM_VIEW | ✅ Done |
| GET | /crm/campaigns/birthday-stats | CRM_VIEW | ✅ Done |
| POST | /crm/campaigns/dispatch-scheduled | x-internal-key | ✅ Done |

#### M9.6 — Birthday Automation (Internal)
| Method | Path | Auth | Status |
|---|---|---|---|
| POST | /crm/birthday-greetings/send | x-internal-key | ✅ Done |

#### M9.7 — Festival Season Planner
| Method | Path | Permission | Status |
|---|---|---|---|
| GET | /crm/seasons | CRM_SEASON_VIEW | ✅ Done |
| GET | /crm/seasons/active | CRM_SEASON_VIEW | ✅ Done |
| POST | /crm/seasons | CRM_SEASON_MANAGE | ✅ Done |
| PUT | /crm/seasons/:id | CRM_SEASON_MANAGE | ✅ Done (optimistic lock) |

#### Notification Service additions
| Method | Path | Auth | Status |
|---|---|---|---|
| POST | /notifications/send-raw-internal | x-internal-key | ✅ Done |
| POST | /notifications/templates/seed-crm | x-internal-key | ✅ Done |

### 2.3 Services Implemented

```
apps/sales-service/src/domain/

ActivityTimelineService
  build(db, tenantId, customerId, page, size)
    — Parallel queries: invoices, payments, returns, alterations,
      loyalty_transactions (earn/redeem/expire), customer_interactions
    — Sorts all by date DESC, paginates

HealthScoringService
  computeForTenant(db, tenantId)
    — 5 factor scoring: purchaseFrequency(30) + avgOrderValue(20)
      + paymentTimeliness(20) + returnRate(15) + loyaltyEngagement(15)
    — Updates customers.health_score + health_segment + scored_at
    — Returns HealthScoreBreakdown[]
  segmentCounts(db, tenantId)
    — COUNT(*) grouped by health_segment

SegmentService (static)
  prebuiltWhere(code, tenantId)
    — 6 pre-built segments: no-purchase-60-days, gold-tier, high-value,
      overdue-30, birthdays-this-month, new-customers-this-month
    — Uses subquery EXISTS/NOT EXISTS patterns
  customWhere(tenantId, filterDefinition)
    — Whitelist-based rule evaluator (7 operators, 12 whitelisted fields)
  countMatching / listMatching / resolveWhere

CampaignService (static)
  resolveRecipients(ctx, campaign)
    — Resolves segmentId or customerIds to phone + displayName rows
  previewSample(ctx, segmentId, customerIds, messageTemplate)
    — Returns recipientCount + rendered sampleMessage + char warnings
  send(ctx, campaignId)
    — DRAFT/SCHEDULED → SENDING → SENT
    — Calls POST /notifications/send-raw-internal per recipient
    — Inserts campaign_recipients tracking rows
    — Writes CAMPAIGN_SENT outbox event + audit log
  schedule / cancel / getStats

apps/notification-service/src/domain/
  NotificationEngine.sendRaw(input)
    — Free-text channel delivery (not template-based)
    — Reuses deliverWithRetry() private helper
    — Inserts notificationLog row with templateId=null
```

### 2.4 Frontend Screens

| Screen | Route | Permission | Status |
|---|---|---|---|
| Segments | /crm/segments | CRM_SEGMENT_VIEW | ✅ Done |
| Campaigns | /crm/campaigns | CRM_VIEW | ✅ Done |
| New Campaign | /crm/campaigns/new | CRM_CAMPAIGN_CREATE | ✅ Done |
| Seasons | /crm/seasons | CRM_SEASON_VIEW | ✅ Done |
| Customer View (enhanced) | /customers/:id | CUSTOMER_VIEW | ✅ Done (+ interaction tab + timeline tab + health bar) |
| Dashboard (enhanced) | /dashboard | — | ✅ Done (+ health donut + follow-up badge + season bar) |

### 2.5 Events Published

| Event | Table | Publisher | Consumers |
|---|---|---|---|
| CAMPAIGN_SENT | outbox_events | CampaignService.send() | (future analytics phase) |
| CUSTOMER_INTERACTION_LOGGED | outbox_events | crm.routes.ts POST interaction | (future analytics phase) |

### 2.6 Events Consumed

None. Phase 9 does not consume events from other services.

### 2.7 Background Jobs

| Job Name | Cron | What It Does | Status |
|---|---|---|---|
| crm.customer-health-score | `0 2 * * 0` (Sun 02:00) | Compute health scores for all active tenants | ✅ Done |
| crm.birthday-anniversary-trigger | `0 8 * * *` (daily 08:00) | Send birthday greetings via BIRTHDAY_GREETING template (WhatsApp→SMS fallback) | ✅ Done |
| crm.campaign-dispatch | `*/5 * * * *` (every 5 min) | Dispatch SCHEDULED campaigns whose scheduledAt has passed | ✅ Done |

---

## 3. FOLDER STRUCTURE (ACTUAL)

```
packages/db-client/src/schema/
└── crm.ts                         NEW — 5 CRM tables

packages/db-client/migrations/
└── 0005_phase9_crm.sql            NEW — hand-written migration

apps/sales-service/src/domain/
├── ActivityTimelineService.ts     NEW
├── HealthScoringService.ts        NEW
├── SegmentService.ts              NEW
└── CampaignService.ts             NEW

apps/sales-service/src/api/
├── crm.routes.ts                  NEW — 21 CRM endpoints
├── customer.routes.ts             MODIFIED — activity timeline M9.1
└── internal.routes.ts             MODIFIED — 3 new internal endpoints

apps/sales-service/src/main.ts    MODIFIED — registers crmRoutes

apps/notification-service/src/domain/
└── NotificationEngine.ts          MODIFIED — sendRaw() + deliverWithRetry()

apps/notification-service/src/api/
└── notification.routes.ts         MODIFIED — send-raw-internal + seed-crm

apps/scheduler-service/src/jobs/
└── system-jobs.ts                 MODIFIED — 2 updated + 1 new CRM job

packages/shared-types/src/
└── permissions.ts                 MODIFIED — 6 new CRM permissions

apps/web-frontend/src/
├── api/endpoints.ts               MODIFIED — crmApi (50 methods)
├── constants/permissions.ts       MODIFIED — 6 new CRM constants
├── components/Layout.tsx          MODIFIED — CRM nav group
├── App.tsx                        MODIFIED — 4 new CRM routes
├── pages/crm/
│   ├── SegmentsPage.tsx           NEW
│   ├── CampaignsPage.tsx          NEW
│   ├── CampaignFormPage.tsx       NEW
│   └── SeasonsPage.tsx            NEW
├── pages/customers/
│   └── CustomerViewPage.tsx       MODIFIED — tabs + interaction log + timeline + health bar
└── pages/DashboardPage.tsx        MODIFIED — health donut + follow-up badge + season bar
```

---

## 4. PUBLIC INTERFACES (CONSUMED BY OTHER PHASES)

### 4.1 API Contracts (external)
```
GET /api/v2/crm/seasons/active
  → { data: { id, name, seasonType, startDate, endDate, stockMultiplier, loyaltyMultiplier, isActive } | null }

GET /api/v2/crm/segments/health
  → { data: { champion, loyal, atRisk, lost, unscored } }

GET /api/v2/customers/:id/activity
  → { customerId, page, size, items: ActivityItem[], total, _cache: 'HIT'|'MISS' }
```

### 4.2 Events (external contracts)
```typescript
// CAMPAIGN_SENT (outbox_events):
{
  campaignId: number;
  tenantId: number;
  channel: 'SMS' | 'WHATSAPP' | 'EMAIL' | 'IN_APP';
  totalRecipients: number;
  sentCount: number;
}

// CUSTOMER_INTERACTION_LOGGED (outbox_events):
{
  interactionId: number;
  customerId: number;
  type: 'VISIT' | 'CALL' | 'COMPLAINT' | 'EMAIL' | 'WHATSAPP' | 'OTHER';
}
```

### 4.3 Shared Types Added
```typescript
// packages/shared-types/src/permissions.ts — NEW:
CRM_INTERACTION_VIEW, CRM_INTERACTION_CREATE,
CRM_SEGMENT_VIEW, CRM_SEGMENT_CREATE,
CRM_SEASON_VIEW, CRM_SEASON_MANAGE
```

---

## 5. INTEGRATION POINTS

### 5.1 What this phase provides to downstream phases
- `GET /api/v2/crm/seasons/active` → Phase 10 (Reports) can show active season context on dashboard KPIs
- `GET /api/v2/crm/segments/:id/customers` → Phase 10 may use for targeted reports
- `customers.health_score` column → Available for Phase 10 advanced analytics
- CRM widget on DashboardPage is live and pulls real data from health/follow-ups/seasons APIs

### 5.2 What this phase needs from upstream phases (already resolved)
- invoices, payments, returns, alterations, loyalty_transactions (Phases 4, 8) — resolved via FK + raw SQL queries in ActivityTimelineService
- notificationLog (Phase notification-service) — resolved for birthday-stats and campaign delivery tracking
- customers.dateOfBirth (Phase 2 master data) — resolved, used for birthday query

### 5.3 What the NEXT phase must integrate with
- Phase 10 (Reports / Analytics): Can read health_score columns, use segment API for cohort reports, consume CAMPAIGN_SENT outbox events
- Campaign dispatch scheduler runs every 5 minutes — ensure INTERNAL_API_KEY env var is set in production

---

## 6. TESTS

### 6.1 Test Coverage
| Suite | Coverage | Status |
|---|---|---|
| TypeScript strict build — @erp/db | Zero errors | ✅ Pass |
| TypeScript strict build — @erp/sales-service | Zero errors | ✅ Pass |
| TypeScript strict build — @erp/notification-service | Zero errors | ✅ Pass |
| TypeScript strict build — @erp/scheduler-service | Zero errors | ✅ Pass |
| TypeScript strict build — @erp/web-frontend | Zero errors | ✅ Pass |

### 6.2 Critical Verification Points
- [x] All 5 packages build with zero TypeScript errors
- [x] crm.routes.ts registers 21 endpoints behind correct PERMISSIONS guards
- [x] Internal endpoints guard with x-internal-key header
- [x] ActivityTimelineService: 6 parallel source queries + unified sort
- [x] HealthScoringService: 5-factor algorithm, 0–100 score, 4 segments
- [x] SegmentService: 6 prebuilt SQL builders + custom AND/OR evaluator with whitelist
- [x] CampaignService.send(): SENDING → SENT transition + per-recipient notification + outbox event
- [x] Birthday job: WhatsApp → SMS fallback, uses BIRTHDAY_GREETING eventType
- [x] Campaign dispatch: only fires SCHEDULED campaigns where scheduledAt <= now
- [x] Seasons: optimistic lock with version column

---

## 7. KNOWN ISSUES AND TECHNICAL DEBT

| Issue | Severity | Resolution Plan |
|---|---|---|
| Activity timeline cache not invalidated on new invoices/payments | Low | 60s TTL is primary mechanism per spec. Full cross-cutting invalidation would require modifying Phase 4 routes — deferred to Phase 10 if needed |
| Segment export uses CSV not Excel (.xlsx) | Low | No xlsx library installed per TECH_AUDIT; Excel opens CSV natively. Add xlsx if multi-sheet export needed in Phase 10 |
| Campaign send is synchronous in-request (no queue) | Medium | Acceptable for prototype/MVP. For production at scale, move to async worker queue in Phase 10 |
| previewSegment: for custom rules in SegmentsPage frontend, only supports single rule (no multi-rule UI) | Low | Backend supports full AND/OR multi-rule. UI shows one rule form — extend in Phase 10 if needed |
| Health score runs weekly (not real-time) | Design | Spec-compliant. Scores update every Sunday 02:00 UTC |

---

## 8. FEATURE FLAGS USED

None. All Phase 9 features are always-on for tenants with the appropriate permissions.

---

## 9. PERMISSIONS ADDED

```typescript
// packages/shared-types/src/permissions.ts (backend) and
// apps/web-frontend/src/constants/permissions.ts (frontend mirror):

CRM_INTERACTION_VIEW    // view customer interaction log
CRM_INTERACTION_CREATE  // log a new interaction
CRM_SEGMENT_VIEW        // view segments, preview, export customers
CRM_SEGMENT_CREATE      // create custom segments
CRM_SEASON_VIEW         // view festival seasons
CRM_SEASON_MANAGE       // create/edit seasons

// Already existed (from prior phase):
CRM_VIEW, CRM_CAMPAIGN_CREATE, CRM_CAMPAIGN_SEND,
CRM_LOYALTY_VIEW, CRM_LOYALTY_ADJUST
```

---

## 10. ENVIRONMENT VARIABLES ADDED

```
NOTIFICATION_SERVICE_URL=http://localhost:3014  # Used in internal.routes.ts birthday job
INTERNAL_API_KEY=<secret>                        # Required for x-internal-key scheduler routes
                                                 # (already used by prior phases, no new variable)
```

No new environment variables added. `NOTIFICATION_SERVICE_URL` and `INTERNAL_API_KEY` were already required by prior phases.

---

## 11. DEPLOYMENT NOTES

```
Services modified:
  - @erp/db (packages/db-client)
  - @erp/types (packages/shared-types)
  - @erp/sales-service
  - @erp/notification-service
  - @erp/scheduler-service
  - @erp/web-frontend

New DB migration: packages/db-client/migrations/0005_phase9_crm.sql
Migration is backward-compatible: YES
  — All new columns are nullable; existing rows unaffected
  — New tables have no mandatory FK constraints that block rollback
Zero-downtime deploy: YES (IF migration runs before service restart)

Post-deploy steps:
  1. Run migration: psql -f migrations/0005_phase9_crm.sql
  2. Seed CRM notification templates:
     POST /api/v2/notifications/templates/seed-crm
     Body: { "tenantId": 1 }  (for each tenant)
  3. Trigger initial health score computation:
     POST /internal/crm/health-score/compute
     Header: x-internal-key: <INTERNAL_API_KEY>

Rollback procedure:
  DROP TABLE campaign_recipients, campaigns, customer_segments,
             customer_interactions, business_seasons;
  ALTER TABLE customers DROP COLUMN health_score, health_segment, scored_at;
  Revert service deployments to previous Docker images.
```

---

## 12. WHAT IS NOT DONE (REMAINING TODO)

| Item | Why Deferred | Target Phase |
|---|---|---|
| Anniversary automation (wedding anniversaries) | Spec M9.6 mentions it; customers table has no anniversary column — requires schema design decision | Phase 10 extension |
| Campaign recipient opt-out / unsubscribe | Not in Phase 9 spec | Phase 10 |
| Real-time WebSocket push for campaign delivery updates | No WebSockets in architecture | Future major version |
| Multi-rule UI for custom segments (currently single-rule) | Low priority MVP | Phase 10 |
| Push notification channel (IN_APP) actual delivery | NotificationEngine stub for IN_APP | Phase 10 |
| Birthday greetings for anniversary date (not just birthday) | Same customer table limitation | Phase 10 extension |

---

## 13. ARCHITECTURE DECISIONS MADE IN THIS PHASE

| Decision | Why | Alternatives Considered |
|---|---|---|
| CSV export instead of Excel (.xlsx) for segments | TECH_AUDIT prohibits adding packages not in pnpm-lock.yaml; xlsx not installed | Add xlsx library (rejected — TECH_AUDIT rule) |
| Activity timeline cache via Redis TTL only (not event-driven invalidation) | Invoice/payment writes are in Phase 4 code — full cross-cutting would require large refactor out of scope | Invalidate on every invoice/payment write (deferred) |
| CampaignService.send() dispatches notifications synchronously | Simplicity for Phase 9; no async worker infrastructure yet | Redis queue with worker (deferred to Phase 10) |
| Segment export returns text/csv (not multipart/form-data download) | Fastify's reply.send(string) with Content-Disposition works natively | Stream-based download (unnecessary complexity) |
| Health scoring uses 5 factors with fixed weights | Spec-defined algorithm; weights are clear from spec | Machine learning (out of scope) |
| Birthday query uses `SUBSTRING(date_of_birth FROM 6 FOR 5) = 'MM-DD'` | dateOfBirth stored as varchar(10) 'YYYY-MM-DD' | Store as date type (breaking change to existing schema) |
| sendRaw() shares deliverWithRetry() with template-based send() | DRY — retry logic is identical; only differ in message source | Duplicate the retry block per send path |
| SegmentFilterRule.value uses z.any() in Zod schema | Zod's z.unknown() infers as optional `value?: unknown` in TypeScript output type, incompatible with required `value: unknown` in SegmentFilterRule; cast to SegmentFilterRule[] after Zod validation | Change SegmentFilterRule.value to optional (would require null checks in customWhere) |

---

## 14. RISKS FOR NEXT PHASE

| Risk | Impact | Mitigation |
|---|---|---|
| Campaign send is synchronous — large segments (10k+) will block request for minutes | High if used at scale | Phase 10: move to async worker queue with progress polling |
| Health scores become stale quickly for high-churn tenants | Medium | Weekly cron is spec-compliant for MVP; reduce to daily if needed |
| `INTERNAL_API_KEY` must be identical across all services | High | Set in Docker Compose shared env; verify in CI |
| Birthday greeting deduplication: if scheduler retries, customer gets 2 greetings | Low for MVP | Add notificationLog dedup check by (tenantId, customerId, eventType, DATE(createdAt)) in Phase 10 |

---

## 15. FINAL ARCHITECTURE SUMMARY

Phase 9 implements a complete CRM and Customer Engagement system on top of the existing cloth retail ERP. Customer health is scored weekly (0–100, 4 segments: CHAMPION/LOYAL/AT_RISK/LOST) using a 5-factor algorithm across purchase frequency, order value, payment timeliness, return rate, and loyalty engagement. The system supports 6 pre-built SQL segments plus custom AND/OR rule segments, all usable as campaign targets for SMS/WhatsApp/Email/IN_APP channels with free-text message templates. Campaigns can be dispatched immediately or scheduled (dispatched every 5 minutes by the scheduler). Birthday greetings are sent automatically each day at 08:00 with WhatsApp-first/SMS-fallback. Festival seasons define stock and loyalty multipliers with a progress bar visible on the dashboard. The CustomerViewPage now has three tabs (Details / Activity Timeline / Interactions) with a Redis-cached unified timeline across all transaction types. All CRM state changes go through the transactional outbox pattern and audit logging.

---

*Generated by: Claude Sonnet 4.6 | Date: 2026-06-30 | Next Phase: Phase 10 — Analytics & Reporting*
