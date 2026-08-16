import {
  bigserial,
  boolean,
  decimal,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  unique,
  varchar,
} from 'drizzle-orm/pg-core';

// ─── Customer Interactions (M9.3) ──────────────────────────────────────────
export const customerInteractions = pgTable(
  'customer_interactions',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    tenantId: integer('tenant_id').notNull(),
    customerId: integer('customer_id').notNull(),
    type: varchar('type', { length: 20 })
      .notNull()
      .$type<'VISIT' | 'CALL' | 'COMPLAINT' | 'EMAIL' | 'WHATSAPP' | 'OTHER' | 'SYSTEM'>(),
    notes: text('notes').notNull(),
    followUpDate: timestamp('follow_up_date', { withTimezone: true }),
    followUpDone: boolean('follow_up_done').notNull().default(false),
    createdBy: integer('created_by').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }),
  },
  (t) => [
    index('idx_cust_interactions_customer').on(t.customerId, t.tenantId, t.createdAt),
    index('idx_cust_interactions_followup').on(t.followUpDate, t.followUpDone, t.tenantId),
    index('idx_cust_interactions_created_by').on(t.createdBy, t.tenantId),
  ]
);

// ─── Customer Segments (M9.4) ──────────────────────────────────────────────
export const customerSegments = pgTable(
  'customer_segments',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    tenantId: integer('tenant_id').notNull(),
    name: varchar('name', { length: 200 }).notNull(),
    code: varchar('code', { length: 60 }).notNull(),
    isSystem: boolean('is_system').notNull().default(false),
    filterDefinition: jsonb('filter_definition').$type<{
      rules: Array<{ field: string; operator: string; value: unknown }>;
      logic: 'AND' | 'OR';
    }>(),
    description: text('description'),
    createdBy: integer('created_by').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    unique('customer_segments_tenant_code').on(t.tenantId, t.code),
    index('idx_customer_segments_tenant').on(t.tenantId, t.isSystem),
  ]
);

// ─── Campaigns (M9.5) ───────────────────────────────────────────────────────
export const campaigns = pgTable(
  'campaigns',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    tenantId: integer('tenant_id').notNull(),
    name: varchar('name', { length: 200 }).notNull(),
    segmentId: integer('segment_id'),
    customerIds: jsonb('customer_ids').$type<number[]>(),
    channel: varchar('channel', { length: 20 })
      .notNull()
      .$type<'SMS' | 'WHATSAPP' | 'EMAIL' | 'IN_APP'>(),
    messageTemplate: text('message_template').notNull(),
    status: varchar('status', { length: 20 })
      .notNull()
      .default('DRAFT')
      .$type<'DRAFT' | 'SCHEDULED' | 'SENDING' | 'SENT' | 'CANCELLED' | 'FAILED'>(),
    scheduledAt: timestamp('scheduled_at', { withTimezone: true }),
    sentAt: timestamp('sent_at', { withTimezone: true }),
    totalRecipients: integer('total_recipients').notNull().default(0),
    sentCount: integer('sent_count').notNull().default(0),
    deliveredCount: integer('delivered_count').notNull().default(0),
    failedCount: integer('failed_count').notNull().default(0),
    cancelledAt: timestamp('cancelled_at', { withTimezone: true }),
    createdBy: integer('created_by').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
    version: integer('version').notNull().default(0),
    // CP-4 (Campaign Management Platform initiative): campaign type taxonomy (tenant-configurable
    // metadata, not an enum), optional template linkage, and last-edit timestamp.
    campaignType: varchar('campaign_type', { length: 50 }),
    templateId: integer('template_id'),
    lastEditedAt: timestamp('last_edited_at', { withTimezone: true }),
    // CP-5: recurring-campaign support — a definition row has recurrenceRule set; each firing
    // creates its own concrete campaign row with parentRecurringCampaignId set.
    recurrenceRule: jsonb('recurrence_rule').$type<{
      frequency: 'DAILY' | 'WEEKLY' | 'MONTHLY';
      interval: number;
      endDate?: string;
      occurrences?: number;
    }>(),
    timezone: varchar('timezone', { length: 50 }),
    parentRecurringCampaignId: integer('parent_recurring_campaign_id'),
    // CP-7: approval workflow — optional per tenant (tenantCommunicationSettings.approvalRequired).
    approvalStatus: varchar('approval_status', { length: 20 }).$type<
      'PENDING_APPROVAL' | 'APPROVED' | 'REJECTED'
    >(),
    approvedBy: integer('approved_by'),
    approvedAt: timestamp('approved_at', { withTimezone: true }),
    rejectionReason: text('rejection_reason'),
    // CP-8: store/branch scoping. Null = tenant-wide (every campaign before this phase, and any
    // tenant that doesn't use branch scoping) — a non-null value restricts both who can
    // create/view it (getBranchScope) and which customers it can target (resolveRecipients).
    branchId: integer('branch_id'),
    // CRM-ROADMAP Phase 2, Feature 6 (Campaign Studio — Engagement Tracking Activation): the
    // real destination a `{{link}}` token in messageTemplate resolves to. Null = the template
    // has no tracked link (most SMS/WhatsApp campaigns today) — send() only wraps a link when
    // this is set. Never read directly by the public redirect route — that route only ever
    // reads the per-recipient destinationUrl already copied onto crm_link_clicks at send time,
    // so this column is not itself part of the redirect's trust boundary.
    linkUrl: text('link_url'),
  },
  (t) => [
    index('idx_campaigns_tenant_status').on(t.tenantId, t.status, t.createdAt),
    index('idx_campaigns_scheduled').on(t.scheduledAt, t.status),
    index('idx_campaigns_parent_recurring').on(t.parentRecurringCampaignId),
    index('idx_campaigns_branch').on(t.branchId, t.tenantId),
  ]
);

export const campaignRecipients = pgTable(
  'campaign_recipients',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    tenantId: integer('tenant_id').notNull(),
    campaignId: integer('campaign_id').notNull(),
    customerId: integer('customer_id').notNull(),
    status: varchar('status', { length: 20 })
      .notNull()
      .default('PENDING')
      .$type<'PENDING' | 'SENT' | 'DELIVERED' | 'FAILED'>(),
    notificationLogId: integer('notification_log_id'),
    errorMessage: text('error_message'),
    sentAt: timestamp('sent_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    // CP-6: engagement/attribution timestamps. deliveredAt is populated via the webhook ->
    // outbox -> consumer path; opened/clicked were reserved (never written) until
    // CRM-ROADMAP Phase 2, Feature 6, which is what finally writes them (crm_link_clicks +
    // link-tracking.routes.ts) and populates convertedAt via the nightly attribution job.
    deliveredAt: timestamp('delivered_at', { withTimezone: true }),
    openedAt: timestamp('opened_at', { withTimezone: true }),
    clickedAt: timestamp('clicked_at', { withTimezone: true }),
    convertedAt: timestamp('converted_at', { withTimezone: true }),
    // CRM-ROADMAP Phase 3, Feature 3 (Campaign ROI & Attribution Reporting) — which invoice
    // caused this conversion and its revenue at attribution time. Both null until
    // attributeConversions() sets them together; both cleared together if that invoice is later
    // CANCELLED (the roadmap's own explicit "reverse the attribution" edge case) — convertedAt
    // is cleared too, since a reversed attribution isn't "converted" at all anymore.
    convertedInvoiceId: integer('converted_invoice_id'),
    convertedAmount: decimal('converted_amount', { precision: 15, scale: 2 }),
    // CRM-ROADMAP Phase 2, Feature 6 — which crm_campaign_variants row (if any) this recipient
    // was assigned for an A/B-tested campaign. Null for every non-variant campaign (unchanged
    // behavior for all existing sends).
    variantId: integer('variant_id'),
  },
  (t) => [
    index('idx_campaign_recipients_campaign').on(t.campaignId, t.status),
    index('idx_campaign_recipients_customer').on(t.customerId, t.tenantId),
  ]
);

// ─── Campaign Variants (CRM-ROADMAP Phase 2, Feature 6 — A/B testing) ──────────────
// Exactly what a tenant configures at campaign-creation time — send() assigns each recipient to
// one variant (weighted split) and renders THAT variant's messageTemplate instead of the parent
// campaign's. A campaign with zero variant rows behaves exactly as it always has (variantId
// stays null on every recipient) — this table is purely additive.
export const crmCampaignVariants = pgTable(
  'crm_campaign_variants',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    tenantId: integer('tenant_id').notNull(),
    campaignId: integer('campaign_id').notNull(),
    label: varchar('label', { length: 10 }).notNull(),
    messageTemplate: text('message_template').notNull(),
    // Relative weight for the split (e.g. 50/50) — not a percentage requiring all variants'
    // weights to sum to 100; send() normalizes across whatever's configured.
    weight: integer('weight').notNull().default(50),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [index('idx_crm_campaign_variants_campaign').on(t.campaignId, t.tenantId)]
);

// ─── Campaign Message Translations (CRM-ROADMAP Phase 3, Feature 5) ───────────────
// Per-campaign language variants — snapshotted from crm_campaign_template_translations at
// campaign-creation time when the campaign was created from a template (same snapshot-not-live-
// link convention campaigns.messageTemplate itself already uses), or authored directly on the
// campaign otherwise. A campaign with zero rows here sends campaigns.messageTemplate to every
// recipient exactly as before this feature — this table is additive, opt-in per campaign.
// Deliberately independent of crm_campaign_variants (A/B testing): a recipient whose preferred
// language has a matching row here gets that translation and is NOT also entered into A/B variant
// assignment — the two features aren't combined in this pass (see CampaignService.send()).
export const crmCampaignMessageTranslations = pgTable(
  'crm_campaign_message_translations',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    tenantId: integer('tenant_id').notNull(),
    campaignId: integer('campaign_id').notNull(),
    language: varchar('language', { length: 10 }).notNull(),
    messageTemplate: text('message_template').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    unique('crm_campaign_message_translations_unique').on(t.campaignId, t.language),
    index('idx_crm_campaign_message_translations_campaign').on(t.campaignId, t.tenantId),
  ]
);

// ─── Link Clicks / Opens (CRM-ROADMAP Phase 2, Feature 6) ──────────────────────────
// One row per recipient per send (created in send(), regardless of channel) — the per-recipient
// tracking token backing BOTH the click-redirect endpoint and the open-tracking pixel. destinationUrl
// is copied from campaigns.linkUrl at send time and is the ONLY thing the public redirect route
// ever reads to decide where to send a click — it never trusts anything in the incoming request,
// which is what keeps GET /c/:trackingToken from being an open-redirect vector (06-SECURITY-PLAN.md
// §2.3's stated concern for this exact route). Null destinationUrl means this recipient's message
// had no tracked link — the click route 404s for that token, but the open-pixel route still works.
export const crmLinkClicks = pgTable(
  'crm_link_clicks',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    tenantId: integer('tenant_id').notNull(),
    campaignId: integer('campaign_id').notNull(),
    campaignRecipientId: integer('campaign_recipient_id').notNull(),
    trackingToken: varchar('tracking_token', { length: 40 }).notNull(),
    destinationUrl: text('destination_url'),
    clickCount: integer('click_count').notNull().default(0),
    firstClickedAt: timestamp('first_clicked_at', { withTimezone: true }),
    lastClickedAt: timestamp('last_clicked_at', { withTimezone: true }),
    openCount: integer('open_count').notNull().default(0),
    firstOpenedAt: timestamp('first_opened_at', { withTimezone: true }),
    lastOpenedAt: timestamp('last_opened_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    unique('crm_link_clicks_token_unique').on(t.trackingToken),
    index('idx_crm_link_clicks_recipient').on(t.campaignRecipientId),
  ]
);

