# 12 — Media Management Requirements

## Current State

None. Campaigns are text-only; there is no upload, storage, or attachment mechanism anywhere in the module.

## Requirements

### Asset Library (`FR-G1`, `MH-16`)

- Tenant-scoped storage for image, video, GIF, PDF assets.
- Each asset: filename, type, size, tags/category, uploaded-by, uploaded-at, and usage count (how many
  campaigns reference it) — usage count discourages accidental deletion of in-use assets.
- Searchable/filterable by tag and type; reusable across campaigns (upload once, use many times).
- Storage backend: reuse whatever object-storage mechanism the ERP already uses elsewhere for file uploads
  (check for an existing pattern — e.g. product images — before introducing a new one; this doc does not
  assume a specific backend since that's a CP-2 implementation decision, not a planning-time decision).

### Channel-Aware Validation (`FR-G2`)

- On upload: validate/transform for the union of channel constraints (e.g. downscale an image that exceeds
  WhatsApp's media size limit, reject a video exceeding a channel's duration/size cap with a clear error).
- On campaign send: validate the selected media against the _specific_ channel(s) the campaign targets
  (a valid Email attachment may be invalid for SMS/MMS) — surfaced at review/preview time, not as a runtime
  send failure.

### Product Catalog Attachment (`FR-G3`, `SH-19`)

- A campaign can attach an existing product/catalog record (already modeled in inventory/sales) as a
  "product showcase" instead of requiring a fresh image upload — reduces duplicate asset storage and keeps
  campaign visuals in sync with actual catalog images.

### Reuse & Optimization

- Deduplicate identical uploads where practical (hash-based check) to avoid unbounded storage growth from
  repeated uploads of the same promotional graphic.
- Defer heavy media-optimization pipelines (e.g. video transcoding) unless a specific channel requires it —
  don't build speculative infrastructure ahead of actual channel adapters that need it (CLAUDE.md
  simplicity guidance).

## Sequencing Note

Media management is scheduled in **CP-2**, before the CP-4 builder work that surfaces it in the UI, because
the channel adapters (WhatsApp/Email media messages) and the builder's media picker both depend on the
asset library existing first. CP-4 wires the _UI_ to attach existing/new assets to a campaign; CP-2 builds
the _storage and validation_ layer.
