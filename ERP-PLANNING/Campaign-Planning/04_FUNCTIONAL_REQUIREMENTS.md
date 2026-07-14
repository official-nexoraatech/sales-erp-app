# 04 — Functional Requirements

`FR-xx`, grouped by capability area. Each maps to a phase in `21_IMPLEMENTATION_ROADMAP.md`.

## A. Campaign Types

- **FR-A1**: Campaign has a `campaignType` field, tenant-configurable, seeded with a default taxonomy for
  Clothing: Promotional, Loyalty, Coupon, Birthday, Anniversary, Seasonal, Festival, Clearance, Flash Sale,
  New Arrivals, Product Launch, Abandoned Cart, Win-Back, Reactivation, Feedback/Survey, Referral, Event
  Invitation, Membership, VIP, Educational, Announcement.
- **FR-A2**: Campaign type drives default template suggestions, default targeting suggestions, and which
  automation triggers are available (e.g. "Abandoned Cart" only appears as an automation trigger, not a
  one-off manual type, since it requires event-driven data).
- **FR-A3**: Campaign type is metadata only — it must not require schema changes to add a new type. (Phase
  CP-4)

## B. Communication Channels

- **FR-B1**: A channel-provider abstraction (interface: `send(recipient, renderedMessage, mediaRefs) →
DeliveryResult`, `supportsMedia`, `maxMessageLength`, `parseDeliveryWebhook(payload) → StatusUpdate`)
  replaces the inline `deliverViaChannel` switch in `NotificationEngine`. (Phase CP-2)
- **FR-B2**: Existing channels (SMS/MSG91, Email/SendGrid, WhatsApp/Meta Cloud API, In-App/SSE) are
  refactored onto this interface with no behavior change (verified by the existing E2E + new unit tests).
  (Phase CP-2)
- **FR-B3**: New provider adapters can be added for: Push Notifications, Web Push, Telegram, Facebook
  Messenger, Instagram, Google Business Messages, QR-code campaigns (generate/track a QR linking to a
  landing page), with each adapter being additive — no change to `CampaignService` or the schema required
  beyond registering the new enum value. (Phase CP-2, adapters built incrementally — see
  `10_OMNICHANNEL_REQUIREMENTS.md` for which ship in CP-2 vs. later.)
- **FR-B4**: Channels the business cannot self-serve without a physical/offline integration (Printed
  Coupons, POS Display Messages, Digital Signage, Apple Business Chat, LINE, WeChat) are documented as
  future adapters with a defined interface contract but are **not** built in this roadmap — see Non-Goals in
  `01_VISION_AND_GOALS.md` and the "future extensibility" list in `10_OMNICHANNEL_REQUIREMENTS.md`.
- **FR-B5**: A campaign can target more than one channel (e.g. SMS + Email fallback), configurable per
  recipient's channel availability/opt-out state. (Phase CP-4, depends on CP-2)

## C. Customer Targeting / Segmentation

- **FR-C1**: Segment rule builder UI supports an arbitrary number of rules combined with AND/OR (matching
  what the backend `filter_definition` already stores). (Phase CP-3)
- **FR-C2**: Segment field whitelist expands to include: purchase history aggregates (last purchase date,
  order count, average order value, total lifetime value), product/category/brand preference (derived from
  invoice line history), loyalty tier, visit frequency, geographic fields (city/state/pincode), store
  (branch) affiliation, assigned salesperson, and tenant-defined custom attributes. (Phase CP-3)
- **FR-C3**: Segments remain computed-on-read for correctness; a caching layer may be introduced later
  (CP-8) if volume requires it, without changing the segment definition contract.
- **FR-C4**: A campaign can be built directly from an ad-hoc filter (not a saved segment) and optionally
  saved as a segment afterward. (Phase CP-3)
- **FR-C5**: Recipient resolution continues to always apply channel opt-out filtering — this is a hard
  invariant, not a configurable option. (All phases)

## D. Campaign Builder