// ─── Customer Journeys (CRM-ROADMAP Phase 2, Feature 2 — Visual Customer Journey Builder) ──
// Per AR-3: journeys compile to the same scheduler-cron mechanism already driving
// campaign_automation_rules; every ACTION step's send goes through the existing
// CampaignService.send() (a one-customer `customerIds` campaign, same path
// fireAutomationRule() already uses), inheriting consent/opt-out/frequency-cap enforcement for
// free — no second send mechanism.
export const crmJourneys = pgTable(
  'crm_journeys',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    tenantId: integer('tenant_id').notNull(),
    name: varchar('name', { length: 200 }).notNull(),
    status: varchar('status', { length: 20 })
      .notNull()
      .default('DRAFT')
      .$type<'DRAFT' | 'PUBLISHED' | 'PAUSED' | 'ARCHIVED'>(),
    // Who's eligible to enroll — reuses the existing segment engine (Feature 7), not a new
    // audience-definition mechanism.
    segmentId: integer('segment_id'),
    publishedAt: timestamp('published_at', { withTimezone: true }),
    createdBy: integer('created_by').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
    version: integer('version').notNull().default(0),
  },
  (t) => [index('idx_crm_journeys_tenant_status').on(t.tenantId, t.status)]
);

// A journey is an ordered top-level list of steps; a BRANCH step's two outcomes are each their
// own short nested list (parentStepId + branchPath), not a rejoining graph — the simplest model
// that still supports this feature's own literal example ("welcome -> wait 3 days -> conditional
// offer") without a freeform node-graph UI (none exists in this codebase; none is justified here
// either, per the phase doc's own "no new graph library unless justified").
export const crmJourneySteps = pgTable(
  'crm_journey_steps',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    tenantId: integer('tenant_id').notNull(),
    journeyId: integer('journey_id').notNull(),
    // Null = a top-level step; set = nested inside a BRANCH step's true/false path.
    parentStepId: integer('parent_step_id'),
    branchPath: varchar('branch_path', { length: 5 }).$type<'TRUE' | 'FALSE'>(),
    sequence: integer('sequence').notNull(),
    stepType: varchar('step_type', { length: 20 }).notNull().$type<'DELAY' | 'ACTION' | 'BRANCH'>(),
    // DELAY config
    delayDays: integer('delay_days'),
    // ACTION config — same channel/messageTemplate shape CampaignService already renders.
    channel: varchar('channel', { length: 20 }).$type<'SMS' | 'WHATSAPP' | 'EMAIL' | 'IN_APP'>(),
    messageTemplate: text('message_template'),
    // BRANCH config
    branchConditionType: varchar('branch_condition_type', { length: 30 }).$type<'MADE_PURCHASE'>(),
    branchWithinDays: integer('branch_within_days'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    index('idx_crm_journey_steps_journey').on(
      t.journeyId,
      t.parentStepId,
      t.branchPath,
      t.sequence
    ),
  ]
);

// One row per enrolled customer. UNIQUE(journeyId, customerId) is a deliberate, DB-enforced
// design choice — it makes "no accidental re-entry" (this feature's own stated edge case)
// structural rather than merely application-logic-enforced: a customer who ever enrolled
// (regardless of ACTIVE/COMPLETED/EXITED) can never get a second row for the same journey.
export const crmJourneyEnrollments = pgTable(
  'crm_journey_enrollments',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    tenantId: integer('tenant_id').notNull(),
    journeyId: integer('journey_id').notNull(),
    customerId: integer('customer_id').notNull(),
    status: varchar('status', { length: 20 })
      .notNull()
      .default('ACTIVE')
      .$type<'ACTIVE' | 'COMPLETED' | 'EXITED'>(),
    currentStepId: integer('current_step_id'),
    // When this enrollment is next due for evaluation — null/now-or-past means "process on the
    // next tick"; set to a future time by a DELAY step. Indexed as the scheduler's hot-path
    // query (07-PERFORMANCE-PLAN.md §2), mirroring campaigns.scheduledAt's existing pattern.
    nextEvaluationAt: timestamp('next_evaluation_at', { withTimezone: true }),
    currentStepEnteredAt: timestamp('current_step_entered_at', { withTimezone: true }),
    exitReason: varchar('exit_reason', { length: 30 }).$type<'OPTED_OUT' | 'MANUAL'>(),
    enrolledAt: timestamp('enrolled_at', { withTimezone: true }).defaultNow().notNull(),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    exitedAt: timestamp('exited_at', { withTimezone: true }),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
    version: integer('version').notNull().default(0),
  },
  (t) => [
    unique('crm_journey_enrollments_journey_customer_unique').on(t.journeyId, t.customerId),
    index('idx_crm_journey_enrollments_due').on(t.tenantId, t.status, t.nextEvaluationAt),
  ]
);

// Step-by-step audit trail — backs the "per-step conversion" acceptance criterion.
export const crmJourneyStepEvents = pgTable(
  'crm_journey_step_events',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    tenantId: integer('tenant_id').notNull(),
    journeyId: integer('journey_id').notNull(),
    enrollmentId: integer('enrollment_id').notNull(),
    stepId: integer('step_id'),
    eventType: varchar('event_type', { length: 20 })
      .notNull()
      .$type<'ENTERED' | 'COMPLETED' | 'EXITED'>(),
    metadata: jsonb('metadata').$type<Record<string, unknown>>(),
    occurredAt: timestamp('occurred_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [index('idx_crm_journey_step_events_enrollment').on(t.enrollmentId, t.occurredAt)]
);

// ─── Loyalty Tiers (CRM-ROADMAP Phase 2, Feature 3) ────────────────────────────
// Tier is derived from LIFETIME points earned (SUM of EARN + BIRTHDAY_BONUS transactions ever
// posted), not the customer's current redeemable balance — a customer's tier can only go up,
// never down automatically. This deliberately sidesteps the roadmap's own flagged
// "customer-experience-sensitive" auto-downgrade question: redeeming or losing points to expiry
// never demotes a customer, matching how most real-world loyalty programs (airlines, retail)
// define tier status.
export const crmLoyaltyTiers = pgTable(
  'crm_loyalty_tiers',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    tenantId: integer('tenant_id').notNull(),
    name: varchar('name', { length: 100 }).notNull(),
    code: varchar('code', { length: 50 }).notNull(),
    minLifetimePoints: integer('min_lifetime_points').notNull(),
    benefits: text('benefits'),
    isActive: boolean('is_active').notNull().default(true),
    createdBy: integer('created_by').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
    version: integer('version').notNull().default(0),
  },
  (t) => [
    unique('crm_loyalty_tiers_tenant_code').on(t.tenantId, t.code),
    index('idx_crm_loyalty_tiers_tenant').on(t.tenantId, t.minLifetimePoints),
  ]
);

// ─── Redemption Catalog (CRM-ROADMAP Phase 2, Feature 3) ───────────────────────
// Specific named rewards a customer can redeem points for (e.g. "10% Off Voucher — 500 points"),
// distinct from the pre-existing generic points->currency redemption
// (LoyaltyService.redeemPoints, still used as-is by POS_MANAGE-gated /pos/loyalty/redeem).
// Redeeming a catalog item still posts through that exact same loyaltyTransactions ledger — this
// table only records WHICH catalog item was chosen and the resulting reward to apply, never a
// parallel points ledger.
export const crmRedemptionCatalog = pgTable(
  'crm_redemption_catalog',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    tenantId: integer('tenant_id').notNull(),
    name: varchar('name', { length: 200 }).notNull(),
    description: text('description'),
    pointsCost: integer('points_cost').notNull(),
    rewardType: varchar('reward_type', { length: 20 })
      .notNull()
      .$type<'DISCOUNT_AMOUNT' | 'DISCOUNT_PERCENT'>(),
    rewardValue: decimal('reward_value', { precision: 10, scale: 2 }).notNull(),
    isActive: boolean('is_active').notNull().default(true),
    createdBy: integer('created_by').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
    version: integer('version').notNull().default(0),
  },
  (t) => [index('idx_crm_redemption_catalog_tenant').on(t.tenantId, t.isActive)]
);

export const crmLoyaltyRedemptions = pgTable(
  'crm_loyalty_redemptions',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    tenantId: integer('tenant_id').notNull(),
    customerId: integer('customer_id').notNull(),
    catalogItemId: integer('catalog_item_id').notNull(),
    pointsCost: integer('points_cost').notNull(),
    rewardType: varchar('reward_type', { length: 20 })
      .notNull()
      .$type<'DISCOUNT_AMOUNT' | 'DISCOUNT_PERCENT'>(),
    rewardValue: decimal('reward_value', { precision: 10, scale: 2 }).notNull(),
    loyaltyTransactionId: integer('loyalty_transaction_id').notNull(),
    invoiceId: integer('invoice_id'),
    createdBy: integer('created_by').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [index('idx_crm_loyalty_redemptions_customer').on(t.customerId, t.tenantId, t.createdAt)]
);

// ─── Referral Program (CRM-ROADMAP Phase 2, Feature 4) ─────────────────────────
// Reward payout still posts through the exact same loyalty_transactions ledger as Feature 3
// (see ReferralService.ts's own comment) — no parallel reward rail. `code` is globally unique
// (not per-tenant) because the public click/redeem routes resolve the tenant FROM the code —
// there's no other way for an unauthenticated referral link to carry a tenantId.
export const crmReferralCodes = pgTable(
  'crm_referral_codes',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    tenantId: integer('tenant_id').notNull(),
    customerId: integer('customer_id').notNull(),
    code: varchar('code', { length: 20 }).notNull(),
    isActive: boolean('is_active').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    unique('crm_referral_codes_code_unique').on(t.code),
    unique('crm_referral_codes_tenant_customer_unique').on(t.tenantId, t.customerId),
  ]
);

export const crmReferralEvents = pgTable(
  'crm_referral_events',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    tenantId: integer('tenant_id').notNull(),
    referralCodeId: integer('referral_code_id').notNull(),
    eventType: varchar('event_type', { length: 20 })
      .notNull()
      .$type<'CLICKED' | 'SIGNED_UP' | 'PURCHASED'>(),
    ipAddress: varchar('ip_address', { length: 45 }),
    deviceId: varchar('device_id', { length: 100 }),
    metadata: jsonb('metadata').$type<Record<string, unknown>>(),
    occurredAt: timestamp('occurred_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [index('idx_crm_referral_events_code').on(t.referralCodeId, t.eventType, t.occurredAt)]
);

// One row per referee, ever — the DB-enforced unique(tenant_id, referee_phone) below is the
// structural guarantee behind "one-time-per-referee enforcement" (roadmap's own explicit fraud
// requirement), not just an application-logic check.
export const crmReferralRewards = pgTable(
  'crm_referral_rewards',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    tenantId: integer('tenant_id').notNull(),
    referralCodeId: integer('referral_code_id').notNull(),
    referrerCustomerId: integer('referrer_customer_id').notNull(),
    refereePhone: varchar('referee_phone', { length: 20 }).notNull(),
    refereeName: varchar('referee_name', { length: 200 }),
    // Null until attributeQualifyingPurchases() resolves this phone to a real, newly-created
    // customer row and confirms a qualifying purchase — see ReferralService's own comment on why
    // this can't be resolved at redeem() time (the referee often isn't a customer yet).
    refereeCustomerId: integer('referee_customer_id'),
    status: varchar('status', { length: 20 })
      .notNull()
      .default('PENDING')
      .$type<'PENDING' | 'FLAGGED' | 'PAID' | 'REJECTED'>(),
    referrerPoints: integer('referrer_points').notNull(),
    refereePoints: integer('referee_points').notNull(),
    referrerLoyaltyTransactionId: integer('referrer_loyalty_transaction_id'),
    refereeLoyaltyTransactionId: integer('referee_loyalty_transaction_id'),
    ipAddress: varchar('ip_address', { length: 45 }),
    deviceId: varchar('device_id', { length: 100 }),
    // Set when status is FLAGGED (device/address correlation) — the roadmap's own security
    // classification requires fraud detection to have "its own abuse-review path, not just a
    // reward payout path"; a FLAGGED reward never auto-pays until REFERRAL_CONFIGURE approves it.
    flagReason: text('flag_reason'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    paidAt: timestamp('paid_at', { withTimezone: true }),
  },
  (t) => [
    unique('crm_referral_rewards_tenant_referee_phone_unique').on(t.tenantId, t.refereePhone),
    index('idx_crm_referral_rewards_status').on(t.tenantId, t.status),
  ]
);

// ─── Omnichannel Communication Hub (CRM-ROADMAP Phase 2, Feature 5) ────────────
// A two-way inbox — WhatsApp/SMS/Email were broadcast-only (CampaignService) before this;
// inbound provider webhooks write here, keyed by (tenant, channel, externalAddress) so every
// reply from the same customer on the same channel threads into one conversation.
// customerId is nullable — an inbound message from a phone/email with no matching customer
// creates a lead instead (ConversationService reuses LeadService.capture() verbatim, per this
// feature's own "unknown sender" edge case) and stays null/flagged until one exists.
export const crmConversations = pgTable(
  'crm_conversations',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    tenantId: integer('tenant_id').notNull(),
    customerId: integer('customer_id'),
    channel: varchar('channel', { length: 20 })
      .notNull()
      .$type<'WHATSAPP' | 'SMS' | 'EMAIL' | 'INSTAGRAM'>(),
    externalAddress: varchar('external_address', { length: 200 }).notNull(),
    status: varchar('status', { length: 20 })
      .notNull()
      .default('OPEN')
      .$type<'OPEN' | 'ASSIGNED' | 'CLOSED'>(),
    assignedTo: integer('assigned_to'),
    lastMessageAt: timestamp('last_message_at', { withTimezone: true }).defaultNow().notNull(),
    lastMessagePreview: varchar('last_message_preview', { length: 300 }),
    unreadCount: integer('unread_count').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    unique('crm_conversations_tenant_channel_address_unique').on(
      t.tenantId,
      t.channel,
      t.externalAddress
    ),
    index('idx_crm_conversations_customer').on(t.tenantId, t.customerId, t.lastMessageAt),
  ]
);

