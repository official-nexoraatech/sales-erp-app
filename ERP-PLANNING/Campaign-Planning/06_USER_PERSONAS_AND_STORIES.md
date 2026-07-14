# 06 — User Personas, Stories & Acceptance Criteria

## Personas

### P1 — Marketing/Store Owner ("Priya")

Runs a 3-store clothing retail chain. Not technical. Wants to send a festival promo to loyal customers in
under 10 minutes, and wants to know afterward whether it worked. Cares most about: speed of authoring,
confidence before sending (preview/count), and a simple report ("did people get it, did they buy").

### P2 — Sales/Floor Staff Manager ("Ravi")

Uses the ERP daily for orders and customers, occasionally sends a targeted campaign to his own store's
customers or his own assigned customers. Needs store-scoped and salesperson-scoped targeting (`FR-M1`,
`FR-C2`).

### P3 — Compliance/Admin Owner ("Anita")

Responsible for not getting the business in trouble with TRAI/DPDP rules or blocked by WhatsApp/SMS
providers for spam complaints. Needs approval workflow, opt-out guarantees, consent visibility, and audit
history.

### P4 — Platform Operator (NEXORAA side)

Onboards new tenants, potentially in a new industry vertical. Needs campaign types/targeting fields to be
configurable per tenant without code changes, and needs channel providers to be pluggable.

### P5 — Customer (recipient)

Wants relevant messages, an easy way to stop unwanted ones, and no message that's obviously broken
(`{{customerName}}` literal, wrong currency, etc.).

## User Stories & Acceptance Criteria

Format: `US-xx` → story → acceptance criteria. Grouped loosely by phase for traceability, but stories are
persona-driven, not phase-driven.

### US-01 (P1): Draft and resume a campaign

_As Priya, I want my half-finished campaign saved automatically so I don't lose work if I get interrupted._

- AC1: Navigating away from the builder mid-edit and returning shows the same content.
- AC2: A "Drafts" filter on the campaign list shows all autosaved drafts.
- AC3: Autosave does not fire on every keystroke (debounced) and does not block typing.

### US-02 (P1): Preview before sending, with confidence

_As Priya, I want to see exactly what a real customer will receive, for more than just the first match,
before I commit to sending._

- AC1: Preview shows recipient count and at least 3 sample rendered messages (or all matches if fewer).
- AC2: Preview flags any recipient whose personalization would hit a fallback (e.g. missing name).
- AC3: Preview works per-channel (an Email preview shows subject+body, an SMS preview shows length/segment
  count).

### US-03 (P3): Require approval before send

_As Anita, I want certain campaigns (or all campaigns) to require my sign-off before they can send._

- AC1: Tenant setting toggles approval requirement on/off.
- AC2: When on, a campaign cannot reach `SCHEDULED`/`RUNNING` without a user holding the approve permission
  approving it.
- AC3: Approval/rejection with a reason is visible in the campaign's history.

### US-04 (P1): Know if it worked

_As Priya, I want to see delivery and engagement numbers after a campaign runs, not just "sent"._

- AC1: Campaign detail shows sent/delivered/failed/opened/clicked counts where the channel supports each
  metric.
- AC2: Numbers update as webhook confirmations arrive (not just at send time).
- AC3: If a coupon code is attached, redemption count and attributed revenue are shown.

### US-05 (P2): Target my own store's customers

_As Ravi, I want to build a segment scoped to my store or my assigned customers without seeing every
customer in the tenant._

- AC1: Segment builder offers a store/branch filter and a salesperson filter.
- AC2: Ravi's own permissions can restrict which segments/campaigns he's allowed to create to his own scope
  (enforced server-side, not just hidden in UI).

### US-06 (P5): Stop unwanted messages easily

_As a customer, I want a simple, working way to reduce or stop marketing messages on a given channel._

- AC1: Every marketing message on every channel includes a working opt-out mechanism appropriate to that
  channel.
- AC2: Opting out takes effect before the next campaign send (no further sends on that channel).
- AC3: A preference center lets the customer choose per-category (promotional vs. reminder) preferences,
  not just all-or-nothing.

### US-07 (P1): Automate the birthday/win-back messages

_As Priya, I want birthday greetings and "we miss you" messages to go out automatically without me creating
a campaign each time._

- AC1: Automation triggers can be turned on/off per type, with a chosen channel and template.
- AC2: An automated send still respects opt-out, frequency capping, and send-window rules exactly like a
  manual campaign.
- AC3: Automated sends appear in the same campaign list/history as manual campaigns (tagged as automated),
  not hidden in a separate place.

### US-08 (P1): Compare which channel/campaign type works best

_As Priya, I want to know if SMS or WhatsApp gets better response for my flash sales, so I know where to
spend._

- AC1: A comparison view shows delivery/engagement/conversion by channel and by campaign type over a
  selectable date range.
- AC2: An A/B test on a single campaign shows which variant won on the configured success metric.

### US-09 (P4): Add a new channel without a rewrite

_As a platform operator, I want to add a new channel provider (e.g. Telegram) as a contained unit of work._

- AC1: A new provider implements a fixed adapter interface and registers itself; no changes required in
  `CampaignService`, `SegmentService`, or campaign schema beyond adding the channel's enum value.
- AC2: Existing channels' tests still pass unmodified after the adapter refactor.

### US-10 (P3): See who changed what

_As Anita, I want an audit trail of who created, edited, approved, sent, or cancelled a campaign._

- AC1: Campaign detail view has a visible "History" tab listing every state transition with actor and
  timestamp.
- AC2: Edits to a `DRAFT`/`SCHEDULED` campaign are diffed/logged, not just the final state.