- **FR-D1**: Multi-step builder: Type & Channel → Audience → Content → Personalization → Schedule → Review.
  Each step is independently valid/save-able as a draft. (Phase CP-4)
- **FR-D2**: Drafts autosave (debounced) so a browser crash/navigation doesn't lose work. (Phase CP-4)
- **FR-D3**: Campaigns are editable while in `DRAFT` or `SCHEDULED` status; editing a `SCHEDULED` campaign
  requires re-confirmation of the schedule. Campaigns in `SENDING`/`SENT` are immutable except for
  cancellation of remaining un-sent recipients. (Phase CP-4, state machine in
  `09_CAMPAIGN_LIFECYCLE_AND_WORKFLOW.md`)
- **FR-D4**: Named, reusable, versioned campaign templates (distinct from notification-service's
  transactional templates) with category tagging. (Phase CP-4)
- **FR-D5**: Approval workflow: a tenant can require N-level approval before a campaign moves from `DRAFT`/
  `PENDING_APPROVAL` to `APPROVED`/`SCHEDULED`. Optional per tenant (some tenants may disable it). (Phase
  CP-7)
- **FR-D6**: Reusable content blocks (e.g. a standard footer/header, a standard offer block) insertable into
  templates. (Phase CP-4)
- **FR-D7**: Multi-language content — a campaign can define per-language variants of its message, and
  recipients receive the variant matching their recorded language preference (falls back to a default).
  (Phase CP-4)

## E. Scheduling

- **FR-E1**: Immediate send, single scheduled send (already exists — preserved), and recurring send
  (daily/weekly/monthly/custom cron, with an end condition). (Phase CP-5)
- **FR-E2**: Timezone-aware scheduling — `scheduledAt` is stored in UTC with an explicit tenant/campaign
  timezone; if per-recipient timezone data exists, sends can be staggered to hit a local send-window.
  (Phase CP-5)