export const crmConversationMessages = pgTable(
  'crm_conversation_messages',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    tenantId: integer('tenant_id').notNull(),
    conversationId: integer('conversation_id').notNull(),
    direction: varchar('direction', { length: 10 }).notNull().$type<'INBOUND' | 'OUTBOUND'>(),
    body: text('body').notNull(),
    mediaUrl: text('media_url'),
    // 'INTERNAL' identifies an outbound reply sent directly from this ERP with no external
    // provider round-trip to dedup against (canned responses, manual replies) — providerMessageId
    // is null for these, same as any other outbound send.
    provider: varchar('provider', { length: 20 }).$type<
      'META' | 'MSG91' | 'SENDGRID' | 'INTERNAL'
    >(),
    // The provider's own message/event id — the idempotency key a retried inbound webhook must
    // collide against. Nullable (OUTBOUND/INTERNAL messages have none); Postgres treats multiple
    // NULLs as distinct under a plain UNIQUE constraint, so this needs no partial index.
    providerMessageId: varchar('provider_message_id', { length: 200 }),
    sentBy: integer('sent_by'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    unique('crm_conversation_messages_provider_message_unique').on(t.provider, t.providerMessageId),
    index('idx_crm_conversation_messages_conversation').on(t.conversationId, t.createdAt),
  ]
);

export const crmCannedResponses = pgTable(
  'crm_canned_responses',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    tenantId: integer('tenant_id').notNull(),
    title: varchar('title', { length: 200 }).notNull(),
    body: text('body').notNull(),
    channel: varchar('channel', { length: 20 }).$type<'WHATSAPP' | 'SMS' | 'EMAIL' | 'INSTAGRAM'>(),
    createdBy: integer('created_by').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [index('idx_crm_canned_responses_tenant').on(t.tenantId, t.channel)]
);

// ─── Campaign Templates (CP-4) ──────────────────────────────────────────────
// Reusable, versioned campaign message templates — distinct from notificationTemplates (which
// backs transactional event notifications, not campaign broadcast authoring).
export const campaignTemplates = pgTable(
  'campaign_templates',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    tenantId: integer('tenant_id').notNull(),
    name: varchar('name', { length: 200 }).notNull(),
    category: varchar('category', { length: 50 }),
    campaignType: varchar('campaign_type', { length: 50 }),
    channel: varchar('channel', { length: 20 })
      .notNull()
      .$type<'SMS' | 'WHATSAPP' | 'EMAIL' | 'IN_APP'>(),
    messageTemplate: text('message_template').notNull(),
    createdBy: integer('created_by').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
    version: integer('version').notNull().default(0),
  },
  (t) => [index('idx_campaign_templates_tenant').on(t.tenantId, t.channel)]
);

// ─── Campaign Template Translations (CRM-ROADMAP Phase 3, Feature 5) ───────────────
// A saved template's messageTemplate column (above) is its default/untranslated content — this
// table adds OPTIONAL per-language variants on top of it. A template with zero rows here behaves
// exactly as before (send() uses the base messageTemplate for every recipient), so this is
// additive, not a breaking change to the existing 1-template-1-message model.
export const crmCampaignTemplateTranslations = pgTable(
  'crm_campaign_template_translations',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    tenantId: integer('tenant_id').notNull(),
    templateId: integer('template_id').notNull(),
    // BCP-47-ish tag (e.g. 'hi', 'ta', 'en') — not an enum, since a tenant may serve any
    // regional language and this codebase has no fixed language list anywhere.
    language: varchar('language', { length: 10 }).notNull(),
    messageTemplate: text('message_template').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    unique('crm_campaign_template_translations_unique').on(t.templateId, t.language),
    index('idx_crm_campaign_template_translations_template').on(t.templateId, t.tenantId),
  ]
);

// ─── Campaign History (CP-4) ────────────────────────────────────────────────
// Lifecycle/edit audit trail — who did what to a campaign, when, and (for edits) a diff of what
// changed.
export const campaignHistory = pgTable(
  'campaign_history',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    tenantId: integer('tenant_id').notNull(),
    campaignId: integer('campaign_id').notNull(),
    actorId: integer('actor_id').notNull(),
    action: varchar('action', { length: 30 }).notNull(),
    fromStatus: varchar('from_status', { length: 20 }),
    toStatus: varchar('to_status', { length: 20 }),
    diff: jsonb('diff').$type<Record<string, unknown>>(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [index('idx_campaign_history_campaign').on(t.campaignId, t.createdAt)]
);

// ─── Tenant Communication Settings (CP-5) ───────────────────────────────────
// This phase only populates/enforces frequencyCap; businessHours/quietHours columns exist
// (nullable) for a later phase to populate without another migration (SH-07/SH-08, deferred).
export const tenantCommunicationSettings = pgTable(
  'tenant_communication_settings',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    tenantId: integer('tenant_id').notNull(),
    frequencyCap: jsonb('frequency_cap').$type<{ maxPerDay?: number }>(),
    businessHours: jsonb('business_hours').$type<{ startHour: number; endHour: number }>(),
    quietHours: jsonb('quiet_hours').$type<{ startHour: number; endHour: number }>(),
    // CP-7: optional per-tenant approval gate — false (default) preserves today's direct-send
    // behavior exactly.
    approvalRequired: boolean('approval_required').notNull().default(false),
    // CP-9 follow-up: per-tenant override of notification-service's default 200/min internal
    // send rate limit — null means "use the platform default", so every tenant that hasn't
    // explicitly configured one sees no behavior change.
    notificationRateLimitPerMinute: integer('notification_rate_limit_per_minute'),
    // CRM-ROADMAP Phase 3, Feature 3 (Campaign ROI & Attribution Reporting) — per-message cost
    // rate per channel, used to compute a campaign's spend (sentCount × rate) at report time —
    // no cost/spend concept existed anywhere in this codebase before this feature. Null/missing
    // channel keys default to 0 (an unconfigured tenant sees $0 spend, not an error), so this is
    // additive and opt-in.
    costPerMessage:
      jsonb('cost_per_message').$type<
        Partial<Record<'SMS' | 'WHATSAPP' | 'EMAIL' | 'IN_APP', number | undefined>>
      >(),
    // Product audit 2026-07-31, Phase 1 Step 10: opt-in gate for the invoice payment-reminder
    // ladder, same "false preserves today's behavior exactly" convention as approvalRequired
    // above — sends real customer-facing messages, so a tenant must explicitly turn it on.
    paymentReminderEnabled: boolean('payment_reminder_enabled').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [unique('tenant_communication_settings_tenant_unique').on(t.tenantId)]
);

// ─── Campaign Comments (CP-7) ────────────────────────────────────────────────
// Internal notes — never sent to recipients.
export const campaignComments = pgTable(
  'campaign_comments',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    tenantId: integer('tenant_id').notNull(),
    campaignId: integer('campaign_id').notNull(),
    authorId: integer('author_id').notNull(),
    body: text('body').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [index('idx_campaign_comments_campaign').on(t.campaignId, t.createdAt)]
);

// ─── Customer Communication Preferences (CP-7) ──────────────────────────────
// More granular consent model than the existing binary customers.opt_out_sms/whatsapp/email
// flags, which remain the fast-path enforcement gate and are NOT replaced by this table.
export const customerCommunicationPreferences = pgTable(
  'customer_communication_preferences',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    tenantId: integer('tenant_id').notNull(),
    customerId: integer('customer_id').notNull(),
    channel: varchar('channel', { length: 20 })
      .notNull()
      .$type<'SMS' | 'WHATSAPP' | 'EMAIL' | 'IN_APP'>(),
    category: varchar('category', { length: 20 })
      .notNull()
      .$type<'PROMOTIONAL' | 'TRANSACTIONAL'>(),
    consented: boolean('consented').notNull().default(true),
    consentSource: varchar('consent_source', { length: 30 }),
    consentRecordedAt: timestamp('consent_recorded_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [unique('customer_comm_prefs_unique').on(t.tenantId, t.customerId, t.channel, t.category)]
);

// ─── Customer Portal Accounts (CRM-ROADMAP Phase 3, Feature 2 — Self-Service Portal) ───
// Staff-provisioned (POST /customers/:id/portal-account), not self-registered — see
// portal-auth.routes.ts. One account per customer per tenant. Deliberately separate from
// `users` — a portal account is never a staff identity and must never be assignable a `roles`
// value other than `CUSTOMER` (enforced at the JWT-issuing route, not here).
export const crmPortalAccounts = pgTable(
  'crm_portal_accounts',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    tenantId: integer('tenant_id').notNull(),
    customerId: integer('customer_id').notNull(),
    email: varchar('email', { length: 320 }).notNull(),
    passwordHash: varchar('password_hash', { length: 200 }).notNull(),
    isActive: boolean('is_active').notNull().default(true),
    mustResetPassword: boolean('must_reset_password').notNull().default(true),
    lastLoginAt: timestamp('last_login_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    unique('crm_portal_accounts_customer_unique').on(t.tenantId, t.customerId),
    index('idx_crm_portal_accounts_email').on(t.tenantId, t.email),
  ]
);

// Mirrors auth.ts's refreshTokens shape exactly, but scoped to portalAccountId and issued
// under a distinct `portal_refresh_token` cookie name (portal-auth.routes.ts) so a staff and
// a portal refresh token can never be confused or replayed against the wrong table.
export const crmPortalRefreshTokens = pgTable(
  'crm_portal_refresh_tokens',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    portalAccountId: integer('portal_account_id').notNull(),
    tenantId: integer('tenant_id').notNull(),
    tokenHash: varchar('token_hash', { length: 64 }).notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    unique('crm_portal_refresh_tokens_hash').on(t.tokenHash),
    index('idx_crm_portal_refresh_tokens_account').on(t.portalAccountId, t.tenantId),
  ]
);

// Mirrors auth.ts's passwordResetTokens shape; serves both the initial staff-sent invite
// (set-password) and any future self-service reset request.
export const crmPortalPasswordTokens = pgTable(
  'crm_portal_password_tokens',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    portalAccountId: integer('portal_account_id').notNull(),
    tenantId: integer('tenant_id').notNull(),
    tokenHash: varchar('token_hash', { length: 64 }).notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    usedAt: timestamp('used_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    unique('crm_portal_password_tokens_hash').on(t.tokenHash),
    index('idx_crm_portal_password_tokens_account').on(t.portalAccountId, t.tenantId),
  ]
);

// ─── Campaign Automation Rules (CP-5) ───────────────────────────────────────
// Trigger-based automation — each enabled rule is evaluated by a scheduler-service cron job,
// which creates a real campaign row per firing (same CampaignService.send() path as a manual
// campaign) rather than sending outside the campaigns table.
export const campaignAutomationRules = pgTable(
  'campaign_automation_rules',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    tenantId: integer('tenant_id').notNull(),
    triggerType: varchar('trigger_type', { length: 50 })
      .notNull()
      .$type<'BIRTHDAY' | 'INACTIVITY' | 'ANNIVERSARY'>(),
    enabled: boolean('enabled').notNull().default(true),
    channel: varchar('channel', { length: 20 })
      .notNull()
      .$type<'SMS' | 'WHATSAPP' | 'EMAIL' | 'IN_APP'>(),
    templateId: integer('template_id'),
    messageTemplate: text('message_template'),
    conditions: jsonb('conditions').$type<Record<string, unknown>>(),
    lastFiredAt: timestamp('last_fired_at', { withTimezone: true }),
    createdBy: integer('created_by').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
    version: integer('version').notNull().default(0),
  },
  (t) => [index('idx_campaign_automation_rules_tenant').on(t.tenantId, t.enabled, t.triggerType)]
);

