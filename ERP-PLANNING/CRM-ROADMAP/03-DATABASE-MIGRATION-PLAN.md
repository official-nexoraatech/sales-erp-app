# 03 — Database Migration Plan

## 1. Conventions (inherited, not invented)

- Sequential numbered files in `packages/db-client/migrations/`, next number is whatever's after
  the highest existing file at implementation time (105 files exist as of this audit — **do not
  hardcode a number in this doc**, check `ls packages/db-client/migrations/` immediately before
  generating a migration).
- File naming follows the established pattern: `NNNN_<short-feature-slug>.sql`, with a **separate**
  `NNNN_<feature>_permission_backfill.sql` migration when a feature grants a new permission to a
  default role (see `02-ARCHITECTURE-RECOMMENDATIONS.md` AR-7 and the many existing
  `*_permission_backfill.sql` files for the pattern).
- Every table: `id bigserial PRIMARY KEY`, `tenant_id integer NOT NULL`, `created_at timestamptz
NOT NULL DEFAULT now()`, `updated_at timestamptz NOT NULL DEFAULT now()`; mutable tables also get
  `version integer NOT NULL DEFAULT 0` for optimistic locking.
- Drizzle schema files are the source of truth; migrations are generated via `drizzle-kit`, not
  hand-written from scratch — write the schema change in the relevant `packages/db-client/src/schema/*.ts`
  file first, then generate.
- New CRM entities go in `packages/db-client/src/schema/crm.ts` (extending the existing file), not
  a new schema file, matching how Segments/Campaigns/Loyalty/Seasons already coexist there.

## 2. New tables by phase (full column-level detail lives in each phase doc's per-feature "Database Impact" section — this is the sequencing view)

| Phase          | New tables                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          | Extends existing tables                                                                                                      |
| -------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| 1              | `crm_accounts`, `crm_account_contacts`, `crm_contact_roles`, `crm_leads`, `crm_lead_activities`, `crm_lead_sources`, `crm_assignment_rules`, `crm_tickets`, `crm_ticket_messages`, `crm_ticket_sla_rules`, `crm_csat_responses`, `crm_dlt_templates`                                                                                                                                                                                                                                                | `customers` (+ `account_id` nullable FK)                                                                                     |
| 2              | `crm_opportunities`, `crm_opportunity_line_items`, `crm_pipeline_stages`, `crm_opportunity_history`, `crm_journeys`, `crm_journey_steps`, `crm_journey_enrollments`, `crm_journey_step_events`, `crm_loyalty_tiers`, `crm_loyalty_redemptions`, `crm_redemption_catalog`, `crm_referral_codes`, `crm_referral_events`, `crm_referral_rewards`, `crm_conversations`, `crm_conversation_messages`, `crm_canned_responses`, `crm_segment_membership_cache`, `crm_campaign_variants`, `crm_link_clicks` | `customer_segments` (new operator vocabulary in `filterDefinition`, no column change), `loyaltyTransactions` (+ `expiry_at`) |
| 3              | `crm_health_scores`, `crm_churn_predictions`, `crm_next_best_actions`, `crm_product_recommendations`, `crm_portal_sessions` (or reuse auth-service session model — decide at implementation time per AR-5)                                                                                                                                                                                                                                                                                          | none                                                                                                                         |
| 4 (Enterprise) | `crm_field_visits`, `crm_visit_routes`, `crm_whatsapp_catalog_orders`, `crm_approval_chains`, `crm_approval_requests`, `crm_approval_steps`                                                                                                                                                                                                                                                                                                                                                         | none                                                                                                                         |

## 3. Backward compatibility rules

- `customers.account_id` is **nullable**. Existing POS/retail customers keep working unmodified —
  an "implicit account" is created lazily, not backfilled in bulk, avoiding a risky mass-update
  migration on a table every other service reads.
- No existing column is renamed or removed anywhere in this roadmap. `campaignRecipients.opened_at`/
  `clicked_at` (Phase 2) go from unused to used — that's a write-path change in application code, not
  a schema change.
- Every migration must be reversible in principle (a paired `DOWN` is not this codebase's convention
  per the existing migration files, which are forward-only — but every `ALTER TABLE ADD COLUMN` must
  be nullable or have a safe default so it never locks/breaks existing rows on a large table).
- Migrations that touch high-traffic existing tables (`customers`, `campaigns`) are additive-only
  (`ADD COLUMN ... NULL` or `DEFAULT`) — never a rewrite in place.

## 4. Sequencing dependencies

1. `crm_accounts`/`crm_account_contacts` (Phase 1) must land before `crm_leads` and
   `crm_opportunities` (Phase 1/2), since both reference accounts on conversion/creation.
2. `crm_pipeline_stages` must be seeded with tenant defaults (or a system-default set, mirroring how
   `customer_segments.isSystem` seeds system segments) before `crm_opportunities` can be created —
   this is a data migration, not just schema.
3. `crm_loyalty_tiers` must exist and have at least one default tier before the tier-evaluation job
   (Phase 2) can run against existing `loyaltyTransactions` history.
4. Journey Builder tables (Phase 2) depend on nothing new from Phase 1 except that
   `campaignAutomationRules`' scheduler-cron mechanism (already live) is the execution substrate —
   no schema dependency, only a code dependency (AR-3).

## 5. Rollback strategy for this section

See `09-ROLLBACK-AND-RISK.md` §2 for the full policy. Database-specific summary: every migration in
this roadmap is additive (new tables, nullable new columns) — the safe rollback for any single
migration is "stop writing to the new table/column and redeploy the previous application version";
dropping the table/column is a separate, deliberate follow-up only after confirming no code path
references it, never part of an emergency rollback.