- **FR-E3**: Business-hours/send-window constraints configurable per tenant (e.g. "never send SMS before
  9am or after 8pm local time"); a campaign scheduled inside a quiet period is queued to the next valid
  window. (Phase CP-5)
- **FR-E4**: Frequency capping — configurable max campaigns per customer per day/week across all campaigns,
  enforced at recipient-resolution time. (Phase CP-5)
- **FR-E5**: Dispatch fan-out moves from in-request batching to a real background worker/queue so send
  volume no longer risks HTTP timeouts and supports pause/resume. (Phase CP-5)

## F. Personalization

- **FR-F1**: Personalization token library expands beyond `{{customerName, balance, loyaltyPoints,
shopName, customField}}` to include: last purchase (item/date/amount), recommended products (simple
  rule-based, not ML in this roadmap), applicable coupon code, store name/address, assigned salesperson
  name, membership tier/expiry, and tenant-defined custom fields. (Phase CP-3)
- **FR-F2**: Token rendering fails safe — a missing value renders a configured fallback (e.g. blank or a
  default string), never a broken `{{token}}` literal in a sent message; the preview step must surface which
  recipients would hit a fallback before sending. (Phase CP-3)

## G. Media Management

- **FR-G1**: Tenant-scoped asset library: upload image/video/GIF/PDF, tagged and searchable, reusable across
  campaigns. (Phase CP-2, since it's required before any rich channel adapter is useful)
- **FR-G2**: Media is optimized on upload (image resize/compress for MMS/WhatsApp/Email size limits) and
  validated against each target channel's constraints (e.g. WhatsApp media size/type limits) before a
  campaign can be sent. (Phase CP-2)
- **FR-G3**: Product-catalog attachment — a campaign can reference existing product/catalog records
  (already modeled elsewhere in the ERP) as a media source instead of a fresh upload. (Phase CP-4)

## H. Automation & Workflow

- **FR-H1**: A trigger-based automation engine supports: Welcome (on customer creation), Birthday,
  Anniversary, Post-Purchase Follow-up, Abandoned Cart, Loyalty Point Reminder, Payment/Dues Reminder,
  Membership Renewal, Customer Inactivity, using the same `CampaignService` send path as manual campaigns
  (folding in the existing birthday-greeting special case). (Phase CP-5)
- **FR-H2**: Each automation is configurable (on/off, template, channel, send-window) per tenant, not
  hardcoded per trigger. (Phase CP-5)
- **FR-H3**: Inventory-alert-driven and other cross-module triggers are documented as a future extension
  point (the trigger registry is designed to accept new event types) but only the triggers in FR-H1 ship in
  this roadmap. (Phase CP-5, extensibility noted in `13_AUTOMATION_AND_SCHEDULING.md`)

## I. Campaign Analytics

- **FR-I1**: Delivery-status webhook receivers for MSG91/SendGrid/Meta populate real `DELIVERED`/`FAILED`/
  `BOUNCED` states on `campaign_recipients` and roll up to `campaigns.deliveredCount`. (Phase CP-6)
- **FR-I2**: Engagement tracking: open tracking (email pixel / WhatsApp read receipts where the provider
  supports it), click tracking (link wrapping with a redirect-and-record endpoint), per campaign and
  per-recipient. (Phase CP-6)
- **FR-I3**: Conversion/revenue attribution — a campaign can be linked to a coupon code or a tracked link;
  subsequent orders using that code/link within an attribution window are attributed to the campaign. (Phase
  CP-6)
- **FR-I4**: Dashboard views: single-campaign detail (funnel: sent → delivered → opened → clicked →
  converted), and cross-campaign comparison (by channel, by type, by date range). (Phase CP-6)
- **FR-I5**: A/B testing — a campaign can define 2+ variants (message/subject/image/CTA/send-time), split
  the audience, and report which variant performed better on a configurable success metric. (Phase CP-6)

## J. Campaign Lifecycle

- **FR-J1**: Status model: `DRAFT → PENDING_APPROVAL (optional) → APPROVED → SCHEDULED → RUNNING → PAUSED →
COMPLETED`, with `CANCELLED`/`FAILED`/`ARCHIVED` as side/terminal states. Full transition table in
  `09_CAMPAIGN_LIFECYCLE_AND_WORKFLOW.md`. Existing statuses (`DRAFT/SCHEDULED/SENDING/SENT/CANCELLED/
FAILED`) map onto this model without a breaking rename — see `19_MIGRATION_AND_BACKWARD_COMPATIBILITY.md`.
  (Phase CP-4/CP-5/CP-7 incrementally)

## K. Collaboration

- **FR-K1**: Internal notes/comments on a campaign (visible to internal users only, never sent to
  recipients). (Phase CP-7)
- **FR-K2**: Approval history is visible on the campaign detail view (who approved/rejected, when, why).
  (Phase CP-7)
- **FR-K3**: Granular role-based permissions separating create/edit, approve, send, and view-analytics
  capabilities (see `15_ROLES_PERMISSIONS_SECURITY_COMPLIANCE.md`). (Phase CP-7)

## L. Customer Experience

- **FR-L1**: Every outbound channel message includes a working unsubscribe/preference-management link or
  equivalent (e.g. WhatsApp opt-out keyword instructions), and honors it immediately. (Phase CP-7)
- **FR-L2**: A customer-facing preference center lets a customer choose channel-level and category-level
  (promotional vs. transactional) communication preferences. (Phase CP-7)
- **FR-L3**: Rich-media messages render correctly on mobile for every channel that supports media. (Phase
  CP-2/CP-4, verified in `24_PLAYWRIGHT_TEST_PLAN.md` cross-device checks)

## M. Enterprise Features

- **FR-M1**: Campaigns and analytics can be scoped to a specific branch/store within a tenant. (Phase CP-8)
- **FR-M2**: Sender identity (from-name/number/domain) is configurable per tenant. (Phase CP-8)
- **FR-M3**: Outbound webhooks notify third-party systems of campaign lifecycle events (sent, completed,
  failed) for CRM/marketing-tool integration. (Phase CP-8)
