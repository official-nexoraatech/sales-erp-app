# 01 — CRM Feature Inventory & Gap Analysis

Grounded directly in `packages/db-client/src/schema/crm.ts`, `schema/sales.ts`, and
`apps/sales-service/src/{api,domain}/`. Every "exists" row below was confirmed by reading the
actual table/service, not inferred from a phase-prompt's stated intent — several of the ES-18
phase prompt's _stated_ deliverables (in `ERP-PLANNING/audit-phase-prompts/ES-18-CRM-COMMUNICATION.md`)
turned out to already be superseded/expanded by later CP-4→CP-9 campaign work, so that prompt is a
useful history but not current-state ground truth either.

---

## 1. What exists today

| Capability                   | Table(s) / Service                                                                                               | Depth                                                                                                                                                                                                         |
| ---------------------------- | ---------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Customer interaction log     | `customer_interactions`                                                                                          | Visit/call/complaint/email/WhatsApp/system types, follow-up date + done flag. No SLA, no resolution status.                                                                                                   |
| Rule-based segmentation      | `customer_segments`                                                                                              | JSONB `filterDefinition` with AND/OR rule arrays, system + custom segments. Static field filters only — no behavioral/RFM operators yet.                                                                      |
| Multi-channel campaigns      | `campaigns`, `campaignRecipients`, `campaignTemplates`, `campaignHistory`                                        | SMS/WhatsApp/Email/In-App. Draft→Scheduled→Sending→Sent lifecycle. Recipient-level delivery tracking.                                                                                                         |
| Campaign approval workflow   | `campaigns.approvalStatus/approvedBy/approvedAt/rejectionReason`, `tenantCommunicationSettings.approvalRequired` | Optional per-tenant gate (CP-7), off by default.                                                                                                                                                              |
| Campaign recurrence          | `campaigns.recurrenceRule`, `parentRecurringCampaignId`                                                          | Daily/Weekly/Monthly, scheduler-driven (CP-5).                                                                                                                                                                |
| Campaign automation triggers | `campaignAutomationRules`                                                                                        | BIRTHDAY / INACTIVITY / ANNIVERSARY, scheduler cron-fired (CP-5). Single-trigger only — no multi-step chains.                                                                                                 |
| Branch-scoped campaigns      | `campaigns.branchId`, `idx_campaigns_branch`                                                                     | Null = tenant-wide; non-null restricts create/view + recipient resolution (CP-8).                                                                                                                             |
| Granular consent             | `customerCommunicationPreferences`                                                                               | Per-channel × per-category (PROMOTIONAL/TRANSACTIONAL) consent, distinct from the older binary `opt_out_*` flags on `customers` (both enforced).                                                              |
| Campaign engagement tracking | `campaignRecipients.deliveredAt/openedAt/clickedAt/convertedAt`                                                  | **Schema-complete, write-incomplete** — only `deliveredAt` is ever populated (via webhook→outbox→consumer). `opened_at`/`clicked_at`/`converted_at` are dead columns today.                                   |
| Outbound webhooks            | `webhookSubscriptions`, `webhookDeliveries`                                                                      | Generalized beyond campaigns to any aggregate type (CP-8).                                                                                                                                                    |
| Sender identity              | `tenantSenderIdentity`                                                                                           | Per-tenant/per-channel, falls back to platform default.                                                                                                                                                       |
| Loyalty points ledger        | `loyaltyTransactions` (in `schema/sales.ts`)                                                                     | Transaction-level points ledger tied to sales. No tier concept, no redemption catalog, no expiry.                                                                                                             |
| Festival/season planner      | `businessSeasons`                                                                                                | Fashion-vertical-specific: stock multiplier, loyalty multiplier, sales target per season (FESTIVAL/WEDDING/SUMMER/YEAR_END). Genuinely differentiated — no major CRM vendor ships this.                       |
| Customer health scoring      | `HealthScoringService.ts` (server-side)                                                                          | Exists, no dedicated frontend surface.                                                                                                                                                                        |
| Activity timeline            | `ActivityTimelineService.ts` (server-side)                                                                       | Exists, no dedicated frontend surface.                                                                                                                                                                        |
| Frontend CRM pages           | `apps/web-frontend/src/pages/crm/`                                                                               | `SegmentsPage`, `SegmentFormPage`, `CampaignsPage`, `CampaignFormPage`, `CampaignDetailPage`, `CampaignSettingsPage`, `SeasonsPage`, `SeasonFormPage` — no Customer 360, Leads, Pipeline, or Ticketing pages. |
| E2E coverage                 | `apps/web-frontend/e2e/live-crm.spec.ts`, `live-sales-crm-remainder.spec.ts`, `campaign-*.spec.ts` (4 files)     | Segments/Campaigns/Seasons paths are E2E-tested today.                                                                                                                                                        |

