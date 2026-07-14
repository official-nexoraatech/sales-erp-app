Copy everything below the line into the first message of a new Claude Code session.

---

I'm starting **Phase CP-2: Channel Abstraction & Media** of the Campaign Management Platform initiative.
This is phase 2 of 9. **CP-1 must be complete** — read
`ERP-PLANNING/Campaign-Planning/phase-completions/CP-1_COMPLETION.md` first; if it doesn't exist, stop and
tell me CP-1 needs to be done first.

Read in this order:

1. `ERP-PLANNING/Campaign-Planning/README.md`
2. `ERP-PLANNING/Campaign-Planning/00_CURRENT_STATE_ASSESSMENT.md` (section 6, channel/provider reality)
3. `ERP-PLANNING/Campaign-Planning/10_OMNICHANNEL_REQUIREMENTS.md`
4. `ERP-PLANNING/Campaign-Planning/12_MEDIA_MANAGEMENT.md`
5. `ERP-PLANNING/Campaign-Planning/17_DATA_MODEL_AND_API_DESIGN.md` (CP-2 section)
6. `ERP-PLANNING/Campaign-Planning/19_MIGRATION_AND_BACKWARD_COMPATIBILITY.md`
7. `ERP-PLANNING/Campaign-Planning/phase-completions/CP-1_COMPLETION.md`

## Goal for This Phase

Make communication channels pluggable, and give the platform its first media/asset capability.

## Scope

1. Extract a `ChannelProvider` adapter interface in `apps/notification-service` (see the conceptual shape in
   `10_OMNICHANNEL_REQUIREMENTS.md`). Migrate the existing 4 channels (SMS/MSG91, Email/SendGrid, WhatsApp/
   Meta Cloud API, In-App/SSE) onto it with **zero behavior change** — the existing circuit-breaker/retry
   wrapper must apply uniformly across all adapters, not be reimplemented per-channel.
2. Verify with CP-1's new unit tests (plus new ones for the adapters themselves) that this refactor doesn't
   change behavior.
3. Build the media asset library: `campaign_media_assets`, `campaign_media_links` tables; upload/list/delete
   endpoints; channel-aware validation (size/type limits per channel, per `12_MEDIA_MANAGEMENT.md`). Check
   whether this ERP already has an object-storage pattern elsewhere (e.g. for product images) before
   introducing a new storage mechanism — reuse it if it exists.
4. Stretch goal only if time remains: design (and optionally implement) one new adapter (Web Push is the
   simplest, standard VAPID-based) to prove the interface actually supports a new channel without touching
   `CampaignService`/`SegmentService`/the campaign schema.

## Rules

- No behavior change to existing channels — this must be verifiable via CP-1's baseline tests passing
  unmodified.
- `apps/web-frontend/e2e/live-crm.spec.ts` must still pass.
- Do not build the frontend media picker UI yet — that's CP-4's job; this phase builds the storage/
  validation layer only.
- Follow additive-only schema rules per `19_MIGRATION_AND_BACKWARD_COMPATIBILITY.md`.

## Definition of Done

See `ERP-PLANNING/Campaign-Planning/22_DEFINITION_OF_DONE_AND_RELEASE_CHECKLIST.md`.

## When Done

Generate `ERP-PLANNING/Campaign-Planning/phase-completions/CP-2_COMPLETION.md`, update status trackers.
