# 08 — UX/UI Recommendations & Information Architecture

## Current State Critique (factual, from `00_CURRENT_STATE_ASSESSMENT.md`)

- `CampaignsPage.tsx`: single flat list, no pagination, status-pill filter only, inline drill-down expands
  in place (works, but doesn't scale visually past a handful of campaigns).
- `CampaignFormPage.tsx`: one long form (name, channel, segment, message, schedule) with no sectioning —
  fine for a single-channel text blast, not for a form that will grow media, personalization, multi-step
  targeting, and approval.
- `SegmentFormPage.tsx`: one filter rule, dropdown-based — doesn't visually communicate that multiple rules
  with AND/OR are even possible (they aren't, in the UI).
- No dashboard/analytics surface exists anywhere in the module.

## Information Architecture (target)

```
CRM
├── Campaigns
│   ├── All Campaigns (list, filterable/paginated, status + channel + type facets)
│   ├── New Campaign (multi-step builder)
│   ├── Campaign Detail
│   │   ├── Overview (audience, content, schedule summary)
│   │   ├── Recipients (existing drill-down table)
│   │   ├── Analytics (funnel + engagement, CP-6)
│   │   ├── History (audit trail, CP-7)
│   │   └── A/B Results (if applicable, CP-6)
│   ├── Templates (library, CP-4)
│   ├── Media Library (CP-2)
│   └── Automation Rules (CP-5)
├── Segments
│   ├── All Segments (prebuilt + custom, unchanged placement)
│   └── Segment Builder (multi-rule, CP-3)
└── Campaign Settings (tenant-level: approval on/off, send windows, frequency caps, sender identity — CP-5/7/8)
```

This is additive to the existing `/crm/campaigns` and `/crm/segments` routes — no existing route is removed;
`Campaign Detail` gains tabs rather than being restructured.

## Campaign Builder UX (target, CP-4)

Multi-step wizard, each step independently saved as part of the draft (`FR-D1/D2`):

1. **Type & Channel** — pick campaign type (drives suggested defaults) and channel(s).
2. **Audience** — segment picker (with the new multi-rule builder inline or a saved-segment picker),
   explicit customer list still supported, live recipient count.
3. **Content** — template picker or blank, personalization token insertion (existing pattern, extended
   token list), media attachment (CP-2), multi-language variants (optional).
4. **Schedule** — immediate / one-time / recurring, timezone-aware, respects business-hours settings.
5. **Review** — full preview (multi-sample, per-channel rendering), estimated recipient count and cost,
   submit for approval or send/schedule directly depending on tenant settings.

Each step keeps the existing "Preview Recipients" pattern rather than introducing a new preview mechanism —
it's a good pattern, just needs relocating into the wizard.

## Layout & Visual Hierarchy Recommendations

- Campaign list: move to the ERP's standard paginated/data-table pattern already used elsewhere (see
  `erp_ui_redesign_docset_2026_07_07` — column-visibility, standard table component), rather than the
  current unpaginated list.
- Campaign detail: convert from the current inline-expand row into a proper detail page with tabs (Overview/
  Recipients/Analytics/History), matching the "create-record UX standardization" pattern already shipped
  ERP-wide (`erp_create_record_ux_standardization`) — this module predates that standardization and should
  be brought into line with it, not diverge further.
- Segment builder: rule rows with a visible AND/OR toggle between them, add/remove rule buttons — same
  interaction shape as filter builders already common in the ERP's list-page filter panels.

## Mobile Responsiveness & Accessibility

- Wizard steps must collapse to a single-column layout on small viewports (recipient/preview panels stack
  below the form, not beside it).
- All new components must pass the same axe-core bar as the rest of the redesigned ERP UI (`NFR-10`).
- Rich-media previews (email HTML, WhatsApp media) must be checked on mobile viewport sizes specifically —
  this is new surface area the module has never had before.

## Error Handling & Validation

- Zod validation already exists server-side (`CampaignCreateSchema`) — client-side validation must mirror
  it field-by-field in the wizard so errors surface per-step, not only on final submit.
- Provider failures (SMS/WhatsApp/Email credential misconfiguration) must surface a clear, actionable error
  at preview/send time — today a misconfigured provider only fails per-recipient deep in `campaign_recipients
.error_message`, which a store owner would never think to check before assuming the campaign "sent".

## Performance (perceived)

- Recipient count/preview must debounce as segment rules change, not fire a query per keystroke.
- Campaign list virtualizes or paginates once tenant campaign volume grows past ~50-100 rows (SH-14).