// ─── Tenant Sender Identity (CP-8) ──────────────────────────────────────────
// Per-tenant/per-channel sender identity — falls back to the env-configured global default
// (MSG91/SendGrid/Meta credentials) when a tenant has not configured one for a given channel.
export const tenantSenderIdentity = pgTable(
  'tenant_sender_identity',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    tenantId: integer('tenant_id').notNull(),
    channel: varchar('channel', { length: 20 })
      .notNull()
      .$type<'SMS' | 'WHATSAPP' | 'EMAIL' | 'IN_APP' | 'INSTAGRAM'>(),
    senderName: varchar('sender_name', { length: 200 }).notNull(),
    senderAddressOrNumber: varchar('sender_address_or_number', { length: 200 }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [unique('tenant_sender_identity_unique').on(t.tenantId, t.channel)]
);

// ─── Webhook Subscriptions + Deliveries (CP-8, generalized beyond campaigns) ────────
// Outbound webhooks for third-party tools — originally campaign-only (CAMPAIGN_SENT,
// CAMPAIGN_CANCELLED), generalized to any aggregate type (invoice, payment, campaign, ...)
// so tenants can subscribe to broader business events. See
// WebhookDispatchService/WebhookDispatchWorker.
export const webhookSubscriptions = pgTable(
  'webhook_subscriptions',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    tenantId: integer('tenant_id').notNull(),
    targetUrl: text('target_url').notNull(),
    events: jsonb('events').$type<string[]>().notNull(),
    secret: varchar('secret', { length: 200 }).notNull(),
    isActive: boolean('is_active').notNull().default(true),
    createdBy: integer('created_by').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [index('idx_webhook_subscriptions_tenant').on(t.tenantId, t.isActive)]
);

export const webhookDeliveries = pgTable(
  'webhook_deliveries',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    tenantId: integer('tenant_id').notNull(),
    subscriptionId: integer('subscription_id').notNull(),
    eventType: varchar('event_type', { length: 50 }).notNull(),
    aggregateType: varchar('aggregate_type', { length: 50 }).notNull(),
    aggregateId: integer('aggregate_id').notNull(),
    payload: jsonb('payload').$type<Record<string, unknown>>().notNull(),
    status: varchar('status', { length: 20 })
      .notNull()
      .default('PENDING')
      .$type<'PENDING' | 'SENT' | 'FAILED'>(),
    attemptCount: integer('attempt_count').notNull().default(0),
    lastError: text('last_error'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    sentAt: timestamp('sent_at', { withTimezone: true }),
  },
  (t) => [index('idx_webhook_deliveries_status').on(t.status, t.createdAt)]
);

// ─── Business Seasons — Festival Planner (M9.7) ────────────────────────────
export const businessSeasons = pgTable(
  'business_seasons',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    tenantId: integer('tenant_id').notNull(),
    name: varchar('name', { length: 200 }).notNull(),
    seasonType: varchar('season_type', { length: 30 })
      .notNull()
      .$type<
        | 'FESTIVAL_SEASON'
        | 'WEDDING_SEASON'
        | 'SUMMER_COLLECTION'
        | 'YEAR_END_SALE'
        | 'MONSOON_STOCKUP'
        | 'HARVEST_SEASON'
      >(),
    startDate: timestamp('start_date', { withTimezone: true }).notNull(),
    endDate: timestamp('end_date', { withTimezone: true }).notNull(),
    stockMultiplier: decimal('stock_multiplier', { precision: 5, scale: 2 }).notNull().default('1'),
    loyaltyMultiplier: decimal('loyalty_multiplier', { precision: 5, scale: 2 })
      .notNull()
      .default('1'),
    salesTarget: decimal('sales_target', { precision: 15, scale: 2 }).notNull().default('0'),
    activeDiscountRuleIds: jsonb('active_discount_rule_ids').$type<number[]>().default([]),
    isActive: boolean('is_active').notNull().default(true),
    createdBy: integer('created_by').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
    version: integer('version').notNull().default(0),
  },
  (t) => [
    index('idx_business_seasons_tenant_active').on(t.tenantId, t.isActive, t.startDate, t.endDate),
  ]
);

// ─── CRM Festival Suggestions (CRM-ROADMAP Phase 4, Feature 3 — Festival Intelligence AI) ──
// Statistical, not ML/vendor (same discipline as crmChurnPredictions) — a nightly job compares
// last year's same-seasonType businessSeasons window's invoice volume against the 30 days
// immediately before it, and suggests next year's multipliers/dates from that. Never
// auto-applied: a suggestion only becomes a real businessSeasons row when a merchandiser
// approves it (see FestivalIntelligenceService.approve). suggestedStockMultiplier/
// suggestedLoyaltyMultiplier/suggestedStartDate/suggestedEndDate are all nullable — null
// exactly when status is INSUFFICIENT_DATA, same "a number next to 'not enough data' implies
// false confidence" reasoning as crmChurnPredictions.riskScore.
export const crmFestivalSuggestions = pgTable(
  'crm_festival_suggestions',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    tenantId: integer('tenant_id').notNull(),
    seasonType: varchar('season_type', { length: 30 })
      .notNull()
      .$type<
        | 'FESTIVAL_SEASON'
        | 'WEDDING_SEASON'
        | 'SUMMER_COLLECTION'
        | 'YEAR_END_SALE'
        | 'MONSOON_STOCKUP'
        | 'HARVEST_SEASON'
      >(),
    // The year this suggestion proposes a season FOR (not the year it was computed in).
    suggestedYear: integer('suggested_year').notNull(),
    status: varchar('status', { length: 20 })
      .notNull()
      .default('PENDING')
      .$type<'PENDING' | 'APPROVED' | 'REJECTED' | 'INSUFFICIENT_DATA'>(),
    suggestedStartDate: timestamp('suggested_start_date', { withTimezone: true }),
    suggestedEndDate: timestamp('suggested_end_date', { withTimezone: true }),
    suggestedStockMultiplier: decimal('suggested_stock_multiplier', { precision: 5, scale: 2 }),
    suggestedLoyaltyMultiplier: decimal('suggested_loyalty_multiplier', { precision: 5, scale: 2 }),
    // Informational basis for the suggestion — always non-empty, same "every prediction ships
    // with a specific explanation string" DoD requirement as crmChurnPredictions.reason.
    reason: text('reason').notNull(),
    priorYearOrderCount: integer('prior_year_order_count'),
    priorYearRevenue: decimal('prior_year_revenue', { precision: 15, scale: 2 }),
    reviewedBy: integer('reviewed_by'),
    reviewedAt: timestamp('reviewed_at', { withTimezone: true }),
    // Set only once this suggestion is approved and a real businessSeasons row is created from
    // it — lets the UI link a reviewed suggestion back to the season it produced.
    createdSeasonId: integer('created_season_id'),
    computedAt: timestamp('computed_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    unique('crm_festival_suggestions_unique').on(t.tenantId, t.seasonType, t.suggestedYear),
    index('idx_crm_festival_suggestions_tenant').on(t.tenantId, t.status),
  ]
);

// ─── Field Sales / Distributor CRM (CRM-ROADMAP Phase 4, Feature 1) ───────────────────────
// Route planning + GPS check-in/out visit logging for reps covering physical territory.
// `crmVisitRoutes`/`crmVisitRouteStops` are the planned side (a distribution manager lays out a
// rep's stops for a day); `crmFieldVisits` is the actual-visit log a rep produces, optionally
// linked back to a planned stop but also valid standalone (an unplanned/ad-hoc visit is a real,
// supported case — same "not every write needs a parent plan" reasoning as crmLeads existing
// without a campaign). `clientOperationId` + the tenant-scoped unique constraint below is the
// exact idempotency mechanism this codebase already uses for offline-created records
// (invoices/payments/customers) — reused as-is, not reinvented, per this feature's own spec.
export const crmVisitRoutes = pgTable(
  'crm_visit_routes',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    tenantId: integer('tenant_id').notNull(),
    name: varchar('name', { length: 200 }).notNull(),
    assignedTo: integer('assigned_to').notNull(),
    territoryId: integer('territory_id'),
    scheduledDate: timestamp('scheduled_date', { withTimezone: true }).notNull(),
    status: varchar('status', { length: 20 })
      .notNull()
      .default('PLANNED')
      .$type<'PLANNED' | 'IN_PROGRESS' | 'COMPLETED'>(),
    createdBy: integer('created_by').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
    version: integer('version').notNull().default(0),
  },
  (t) => [index('idx_crm_visit_routes_tenant').on(t.tenantId, t.assignedTo, t.scheduledDate)]
);

export const crmVisitRouteStops = pgTable(
  'crm_visit_route_stops',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    tenantId: integer('tenant_id').notNull(),
    routeId: integer('route_id').notNull(),
    customerId: integer('customer_id').notNull(),
    sequenceNumber: integer('sequence_number').notNull(),
    status: varchar('status', { length: 20 })
      .notNull()
      .default('PENDING')
      .$type<'PENDING' | 'VISITED' | 'SKIPPED'>(),
    // Set once a crmFieldVisits row is logged against this stop — lets the route-progress view
    // resolve straight to the visit record without a reverse lookup.
    visitId: integer('visit_id'),
  },
  (t) => [index('idx_crm_visit_route_stops_route').on(t.routeId, t.tenantId)]
);