## 2. What is confirmed absent (grepped, not assumed)

A repo-wide search for `Lead|Opportunity|Pipeline|Ticket|Deal|Referral|Journey` across
`apps/sales-service/src` returned **zero matches**. Cross-checked against `crm.ts`'s full table
list (17 tables, all enumerated in §1 above plus their type exports) — none of the following exist
as entities anywhere in the schema:

- **Lead** — no capture, scoring, or qualification concept anywhere; every customer record starts
  as a fully-formed `Customer`, day one.
- **Opportunity / Deal / Pipeline** — no stage, no probability, no forecast, no win/loss tracking.
- **Support Ticket** — complaints are an `interaction` type with no SLA, status machine, or
  assignment; there is no ticketing entity.
- **Referral** — no referral code, event, or reward mechanism of any kind.
- **Account/Contact hierarchy** — `customers` is a flat table; there is no multi-contact-per-account
  model, so B2B/wholesale buyers with multiple stakeholders can't be represented correctly.
- **Journey Builder** — automation is single-trigger (`campaignAutomationRules`), not multi-step or
  branching.
- **Omnichannel inbox** — all channels are outbound-broadcast only; no inbound conversation/reply
  threading exists anywhere in the codebase.
- **Self-service customer portal** — no `CUSTOMER`-scoped auth role or customer-facing frontend
  exists at all.

## 3. Gap-to-feature mapping (which roadmap phase closes each gap)

| Gap                                                 | Closed by                                          | Phase                                                                |
| --------------------------------------------------- | -------------------------------------------------- | -------------------------------------------------------------------- |
| No Account/Contact hierarchy                        | Contact & Account Hierarchy                        | 1                                                                    |
| No Lead entity                                      | Lead Management & Capture                          | 1                                                                    |
| No Opportunity/Pipeline                             | Sales Pipeline & Opportunity Management            | 2                                                                    |
| Health score / timeline stranded server-side        | Customer 360 Command Center                        | 1                                                                    |
| No Ticketing                                        | Support & Ticketing                                | 1                                                                    |
| Static-only segments                                | Advanced Segmentation Engine                       | 2                                                                    |
| Dead engagement-tracking columns                    | Campaign Studio engagement upgrade                 | 2                                                                    |
| Single-trigger automation only                      | Visual Journey Builder                             | 2                                                                    |
| No loyalty tiers/redemption                         | Loyalty Tiering Layer                              | 2                                                                    |
| No Referral program                                 | Referral Program Engine                            | 2                                                                    |
| No two-way channel conversation                     | Omnichannel Communication Hub                      | 2                                                                    |
| No churn/next-best-action/recommendations           | AI & Predictive Intelligence Suite                 | 3                                                                    |
| No customer-facing surface                          | Self-Service Customer Portal                       | 3                                                                    |
| CRM can't see live stock/AR without a manual lookup | ERP-Native Integration Layer                       | 1 (moved earlier — see `02-ARCHITECTURE-RECOMMENDATIONS.md` for why) |
| No field-sales / distributor tooling                | Field Sales, WhatsApp Commerce & Compliance bundle | 4 (Enterprise)                                                       |
| DLT/TRAI SMS compliance unaddressed                 | DLT/TRAI SMS Compliance                            | 1 (compliance — not deferrable)                                      |

Full per-feature specs for every row above are in the phase documents (`10`–`13`), not repeated
here. This document is the "what and why," not the "how."

## 4. Explicitly out of scope for this roadmap

Carried forward from the same judgment call `ES-18-CRM-COMMUNICATION.md` made, still valid:

- Live chat _widget_ embedded on a public marketing site (distinct from the Omnichannel Inbox,
  which is internal-facing conversation management — Phase 2 builds the inbox, not a public widget).
- Social media integration (Instagram/Facebook DM, etc.) — no product signal this is needed yet.
- Full partner/channel ecosystem marketplace — covered at "Enterprise" depth only (Phase 4), not a
  near-term commitment.
