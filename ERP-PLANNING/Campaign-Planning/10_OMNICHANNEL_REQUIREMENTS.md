# 10 — Omnichannel Communication Requirements

## Principle

Channels are **adapters implementing a fixed interface**, registered into a provider registry. Adding a
channel is: implement the interface, register it, add its enum value/config — never touch
`CampaignService`, `SegmentService`, or the campaign schema's core shape.

## Target Adapter Interface (conceptual, refined during CP-2 implementation)

```ts
interface ChannelProvider {
  channel: string; // 'SMS' | 'WHATSAPP' | 'EMAIL' | ... | tenant-extensible
  supportsMedia: boolean;
  maxMessageLength?: number;
  send(recipient, renderedContent, media?): Promise<DeliveryResult>;
  parseDeliveryWebhook?(payload, headers): DeliveryStatusUpdate; // optional: not every channel has webhooks
  validateMedia?(media): ValidationResult; // channel-specific size/type limits
}
```

This lives in `apps/notification-service`, replacing the inline `deliverViaChannel` switch, with the
existing circuit-breaker/retry wrapper applying uniformly to every adapter (`NFR-07`).

## Channel Rollout Plan

| Channel                                         | Status today | Plan                                                                                                                                                     |
| ----------------------------------------------- | ------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| SMS (MSG91)                                     | Real, wired  | Refactor onto adapter interface, no behavior change (CP-2)                                                                                               |
| Email (SendGrid)                                | Real, wired  | Refactor onto adapter interface; add HTML/media support (CP-2)                                                                                           |
| WhatsApp (Meta Cloud API)                       | Real, wired  | Refactor onto adapter interface; add media-message support (CP-2)                                                                                        |
| In-App (SSE)                                    | Real, wired  | Refactor onto adapter interface, no behavior change (CP-2)                                                                                               |
| Push Notifications (mobile)                     | Not built    | New adapter once a mobile app exists — interface designed now, implementation deferred (documented, not scheduled)                                       |
| Web Push                                        | Not built    | New adapter, CP-2 stretch or CP-8, standard Web Push API (VAPID)                                                                                         |
| Telegram                                        | Not built    | New adapter, CP-8 candidate, Bot API                                                                                                                     |
| Facebook Messenger / Instagram                  | Not built    | New adapter, CP-8 candidate, Meta Messenger Platform API (same Meta app as WhatsApp)                                                                     |
| Google Business Messages                        | Not built    | Documented interface only — deprioritized (Google sunset/limited availability); revisit if a tenant needs it                                             |
| Apple Business Chat                             | Not built    | Documented interface only — requires Apple enrollment; out of this roadmap                                                                               |
| LINE / WeChat                                   | Not built    | Documented interface only — regional (SE Asia/China) priority depends on tenant demand, not scheduled                                                    |
| QR Campaigns                                    | Not built    | New adapter: generate a tracked QR code linking to a landing page; "delivery" = code generation, "engagement" = scan tracking (CP-8 candidate)           |
| Printed Coupons / POS Display / Digital Signage | Not built    | Physical/offline — a "channel" here means generating a printable/displayable asset with a tracked code, not a network send. Interface-only, future work. |
| Third-party API/webhook                         | Not built    | Outbound webhook on campaign lifecycle events (SH-17, CP-8) — lets external marketing tools subscribe, distinct from being a send-channel itself         |

## Cross-Channel Requirements

- A single campaign can target multiple channels with per-recipient channel selection (e.g. WhatsApp if not
  opted out, else SMS fallback) — `FR-B5`.
- Every channel adapter must expose its message-length/media constraints so the builder's preview step can
  validate content per-channel before send (`FR-D1` review step, `08_UX_UI...` preview requirement).
- Delivery-webhook support is optional per adapter (`parseDeliveryWebhook?`) — channels without provider
  webhooks (e.g. IN_APP, which is push-and-confirm at write time) simply don't populate post-send status
  updates beyond `SENT`.

## What This Buys the Business

Meets `BR-11`/`BR-12`/`FR-B1`: a future tenant in Retail or Hospitality that wants Telegram or QR campaigns
gets a contained adapter-development task, not a re-architecture — this is the core mechanism by which the
platform becomes industry-agnostic on the channel dimension.