export const crmFieldVisits = pgTable(
  'crm_field_visits',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    tenantId: integer('tenant_id').notNull(),
    repUserId: integer('rep_user_id').notNull(),
    customerId: integer('customer_id').notNull(),
    routeStopId: integer('route_stop_id'),
    checkInAt: timestamp('check_in_at', { withTimezone: true }).notNull().defaultNow(),
    checkInLat: decimal('check_in_lat', { precision: 9, scale: 6 }),
    checkInLng: decimal('check_in_lng', { precision: 9, scale: 6 }),
    checkOutAt: timestamp('check_out_at', { withTimezone: true }),
    checkOutLat: decimal('check_out_lat', { precision: 9, scale: 6 }),
    checkOutLng: decimal('check_out_lng', { precision: 9, scale: 6 }),
    outcome: varchar('outcome', { length: 20 }).$type<'COMPLETED' | 'NO_CONTACT' | 'RESCHEDULED'>(),
    notes: text('notes'),
    // Offline-created-record idempotency key (OFFLINE-02/05 pattern) — a rep's device generates
    // this once per check-in attempt and retries the same value on every reconnect-triggered
    // resend, so a flaky connection can never double-log the same visit.
    clientOperationId: varchar('client_operation_id', { length: 100 }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    unique('crm_field_visits_tenant_client_operation_id').on(t.tenantId, t.clientOperationId),
    index('idx_crm_field_visits_rep').on(t.tenantId, t.repUserId, t.checkInAt),
    index('idx_crm_field_visits_customer').on(t.customerId, t.tenantId),
  ]
);

// ─── CRM Call Logs (CRM-ROADMAP Phase 4, Feature 7 — CTI / Call Center Integration) ───────
// A dedicated table rather than overloading `customer_interactions` (the roadmap's own spec
// names it as an option — free-text `notes`, no duration/recording/disposition columns) or
// `crmConversations` (channel is a closed WHATSAPP|SMS|EMAIL union with no call-shaped fields
// either) — neither existing table has the call-specific columns (duration, from/to number,
// disposition, recording) this feature actually needs, and bolting them onto either would widen
// an unrelated table for a single feature's sake.
export const crmCallLogs = pgTable(
  'crm_call_logs',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    tenantId: integer('tenant_id').notNull(),
    customerId: integer('customer_id'),
    repUserId: integer('rep_user_id').notNull(),
    direction: varchar('direction', { length: 10 }).notNull().$type<'INBOUND' | 'OUTBOUND'>(),
    fromNumber: varchar('from_number', { length: 20 }).notNull(),
    toNumber: varchar('to_number', { length: 20 }).notNull(),
    // Twilio's own Call SID — the natural idempotency/lookup key for every status-callback and
    // recording webhook that follows the initial call creation.
    twilioCallSid: varchar('twilio_call_sid', { length: 64 }).notNull(),
    status: varchar('status', { length: 20 })
      .notNull()
      .default('INITIATED')
      .$type<
        | 'INITIATED'
        | 'RINGING'
        | 'IN_PROGRESS'
        | 'COMPLETED'
        | 'NO_ANSWER'
        | 'BUSY'
        | 'FAILED'
        | 'CANCELED'
      >(),
    durationSeconds: integer('duration_seconds'),
    // Null unless the tenant has explicitly opted into call recording (see
    // crmCommunicationSettings-style per-tenant config) — recording is off by default; storing a
    // URL at all implies consent was already handled by the tenant's own IVR/disclosure, not
    // something this feature decides on its own (flagged in the completion report as a legal/
    // compliance question outside engineering's remit).
    recordingUrl: text('recording_url'),
    recordingConsentConfirmed: boolean('recording_consent_confirmed').notNull().default(false),
    notes: text('notes'),
    startedAt: timestamp('started_at', { withTimezone: true }).defaultNow().notNull(),
    endedAt: timestamp('ended_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    unique('crm_call_logs_tenant_twilio_sid').on(t.tenantId, t.twilioCallSid),
    index('idx_crm_call_logs_customer').on(t.customerId, t.tenantId),
    index('idx_crm_call_logs_rep').on(t.repUserId, t.tenantId, t.startedAt),
  ]
);

// ─── WhatsApp Commerce Orders (CRM-ROADMAP Phase 4, Feature 2) ────────────────────────────
// Tracks every WhatsApp Business Commerce order webhook received, whether it successfully
// became a real Quotation or was rejected — a rejected row is kept (not silently dropped) so
// staff can see why a customer's WhatsApp order never turned into a quote (unknown product,
// price drift since the catalog was last synced, etc.), per this feature's own "reconcile or
// reject, never silently honor a stale price" edge case.
export const crmWhatsappCatalogOrders = pgTable(
  'crm_whatsapp_catalog_orders',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    tenantId: integer('tenant_id').notNull(),
    customerId: integer('customer_id'),
    waOrderMessageId: varchar('wa_order_message_id', { length: 100 }).notNull(),
    catalogId: varchar('catalog_id', { length: 100 }),
    status: varchar('status', { length: 20 }).notNull().$type<'CREATED' | 'REJECTED'>(),
    rejectionReason: text('rejection_reason'),
    quotationId: integer('quotation_id'),
    rawPayload: jsonb('raw_payload').notNull().default({}),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    unique('crm_whatsapp_catalog_orders_tenant_msg').on(t.tenantId, t.waOrderMessageId),
    index('idx_crm_whatsapp_catalog_orders_customer').on(t.customerId, t.tenantId),
  ]
);

// ─── CRM API Keys (CRM-ROADMAP Phase 4, Feature 8 — Public CRM API & BI Export) ───────────
// A third auth mechanism alongside staff JWTs and the CUSTOMER-role portal JWT (Phase 3,
// Feature 2) — a per-tenant, per-key credential for external BI/integration tools reading
// read-mostly CRM data. Only `keyHash` is ever stored, same discipline as password storage;
// the raw key is shown to the caller exactly once at creation time and is never retrievable
// again. `keyPrefix` (a short, non-secret slice of the raw key) lets the management UI show
// "which key is this" in a list without re-exposing the secret.
export const crmApiKeys = pgTable(
  'crm_api_keys',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    tenantId: integer('tenant_id').notNull(),
    name: varchar('name', { length: 200 }).notNull(),
    keyPrefix: varchar('key_prefix', { length: 20 }).notNull(),
    keyHash: varchar('key_hash', { length: 64 }).notNull(),
    // Scope strings of the form '<entity>:read', e.g. 'leads:read'. Read-only by design —
    // the roadmap's own spec for this feature is "read-mostly CRM data", and this pass ships
    // no write scopes at all (see completion report's deferred-items list).
    scopes: jsonb('scopes').notNull().default([]),
    isActive: boolean('is_active').notNull().default(true),
    lastUsedAt: timestamp('last_used_at', { withTimezone: true }),
    expiresAt: timestamp('expires_at', { withTimezone: true }),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    revokedBy: integer('revoked_by'),
    createdBy: integer('created_by').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    unique('crm_api_keys_hash_unique').on(t.keyHash),
    index('idx_crm_api_keys_tenant').on(t.tenantId, t.isActive),
  ]
);

// ─── CRM Accounts (CRM-ROADMAP Phase 1, Feature 1 — Contact & Account Hierarchy) ───
// Models a B2B customer as an "account" (the company/entity) that can have multiple
// `customers` rows and multiple `crm_account_contacts` (the people) attached to it.
// `customers` stays the transactional entity (orders/invoices/balances key off
// customerId, unchanged) — an account is purely a grouping/relationship layer on top,
// per 02-ARCHITECTURE-RECOMMENDATIONS.md's decision to keep CRM inside sales-service.
export const crmAccounts = pgTable(
  'crm_accounts',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    tenantId: integer('tenant_id').notNull(),
    name: varchar('name', { length: 300 }).notNull(),
    accountType: varchar('account_type', { length: 20 })
      .notNull()
      .default('INDIVIDUAL')
      .$type<'B2B' | 'WHOLESALE' | 'DISTRIBUTOR' | 'CORPORATE' | 'INDIVIDUAL'>(),
    // Same encrypted-field + hash-for-search convention as customers.gstin/gstinHash.
    gstin: text('gstin'),
    gstinHash: varchar('gstin_hash', { length: 64 }),
    primaryPhone: varchar('primary_phone', { length: 20 }),
    primaryEmail: varchar('primary_email', { length: 255 }),
    billingAddress: jsonb('billing_address').$type<{
      line1: string;
      line2?: string;
      city: string;
      state: string;
      stateCode: string;
      pincode: string;
      country: string;
    }>(),
    // True for the personal account created lazily for a single POS/retail customer that
    // later takes a B2B-relevant action — never backfilled in bulk for existing customers.
    isImplicit: boolean('is_implicit').notNull().default(false),
    // Set when this account was merged away — kept (not deleted) for traceability; the
    // account's own row is excluded from normal list/search views once set.
    mergedIntoAccountId: integer('merged_into_account_id'),
    notes: text('notes'),
    // CRM-ROADMAP Phase 1, Feature 7 (Data Import/Dedupe/Merge Tooling) — set only for rows
    // created by a CSV import job (scheduler-service's import_jobs.id); null for every
    // interactively-created account. Exists solely so a rolled-back import can delete exactly
    // the rows it created, per that feature's DoD requirement — not a general-purpose FK.
    importBatchId: integer('import_batch_id'),
    createdBy: integer('created_by').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
    version: integer('version').notNull().default(0),
  },
  (t) => [
    index('idx_crm_accounts_tenant').on(t.tenantId, t.mergedIntoAccountId),
    index('idx_crm_accounts_gstin_hash').on(t.gstinHash),
    index('idx_crm_accounts_phone').on(t.primaryPhone, t.tenantId),
    index('idx_crm_accounts_email').on(t.primaryEmail, t.tenantId),
    index('idx_crm_accounts_import_batch').on(t.importBatchId, t.tenantId),
  ]
);

// Contacts (people) attached to an account — a B2B account can have several, each with a
// role (Billing/Decision Maker/Shipping/...). The role set is a small fixed vocabulary
// (mirrors how customerSegments' "system" segments are just codes, not a separate
// manageable table) rather than a tenant-configurable crm_contact_roles catalog — nothing
// in this feature's acceptance criteria requires tenants to define custom role types, so a
// separate lookup table would be unused configurability.
export const crmAccountContacts = pgTable(
  'crm_account_contacts',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    tenantId: integer('tenant_id').notNull(),
    accountId: integer('account_id').notNull(),
    name: varchar('name', { length: 200 }).notNull(),
    role: varchar('role', { length: 30 })
      .notNull()
      .default('OTHER')
      .$type<'BILLING' | 'DECISION_MAKER' | 'SHIPPING' | 'PRIMARY' | 'OTHER'>(),
    // Both nullable — a name-only stakeholder record (no email/phone) is a legitimate
    // contact for many wholesale relationships (Phase 1 spec's stated edge case).
    email: varchar('email', { length: 255 }),
    phone: varchar('phone', { length: 20 }),
    isPrimary: boolean('is_primary').notNull().default(false),
    lastContactedAt: timestamp('last_contacted_at', { withTimezone: true }),
    notes: text('notes'),
    createdBy: integer('created_by').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
    version: integer('version').notNull().default(0),
  },
  (t) => [index('idx_crm_account_contacts_account').on(t.accountId, t.tenantId)]
);

