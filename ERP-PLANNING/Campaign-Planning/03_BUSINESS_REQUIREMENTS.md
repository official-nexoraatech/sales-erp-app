# 03 — Business Requirements

Numbered `BR-xx` for traceability from `07_FEATURE_BACKLOG.md` and phase prompts.

## Campaign Management

- **BR-01**: The business must be able to run promotional, transactional-adjacent (birthday/anniversary),
  and lifecycle (win-back, reactivation) campaigns across multiple channels from one platform.
- **BR-02**: The business must be able to reuse content (templates, media, personalization tokens) across
  campaigns to reduce authoring time.
- **BR-03**: The business must be able to require review/approval before a campaign sends, to prevent
  costly mistakes (wrong segment, wrong discount, wrong channel) reaching customers.
- **BR-04**: The business must be able to measure whether a campaign worked — delivery, engagement, and
  ideally revenue impact — to justify marketing spend and channel choice.
- **BR-05**: The business must be able to target customers precisely enough that campaigns feel relevant,
  not spammy, to avoid opt-outs and channel-provider penalties (e.g. WhatsApp/SMS carrier blocking for high
  complaint rates).
- **BR-06**: The business must be able to automate well-known lifecycle moments (birthday, abandoned cart,
  post-purchase, win-back) without a person creating a campaign every time.
- **BR-07**: The business must be able to run this on a schedule that respects the customer's local time and
  the business's own working/quiet hours, to avoid 3am notifications damaging the brand.

## Compliance & Trust

- **BR-08**: The business must never message a customer who has opted out of a channel (already true today
  — must remain true through every future change).
- **BR-09**: The business must be able to demonstrate consent basis for marketing messages (India DPDP Act /
  TRAI regulations for SMS/WhatsApp commercial communication) — see `15_ROLES_PERMISSIONS_SECURITY_COMPLIANCE.md`.
- **BR-10**: The business must provide customers a way to manage their own communication preferences (a
  preference center), not just a binary opt-out per channel.

## Extensibility

- **BR-11**: The platform must let the business (or NEXORAA on the business's behalf) add a new
  communication channel without a core-engine rewrite.
- **BR-12**: The platform must let the business define campaign types and targeting attributes relevant to
  its own industry (clothing today; retail/wholesale/manufacturing/healthcare/hospitality/distribution in
  future tenants) via configuration, not code changes per vertical.

## Multi-Tenant / Enterprise

- **BR-13**: Each tenant's campaigns, segments, templates, and analytics must remain fully isolated from
  other tenants (already true today via `tenant_id` scoping — must remain true).
- **BR-14**: A tenant with multiple brands/stores must be able to scope campaigns and reporting to a
  specific store/brand, not just the whole tenant.
- **BR-15**: The sender identity (from-name, from-number, from-domain) must be configurable per tenant so
  messages don't all appear to come from a shared generic sender.

## Cost & Efficiency

- **BR-16**: The business must be able to see, before sending, how many recipients and what estimated
  provider cost a campaign will incur (SMS/WhatsApp are billed per message by MSG91/Meta).
- **BR-17**: The business must be able to cap send frequency per customer to avoid both customer fatigue and
  unnecessary provider spend.