// ─── CRM Leads (CRM-ROADMAP Phase 1, Feature 2 — Lead Management & Capture) ────────
// Pre-purchase interest, captured before a Customer exists. `POST /leads/capture` (public,
// unauthenticated) is the only write path that can leave `createdBy` null — every
// staff-created lead has one. `source`/`stage` are small fixed vocabularies (same
// no-separate-lookup-table reasoning as crm_account_contacts.role above), not
// tenant-configurable catalogs — nothing in this feature requires that.
export const crmLeads = pgTable(
  'crm_leads',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    tenantId: integer('tenant_id').notNull(),
    // Nullable — a capture with only a phone number (no name) is still a valid lead
    // (Phase 1 spec's stated edge case).
    displayName: varchar('display_name', { length: 200 }),
    companyName: varchar('company_name', { length: 300 }),
    phone: varchar('phone', { length: 20 }).notNull(),
    email: varchar('email', { length: 255 }),
    source: varchar('source', { length: 20 })
      .notNull()
      .default('OTHER')
      .$type<
        | 'WEBSITE'
        | 'REFERRAL'
        | 'WALK_IN'
        | 'SOCIAL_MEDIA'
        | 'ADVERTISEMENT'
        | 'PHONE_INQUIRY'
        | 'OTHER'
      >(),
    stage: varchar('stage', { length: 20 })
      .notNull()
      .default('NEW')
      .$type<'NEW' | 'CONTACTED' | 'QUALIFIED' | 'CONVERTED' | 'LOST'>(),
    assignedTo: integer('assigned_to'),
    // AR-6: real branch scoping from day one (crm_leads is one of the three tables that
    // decision names explicitly) — nullable because a public capture has no branch context
    // until a rep qualifies it.
    branchId: integer('branch_id'),
    isB2b: boolean('is_b2b').notNull().default(false),
    convertedCustomerId: integer('converted_customer_id'),
    convertedAccountId: integer('converted_account_id'),
    convertedAt: timestamp('converted_at', { withTimezone: true }),
    lostReason: text('lost_reason'),
    notes: text('notes'),
    // CRM-ROADMAP Phase 1, Feature 7 — same batch-tagging rationale as crmAccounts.importBatchId
    // above; null for every non-import-created lead (including public capture).
    importBatchId: integer('import_batch_id'),
    createdBy: integer('created_by'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
    version: integer('version').notNull().default(0),
  },
  (t) => [
    // Kanban board query, rep's own-leads filter (07-PERFORMANCE-PLAN.md §2).
    index('idx_crm_leads_tenant_stage').on(t.tenantId, t.stage, t.assignedTo),
    // Funnel/velocity reporting.
    index('idx_crm_leads_tenant_created').on(t.tenantId, t.createdAt),
    // Duplicate-lead detection at capture time (indexed lookup, not a full scan).
    index('idx_crm_leads_phone').on(t.phone, t.tenantId),
    index('idx_crm_leads_import_batch').on(t.importBatchId, t.tenantId),
  ]
);

export const crmLeadActivities = pgTable(
  'crm_lead_activities',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    tenantId: integer('tenant_id').notNull(),
    leadId: integer('lead_id').notNull(),
    activityType: varchar('activity_type', { length: 20 })
      .notNull()
      .$type<'STAGE_CHANGE' | 'NOTE' | 'CALL' | 'EMAIL' | 'ASSIGNMENT'>(),
    description: text('description'),
    fromStage: varchar('from_stage', { length: 20 }),
    toStage: varchar('to_stage', { length: 20 }),
    // Null for system-generated entries (e.g. the initial capture itself).
    actorId: integer('actor_id'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [index('idx_crm_lead_activities_lead').on(t.leadId, t.createdAt)]
);

// Round-robin/load-based lead routing. One or more rules per tenant; a rule may optionally
// scope to a branch (null = tenant-wide fallback). `lastAssignedIndex` is the round-robin
// cursor into `assigneeUserIds`, advanced atomically per assignment.
export const crmAssignmentRules = pgTable(
  'crm_assignment_rules',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    tenantId: integer('tenant_id').notNull(),
    name: varchar('name', { length: 200 }).notNull(),
    strategy: varchar('strategy', { length: 20 })
      .notNull()
      .default('ROUND_ROBIN')
      .$type<'ROUND_ROBIN' | 'LOAD_BALANCED'>(),
    assigneeUserIds: jsonb('assignee_user_ids').$type<number[]>().notNull().default([]),
    branchId: integer('branch_id'),
    // CRM-ROADMAP Phase 4, Feature 4 (Territory Management): an alternative, coarser scope to
    // branchId — a rule can target every branch inside a territory instead of one specific
    // branch. Resolution order in LeadService.autoAssign is exact-branch > territory > tenant-
    // wide null fallback (most-specific-match-wins, same precedent as TicketService.
    // resolveSlaHours). Nullable/independent of branchId — a rule sets at most one of the two.
    territoryId: integer('territory_id'),
    isActive: boolean('is_active').notNull().default(true),
    lastAssignedIndex: integer('last_assigned_index').notNull().default(-1),
    createdBy: integer('created_by').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
    version: integer('version').notNull().default(0),
  },
  (t) => [
    index('idx_crm_assignment_rules_tenant').on(t.tenantId, t.isActive, t.branchId),
    index('idx_crm_assignment_rules_territory').on(t.tenantId, t.isActive, t.territoryId),
  ]
);

// ─── CRM Territories (CRM-ROADMAP Phase 4, Feature 4 — Territory Management) ───────────────
// A territory groups one or more branches into a named region/vertical for reps and quotas to
// be assigned against, on top of (never replacing) the existing single-dimension branch
// scoping (AR-6). Two join tables below express the many-to-many membership: a territory can
// span or subdivide branches, and a rep can belong to more than one territory (their effective
// scope is the UNION of every territory's branches — see TerritoryService.getTerritoryScope —
// not a conflict to resolve, since scope is computed as a set, not a single winning rule).
export const crmTerritories = pgTable(
  'crm_territories',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    tenantId: integer('tenant_id').notNull(),
    name: varchar('name', { length: 200 }).notNull(),
    description: text('description'),
    isActive: boolean('is_active').notNull().default(true),
    createdBy: integer('created_by').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
    version: integer('version').notNull().default(0),
  },
  (t) => [index('idx_crm_territories_tenant').on(t.tenantId, t.isActive)]
);

export const crmTerritoryBranches = pgTable(
  'crm_territory_branches',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    tenantId: integer('tenant_id').notNull(),
    territoryId: integer('territory_id').notNull(),
    branchId: integer('branch_id').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    unique('crm_territory_branches_unique').on(t.territoryId, t.branchId),
    index('idx_crm_territory_branches_territory').on(t.territoryId),
    index('idx_crm_territory_branches_branch').on(t.branchId, t.tenantId),
  ]
);

// Mirrors user_branches' shape (packages/db-client/src/schema/tenant.ts) — deliberately its own
// join table rather than overloading the JWT's branchIds claim, so territory membership can
// change without touching the auth-token payload shape every other service already depends on.
export const crmTerritoryUsers = pgTable(
  'crm_territory_users',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    tenantId: integer('tenant_id').notNull(),
    territoryId: integer('territory_id').notNull(),
    userId: integer('user_id').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    unique('crm_territory_users_unique').on(t.territoryId, t.userId),
    index('idx_crm_territory_users_territory').on(t.territoryId),
    index('idx_crm_territory_users_user').on(t.userId, t.tenantId),
  ]
);

// ─── CRM Sales Quotas (CRM-ROADMAP Phase 4, Feature 5 — Sales Forecasting & Quota
// Management) ────────────────────────────────────────────────────────────────────────
// periodYear/periodMonth (integer pair, not a date or a "2026-Q3" string) mirrors this
// codebase's existing period-closures convention (accounting.ts's periodClosures), rather than
// inventing a new period representation. Exactly one of subjectUserId/subjectTerritoryId is set,
// matching subjectType — enforced in QuotaService, not a DB CHECK constraint (this codebase has
// no DB-level FKs/CHECK constraints elsewhere either; application-level validation is the
// established convention). No "team" subjectType: no team entity exists anywhere in this
// codebase (confirmed by a dedicated grep before implementing) — a territory already serves as
// a named group of branches+reps, so a "team" quota is just a TERRITORY quota under this model.
export const crmSalesQuotas = pgTable(
  'crm_sales_quotas',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    tenantId: integer('tenant_id').notNull(),
    subjectType: varchar('subject_type', { length: 20 }).notNull().$type<'REP' | 'TERRITORY'>(),
    subjectUserId: integer('subject_user_id'),
    subjectTerritoryId: integer('subject_territory_id'),
    periodYear: integer('period_year').notNull(),
    periodMonth: integer('period_month').notNull(),
    quotaAmount: decimal('quota_amount', { precision: 15, scale: 2 }).notNull(),
    createdBy: integer('created_by').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
    version: integer('version').notNull().default(0),
  },
  (t) => [
    index('idx_crm_sales_quotas_tenant_period').on(t.tenantId, t.periodYear, t.periodMonth),
    index('idx_crm_sales_quotas_rep').on(t.subjectUserId, t.tenantId),
    index('idx_crm_sales_quotas_territory').on(t.subjectTerritoryId, t.tenantId),
  ]
);

// ─── CRM Tickets (CRM-ROADMAP Phase 1, Feature 4 — Support & Ticketing) ────────────
// Replaces the untracked `customer_interactions` COMPLAINT type with a real entity: SLA,
// status, assignment, and a message thread with an internal-vs-customer-visible split (the
// critical security/privacy boundary for this feature — see crmTicketMessages.visibility).
export const crmTickets = pgTable(
  'crm_tickets',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    tenantId: integer('tenant_id').notNull(),
    ticketNumber: varchar('ticket_number', { length: 50 }).notNull(),
    customerId: integer('customer_id').notNull(),
    subject: varchar('subject', { length: 300 }).notNull(),
    description: text('description'),
    ticketType: varchar('ticket_type', { length: 30 })
      .notNull()
      .default('OTHER')
      .$type<'COMPLAINT' | 'INQUIRY' | 'RETURN_REQUEST' | 'OTHER'>(),
    priority: varchar('priority', { length: 20 })
      .notNull()
      .default('MEDIUM')
      .$type<'LOW' | 'MEDIUM' | 'HIGH' | 'URGENT'>(),
    status: varchar('status', { length: 30 })
      .notNull()
      .default('OPEN')
      .$type<'OPEN' | 'IN_PROGRESS' | 'WAITING_ON_CUSTOMER' | 'RESOLVED' | 'CLOSED'>(),
    assignedTo: integer('assigned_to'),
    // AR-6: real branch scoping from day one — one of the three tables that decision names
    // explicitly (alongside crm_leads, crm_opportunities).
    branchId: integer('branch_id'),
    // Auto-linked to the customer's most recent order within a configurable window at
    // creation time — nullable because a general inquiry isn't necessarily order-specific
    // (Phase 1 spec's stated edge case).
    linkedInvoiceId: integer('linked_invoice_id'),
    slaDueAt: timestamp('sla_due_at', { withTimezone: true }),
    slaBreached: boolean('sla_breached').notNull().default(false),
    resolvedAt: timestamp('resolved_at', { withTimezone: true }),
    closedAt: timestamp('closed_at', { withTimezone: true }),
    // Reopening a CLOSED ticket is an explicit action (POST /tickets/:id/reopen), never
    // implicit from a new customer reply — see TicketService.reopen's own comment for why.
    reopenedCount: integer('reopened_count').notNull().default(0),
    // Nullable as of Phase 3 Feature 2 (Self-Service Portal) — a portal-created ticket has no
    // staff `users.id` author; see createdByPortalAccountId below for that case. Exactly one
    // of the two should be set going forward, but both nullable avoids a CHECK-constraint
    // migration against existing rows.
    createdBy: integer('created_by'),
    createdByPortalAccountId: integer('created_by_portal_account_id'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
    version: integer('version').notNull().default(0),
  },
  (t) => [
    // SLA-breach sweep job + inbox list (07-PERFORMANCE-PLAN.md §2) — must never be a
    // full-table scan since this runs frequently.
    index('idx_crm_tickets_status_sla').on(t.tenantId, t.status, t.slaDueAt),
    // Customer 360 timeline join (Feature 3).
    index('idx_crm_tickets_customer').on(t.tenantId, t.customerId),
  ]
);

// authorName is a denormalized snapshot at post time (not a live join to `users`) — a
// message from a since-removed employee must still render, correctly attributed, without
// depending on that user row still existing (Phase 1 spec's stated edge case).
export const crmTicketMessages = pgTable(
  'crm_ticket_messages',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    tenantId: integer('tenant_id').notNull(),
    ticketId: integer('ticket_id').notNull(),
    authorId: integer('author_id'),
    authorName: varchar('author_name', { length: 200 }).notNull(),
    visibility: varchar('visibility', { length: 20 })
      .notNull()
      .$type<'INTERNAL' | 'CUSTOMER_VISIBLE'>(),
    body: text('body').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [index('idx_crm_ticket_messages_ticket').on(t.ticketId, t.createdAt)]
);

// Matched by TicketService.resolveSlaHours — most-specific-match-wins scoring over
// ticketType/customerTier/priority (each nullable = "any"), falling back to a hardcoded
// default when no rule matches so every tenant works before configuring any rules.
export const crmTicketSlaRules = pgTable(
  'crm_ticket_sla_rules',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    tenantId: integer('tenant_id').notNull(),
    ticketType: varchar('ticket_type', { length: 30 }),
    customerTier: varchar('customer_tier', { length: 20 }),
    priority: varchar('priority', { length: 20 }),
    slaHours: integer('sla_hours').notNull(),
    isActive: boolean('is_active').notNull().default(true),
    createdBy: integer('created_by').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
    version: integer('version').notNull().default(0),
  },
  (t) => [index('idx_crm_ticket_sla_rules_tenant').on(t.tenantId, t.isActive)]
);

// One CSAT response per ticket, recorded by staff on the customer's behalf (Phase 1 has no
// customer-facing portal yet — that's Phase 3 — so this is captured over phone/in-person and
// entered by whoever closed the loop, not submitted directly by the customer).
export const crmCsatResponses = pgTable(
  'crm_csat_responses',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    tenantId: integer('tenant_id').notNull(),
    ticketId: integer('ticket_id').notNull(),
    rating: integer('rating').notNull(),
    comment: text('comment'),
    recordedBy: integer('recorded_by').notNull(),
    respondedAt: timestamp('responded_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [unique('crm_csat_responses_ticket_unique').on(t.ticketId)]
);

// ─── CRM DLT Templates (CRM-ROADMAP Phase 1, Feature 6 — DLT/TRAI SMS Compliance) ──
// Per AR-8: this table is the only new CRM-side artifact for this feature — enforcement
// itself lives in notification-service's NotificationEngine.sendSms()/sendRaw() path, gated
// against these tenant-registered templates. `messagePattern` uses DLT's own `{#var#}`
// placeholder convention (see @erp/utils' matchesDltTemplate) — this is legal/compliance
// config data (which templates a tenant has actually registered with their telecom operator),
// not something this codebase generates or auto-registers.
export const crmDltTemplates = pgTable(
  'crm_dlt_templates',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    tenantId: integer('tenant_id').notNull(),
    templateId: varchar('template_id', { length: 50 }).notNull(),
    header: varchar('header', { length: 20 }).notNull(),
    messagePattern: text('message_pattern').notNull(),
    isActive: boolean('is_active').notNull().default(true),
    // Flagged for implementation-time confirmation with the SMS provider's actual expiry
    // semantics (Phase 1 spec's stated edge case) — nullable, checked defensively if present.
    expiresAt: timestamp('expires_at', { withTimezone: true }),
    createdBy: integer('created_by').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
    version: integer('version').notNull().default(0),
  },
  (t) => [index('idx_crm_dlt_templates_tenant').on(t.tenantId, t.isActive)]
);

// ─── CRM Opportunities (CRM-ROADMAP Phase 2, Feature 1 — Sales Pipeline & Opportunity
// Management) ──────────────────────────────────────────────────────────────────────
// Tenant-configurable pipeline stages, one row per deal type (or dealType null = general
// fallback). A tenant with zero rows here isn't broken — OpportunityService falls back to a
// hardcoded default stage set, same "customization is optional, a sensible default always
// applies" convention already used for crm_ticket_sla_rules/resolveSlaHours.
export const crmPipelineStages = pgTable(
  'crm_pipeline_stages',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    tenantId: integer('tenant_id').notNull(),
    dealType: varchar('deal_type', { length: 50 }),
    code: varchar('code', { length: 30 }).notNull(),
    name: varchar('name', { length: 100 }).notNull(),
    sequence: integer('sequence').notNull(),
    // Default weighting for the forecast's "best case" band when an opportunity in this stage
    // has no override — 0-100.
    probability: integer('probability').notNull(),
    isWon: boolean('is_won').notNull().default(false),
    isLost: boolean('is_lost').notNull().default(false),
    isActive: boolean('is_active').notNull().default(true),
    createdBy: integer('created_by').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
    version: integer('version').notNull().default(0),
  },
  (t) => [
    index('idx_crm_pipeline_stages_tenant').on(t.tenantId, t.dealType, t.isActive),
    unique('crm_pipeline_stages_code_unique').on(t.tenantId, t.dealType, t.code),
  ]
);

// The deal itself. `stage` is a code, validated against either this tenant's custom
// crm_pipeline_stages rows (for its dealType) or the hardcoded default set — never a foreign
// key to crm_pipeline_stages, so a tenant using only the default set never needs a row there
// at all (same "lazy, not bulk-seeded" principle as Feature 1's implicit accounts).
export const crmOpportunities = pgTable(
  'crm_opportunities',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    tenantId: integer('tenant_id').notNull(),
    name: varchar('name', { length: 300 }).notNull(),
    dealType: varchar('deal_type', { length: 50 }),
    stage: varchar('stage', { length: 30 }).notNull().default('NEW'),
    // Denormalized at write time from the resolved stage — avoids re-resolving the tenant's
    // custom-vs-default stage set on every read just to compute a weighted forecast.
    probability: integer('probability').notNull().default(10),
    value: decimal('value', { precision: 15, scale: 2 }).notNull().default('0'),
    expectedCloseDate: timestamp('expected_close_date', { withTimezone: true }),
    customerId: integer('customer_id'),
    accountId: integer('account_id'),
    assignedTo: integer('assigned_to'),
    // AR-6 — implemented from day one, per the Phase 2 spec's explicit instruction (unlike most
    // Phase 1 tables, which retrofitted it feature-by-feature under the same AR-6 decision).
    branchId: integer('branch_id'),
    // Set only when "mark Won" auto-creates a quotation from this opportunity's line items —
    // never set any other way, so its presence is a reliable "this deal already has a
    // quotation" signal.
    convertedQuotationId: integer('converted_quotation_id'),
    wonAt: timestamp('won_at', { withTimezone: true }),
    lostAt: timestamp('lost_at', { withTimezone: true }),
    lostReason: text('lost_reason'),
    notes: text('notes'),
    createdBy: integer('created_by').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
    version: integer('version').notNull().default(0),
  },
  (t) => [
    // Pipeline board query, forecast aggregation (07-PERFORMANCE-PLAN.md §2).
    index('idx_crm_opportunities_tenant_stage').on(t.tenantId, t.stage, t.branchId),
    index('idx_crm_opportunities_close_date').on(t.tenantId, t.expectedCloseDate),
    index('idx_crm_opportunities_customer').on(t.customerId, t.tenantId),
  ]
);

// Pre-quotation forecast lines — deliberately narrower than quotationLines (no GST/HSN
// columns): those only get computed once QuotationService.create() runs at Won-time, sourced
// fresh from `items` at that point, so this stage never needs to duplicate/maintain GST state
// for a deal that might still change shape before it's ever quoted.
export const crmOpportunityLineItems = pgTable(
  'crm_opportunity_line_items',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    tenantId: integer('tenant_id').notNull(),
    opportunityId: integer('opportunity_id').notNull(),
    lineNumber: integer('line_number').notNull(),
    itemId: integer('item_id').notNull(),
    variantId: integer('variant_id'),
    quantity: decimal('quantity', { precision: 15, scale: 3 }).notNull(),
    unitId: integer('unit_id'),
    unitPrice: decimal('unit_price', { precision: 15, scale: 2 }).notNull(),
    discountPct: decimal('discount_pct', { precision: 5, scale: 2 }).notNull().default('0'),
    discountAmount: decimal('discount_amount', { precision: 15, scale: 2 }).notNull().default('0'),
    lineTotal: decimal('line_total', { precision: 15, scale: 2 }).notNull().default('0'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [index('idx_crm_opportunity_line_items_opportunity').on(t.opportunityId, t.tenantId)]
);

// Stage-change/lifecycle audit trail — mirrors crm_lead_activities' shape (this codebase's
// existing "activity log for a CRM pipeline entity" precedent) rather than campaign_history's
// generic diff-jsonb shape, since stage transitions are this entity's one structured event type.
export const crmOpportunityHistory = pgTable(
  'crm_opportunity_history',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    tenantId: integer('tenant_id').notNull(),
    opportunityId: integer('opportunity_id').notNull(),
    activityType: varchar('activity_type', { length: 20 })
      .notNull()
      .$type<'CREATED' | 'STAGE_CHANGE' | 'WON' | 'LOST' | 'UPDATED'>(),
    fromStage: varchar('from_stage', { length: 30 }),
    toStage: varchar('to_stage', { length: 30 }),
    notes: text('notes'),
    actorId: integer('actor_id'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [index('idx_crm_opportunity_history_opportunity').on(t.opportunityId, t.createdAt)]
);

// ─── Segment Membership Cache (CRM-ROADMAP Phase 2, Feature 7 — Advanced Segmentation
// Engine) ────────────────────────────────────────────────────────────────────────────
// A dynamic segment's live `customWhere()` query stays the source of truth for preview/ad-hoc
// use (SegmentService always computes it fresh there) — this table exists purely so a
// segment using an expensive behavioral/RFM operator has a nightly-refreshed, fast-to-read
// snapshot for consumers that would rather not recompute it on every read (07-PERFORMANCE-PLAN.md
// §6). Only segments whose filterDefinition uses a behavioral operator ever get rows here —
// a plain static-field segment never needs caching and never appears in this table.
export const crmSegmentMembershipCache = pgTable(
  'crm_segment_membership_cache',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    tenantId: integer('tenant_id').notNull(),
    segmentId: integer('segment_id').notNull(),
    customerId: integer('customer_id').notNull(),
    refreshedAt: timestamp('refreshed_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    unique('crm_segment_membership_cache_unique').on(t.segmentId, t.customerId),
    index('idx_crm_segment_membership_cache_segment').on(t.tenantId, t.segmentId),
  ]
);

// ─── AI & Predictive Intelligence Suite (CRM-ROADMAP Phase 3, Feature 1) ───────────
// Batch-scored nightly per tenant, never synchronously — see HealthScoringService's own
// extended doc comment. `customers.healthScore`/`healthSegment`/`scoredAt` already ARE the
// health-score cache (M9.2); this feature does not duplicate that with a parallel
// `crm_health_scores` table (AR-2) — only the 3 genuinely new prediction types get one each.
export const crmChurnPredictions = pgTable(
  'crm_churn_predictions',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    tenantId: integer('tenant_id').notNull(),
    customerId: integer('customer_id').notNull(),
    riskLevel: varchar('risk_level', { length: 20 })
      .notNull()
      .$type<'LOW' | 'MEDIUM' | 'HIGH' | 'INSUFFICIENT_DATA'>(),
    // Null when riskLevel is INSUFFICIENT_DATA — a numeric score next to "not enough data yet"
    // would misleadingly imply confidence the model doesn't have.
    riskScore: integer('risk_score'),
    // Every prediction ships with a non-empty, specific explanation string — a stated DoD
    // requirement, not optional metadata.
    reason: text('reason').notNull(),
    computedAt: timestamp('computed_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    unique('crm_churn_predictions_unique').on(t.tenantId, t.customerId),
    index('idx_crm_churn_predictions_tenant').on(t.tenantId, t.riskLevel),
  ]
);

export const crmNextBestActions = pgTable(
  'crm_next_best_actions',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    tenantId: integer('tenant_id').notNull(),
    customerId: integer('customer_id').notNull(),
    actionType: varchar('action_type', { length: 50 }).notNull(),
    actionText: text('action_text').notNull(),
    reason: text('reason').notNull(),
    // Feedback loop (POST /recommendations/:id/feedback) — a dismissed action isn't
    // re-surfaced by the next nightly run if the underlying trigger is unchanged (see
    // HealthScoringService.computeAndCachePredictions' own comment for the exact rule).
    dismissed: boolean('dismissed').notNull().default(false),
    dismissedAt: timestamp('dismissed_at', { withTimezone: true }),
    computedAt: timestamp('computed_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    unique('crm_next_best_actions_unique').on(t.tenantId, t.customerId),
    index('idx_crm_next_best_actions_tenant').on(t.tenantId, t.customerId),
  ]
);

export const crmProductRecommendations = pgTable(
  'crm_product_recommendations',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    tenantId: integer('tenant_id').notNull(),
    customerId: integer('customer_id').notNull(),
    itemId: integer('item_id').notNull(),
    reason: text('reason').notNull(),
    rank: integer('rank').notNull(),
    dismissed: boolean('dismissed').notNull().default(false),
    dismissedAt: timestamp('dismissed_at', { withTimezone: true }),
    computedAt: timestamp('computed_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    unique('crm_product_recommendations_unique').on(t.tenantId, t.customerId, t.itemId),
    index('idx_crm_product_recommendations_tenant').on(t.tenantId, t.customerId, t.rank),
  ]
);

// ─── Type Exports ──────────────────────────────────────────────────────────────
export type CustomerInteraction = typeof customerInteractions.$inferSelect;
export type NewCustomerInteraction = typeof customerInteractions.$inferInsert;
export type CustomerSegment = typeof customerSegments.$inferSelect;
export type NewCustomerSegment = typeof customerSegments.$inferInsert;
export type Campaign = typeof campaigns.$inferSelect;
export type NewCampaign = typeof campaigns.$inferInsert;
export type CampaignRecipient = typeof campaignRecipients.$inferSelect;
export type NewCampaignRecipient = typeof campaignRecipients.$inferInsert;
export type CrmCampaignVariant = typeof crmCampaignVariants.$inferSelect;
export type NewCrmCampaignVariant = typeof crmCampaignVariants.$inferInsert;
export type CrmJourney = typeof crmJourneys.$inferSelect;
export type NewCrmJourney = typeof crmJourneys.$inferInsert;
export type CrmJourneyStep = typeof crmJourneySteps.$inferSelect;
export type NewCrmJourneyStep = typeof crmJourneySteps.$inferInsert;
export type CrmJourneyEnrollment = typeof crmJourneyEnrollments.$inferSelect;
export type NewCrmJourneyEnrollment = typeof crmJourneyEnrollments.$inferInsert;
export type CrmJourneyStepEvent = typeof crmJourneyStepEvents.$inferSelect;
export type NewCrmJourneyStepEvent = typeof crmJourneyStepEvents.$inferInsert;
export type CrmLinkClick = typeof crmLinkClicks.$inferSelect;
export type NewCrmLinkClick = typeof crmLinkClicks.$inferInsert;
export type CampaignTemplate = typeof campaignTemplates.$inferSelect;
export type NewCampaignTemplate = typeof campaignTemplates.$inferInsert;
export type CrmCampaignTemplateTranslation = typeof crmCampaignTemplateTranslations.$inferSelect;
export type NewCrmCampaignTemplateTranslation = typeof crmCampaignTemplateTranslations.$inferInsert;
export type CrmCampaignMessageTranslation = typeof crmCampaignMessageTranslations.$inferSelect;
export type NewCrmCampaignMessageTranslation = typeof crmCampaignMessageTranslations.$inferInsert;
export type CampaignHistory = typeof campaignHistory.$inferSelect;
export type NewCampaignHistory = typeof campaignHistory.$inferInsert;
export type TenantCommunicationSettings = typeof tenantCommunicationSettings.$inferSelect;
export type NewTenantCommunicationSettings = typeof tenantCommunicationSettings.$inferInsert;
export type CampaignAutomationRule = typeof campaignAutomationRules.$inferSelect;
export type NewCampaignAutomationRule = typeof campaignAutomationRules.$inferInsert;
export type CampaignComment = typeof campaignComments.$inferSelect;
export type NewCampaignComment = typeof campaignComments.$inferInsert;
export type CustomerCommunicationPreference = typeof customerCommunicationPreferences.$inferSelect;
export type NewCustomerCommunicationPreference =
  typeof customerCommunicationPreferences.$inferInsert;
export type BusinessSeason = typeof businessSeasons.$inferSelect;
export type NewBusinessSeason = typeof businessSeasons.$inferInsert;
export type TenantSenderIdentity = typeof tenantSenderIdentity.$inferSelect;
export type NewTenantSenderIdentity = typeof tenantSenderIdentity.$inferInsert;
export type WebhookSubscription = typeof webhookSubscriptions.$inferSelect;
export type NewWebhookSubscription = typeof webhookSubscriptions.$inferInsert;
export type WebhookDelivery = typeof webhookDeliveries.$inferSelect;
export type NewWebhookDelivery = typeof webhookDeliveries.$inferInsert;
export type CrmAccount = typeof crmAccounts.$inferSelect;
export type NewCrmAccount = typeof crmAccounts.$inferInsert;
export type CrmAccountContact = typeof crmAccountContacts.$inferSelect;
export type NewCrmAccountContact = typeof crmAccountContacts.$inferInsert;
export type CrmLead = typeof crmLeads.$inferSelect;
export type NewCrmLead = typeof crmLeads.$inferInsert;
export type CrmLeadActivity = typeof crmLeadActivities.$inferSelect;
export type NewCrmLeadActivity = typeof crmLeadActivities.$inferInsert;
export type CrmAssignmentRule = typeof crmAssignmentRules.$inferSelect;
export type NewCrmAssignmentRule = typeof crmAssignmentRules.$inferInsert;
export type CrmTicket = typeof crmTickets.$inferSelect;
export type NewCrmTicket = typeof crmTickets.$inferInsert;
export type CrmTicketMessage = typeof crmTicketMessages.$inferSelect;
export type NewCrmTicketMessage = typeof crmTicketMessages.$inferInsert;
export type CrmTicketSlaRule = typeof crmTicketSlaRules.$inferSelect;
export type NewCrmTicketSlaRule = typeof crmTicketSlaRules.$inferInsert;
export type CrmCsatResponse = typeof crmCsatResponses.$inferSelect;
export type NewCrmCsatResponse = typeof crmCsatResponses.$inferInsert;
export type CrmDltTemplate = typeof crmDltTemplates.$inferSelect;
export type NewCrmDltTemplate = typeof crmDltTemplates.$inferInsert;
export type CrmPipelineStage = typeof crmPipelineStages.$inferSelect;
export type NewCrmPipelineStage = typeof crmPipelineStages.$inferInsert;
export type CrmOpportunity = typeof crmOpportunities.$inferSelect;
export type NewCrmOpportunity = typeof crmOpportunities.$inferInsert;
export type CrmOpportunityLineItem = typeof crmOpportunityLineItems.$inferSelect;
export type NewCrmOpportunityLineItem = typeof crmOpportunityLineItems.$inferInsert;
export type CrmOpportunityHistory = typeof crmOpportunityHistory.$inferSelect;
export type NewCrmOpportunityHistory = typeof crmOpportunityHistory.$inferInsert;
export type CrmSegmentMembershipCache = typeof crmSegmentMembershipCache.$inferSelect;
export type NewCrmSegmentMembershipCache = typeof crmSegmentMembershipCache.$inferInsert;
export type CrmLoyaltyTier = typeof crmLoyaltyTiers.$inferSelect;
export type NewCrmLoyaltyTier = typeof crmLoyaltyTiers.$inferInsert;
export type CrmRedemptionCatalogItem = typeof crmRedemptionCatalog.$inferSelect;
export type NewCrmRedemptionCatalogItem = typeof crmRedemptionCatalog.$inferInsert;
export type CrmLoyaltyRedemption = typeof crmLoyaltyRedemptions.$inferSelect;
export type NewCrmLoyaltyRedemption = typeof crmLoyaltyRedemptions.$inferInsert;
export type CrmReferralCode = typeof crmReferralCodes.$inferSelect;
export type NewCrmReferralCode = typeof crmReferralCodes.$inferInsert;
export type CrmReferralEvent = typeof crmReferralEvents.$inferSelect;
export type NewCrmReferralEvent = typeof crmReferralEvents.$inferInsert;
export type CrmReferralReward = typeof crmReferralRewards.$inferSelect;
export type NewCrmReferralReward = typeof crmReferralRewards.$inferInsert;
export type CrmConversation = typeof crmConversations.$inferSelect;
export type NewCrmConversation = typeof crmConversations.$inferInsert;
export type CrmConversationMessage = typeof crmConversationMessages.$inferSelect;
export type NewCrmConversationMessage = typeof crmConversationMessages.$inferInsert;
export type CrmCannedResponse = typeof crmCannedResponses.$inferSelect;
export type NewCrmCannedResponse = typeof crmCannedResponses.$inferInsert;
export type CrmChurnPrediction = typeof crmChurnPredictions.$inferSelect;
export type NewCrmChurnPrediction = typeof crmChurnPredictions.$inferInsert;
export type CrmNextBestAction = typeof crmNextBestActions.$inferSelect;
export type NewCrmNextBestAction = typeof crmNextBestActions.$inferInsert;
export type CrmProductRecommendation = typeof crmProductRecommendations.$inferSelect;
export type NewCrmProductRecommendation = typeof crmProductRecommendations.$inferInsert;
export type CrmPortalAccount = typeof crmPortalAccounts.$inferSelect;
export type NewCrmPortalAccount = typeof crmPortalAccounts.$inferInsert;
export type CrmPortalRefreshToken = typeof crmPortalRefreshTokens.$inferSelect;
export type NewCrmPortalRefreshToken = typeof crmPortalRefreshTokens.$inferInsert;
export type CrmPortalPasswordToken = typeof crmPortalPasswordTokens.$inferSelect;
export type NewCrmPortalPasswordToken = typeof crmPortalPasswordTokens.$inferInsert;
export type CrmTerritory = typeof crmTerritories.$inferSelect;
export type NewCrmTerritory = typeof crmTerritories.$inferInsert;
export type CrmTerritoryBranch = typeof crmTerritoryBranches.$inferSelect;
export type NewCrmTerritoryBranch = typeof crmTerritoryBranches.$inferInsert;
export type CrmTerritoryUser = typeof crmTerritoryUsers.$inferSelect;
export type NewCrmTerritoryUser = typeof crmTerritoryUsers.$inferInsert;
export type CrmSalesQuota = typeof crmSalesQuotas.$inferSelect;
export type NewCrmSalesQuota = typeof crmSalesQuotas.$inferInsert;
export type CrmFestivalSuggestion = typeof crmFestivalSuggestions.$inferSelect;
export type NewCrmFestivalSuggestion = typeof crmFestivalSuggestions.$inferInsert;
export type CrmApiKey = typeof crmApiKeys.$inferSelect;
export type NewCrmApiKey = typeof crmApiKeys.$inferInsert;
export type CrmVisitRoute = typeof crmVisitRoutes.$inferSelect;
export type NewCrmVisitRoute = typeof crmVisitRoutes.$inferInsert;
export type CrmVisitRouteStop = typeof crmVisitRouteStops.$inferSelect;
export type NewCrmVisitRouteStop = typeof crmVisitRouteStops.$inferInsert;
export type CrmFieldVisit = typeof crmFieldVisits.$inferSelect;
export type NewCrmFieldVisit = typeof crmFieldVisits.$inferInsert;
export type CrmCallLog = typeof crmCallLogs.$inferSelect;
export type NewCrmCallLog = typeof crmCallLogs.$inferInsert;
export type CrmWhatsappCatalogOrder = typeof crmWhatsappCatalogOrders.$inferSelect;
export type NewCrmWhatsappCatalogOrder = typeof crmWhatsappCatalogOrders.$inferInsert;
