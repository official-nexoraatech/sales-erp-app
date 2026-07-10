# OFFLINE-08 Completion Report — PWA Manifest & Installable Shell
**Date:** 2026-07-05
**Status:** COMPLETE

## What Changed
- `apps/pos-frontend/public/manifest.json` added — `name`/`short_name` "NEXORAA POS", `display: standalone`, `start_url`/`scope: /`, `theme_color: #0252F2` (matches design system's `--brand-primary`), `background_color: #ffffff`, and an `icons` array (192x192, 512x512, each with both `any` and `maskable` purpose since the artwork is drawn within the maskable safe zone).
- `apps/pos-frontend/index.html` — added `<link rel="manifest">`, `theme-color` meta, `<link rel="icon">`, `<link rel="apple-touch-icon">`, and `apple-mobile-web-app-*` meta tags for iOS Add-to-Home-Screen.
- `apps/pos-frontend/public/icons/icon-192.png`, `icon-512.png`, `apple-touch-icon.png` added.
- `sw.ts` and its caching behavior were **not** touched.
- `web-frontend`: **deferred** — it has no offline capability yet (OFFLINE-09 is what would add that), so installability alone has low value there today. Revisit once/if it gains offline support.

## Icon Assets — Important Caveat
**No NEXORAA brand icon/logo assets exist anywhere in this repo.** The only logo files found (`sale-erp-froentend/public/*`) belong to a separate, non-workspace project (`texmintra-frontend`, not listed in `pnpm-workspace.yaml`) with an unrelated teal/purple brand — not reusable.

Per user decision, the icons shipped here are a **generated placeholder**: a solid `#0252F2` (the design system's `--brand-primary`) square with a white "N" monogram, rendered via a one-off Playwright/Chromium screenshot script (not committed — script was temporary, deleted after use). These are clearly placeholder-quality and should be swapped for real brand icon artwork before this is shown to any client/store.

## Manual/Automated Install Verification
No physical device was available this session, so verification was done via `vite preview` + Chromium DevTools Protocol (Playwright), which is what Chrome itself uses to decide whether to show the install affordance:

| Check | Result |
|---|---|
| `GET /manifest.json` | 200, valid JSON |
| `Page.getAppManifest` (CDP) | Parsed with `errors: []` |
| `Page.getInstallabilityErrors` (CDP) | `[]` (Chrome considers the page installable) |
| Console/page errors on load | none |
| `pnpm --filter @erp/pos-frontend build` (tsc) | passes |
| `vite build` | succeeds; `dist/manifest.json` and `dist/icons/*` present, `dist/index.html` has the new tags |
| `pnpm lint` | pre-existing failures only (missing ESLint globals in `sw.ts`/`swSync.ts`/`referenceSync.ts` — same class of debt as prior sessions' lint audit); nothing new from this change |

**Not verified this session (no physical hardware/device access):** real Chrome/Edge desktop install-icon click-through, actual standalone-window launch, Android "Add to Home Screen", iOS Safari share-sheet icon rendering. The CDP checks above are a strong proxy (they run the same installability algorithm Chrome uses) but are not a substitute for a human clicking install on a real device — recommend a quick manual pass before shipping to a store.

## Note on Service Worker Registration Timing
`sw.ts` registration (`POSScreen.tsx:549`) only fires post-login (pre-existing design, not changed here) — the CDP check above was run against the unauthenticated `/login` route, where no SW is yet registered. This didn't block installability (modern Chrome's install criteria no longer hard-require a SW), but full offline-capable installs only take effect after first login, consistent with how OFFLINE-01 through 07 already work.

## Files Changed
| File | Change |
|---|---|
| `apps/pos-frontend/index.html` | manifest link + meta tags |
| `apps/pos-frontend/public/manifest.json` | new |
| `apps/pos-frontend/public/icons/icon-192.png` | new (placeholder) |
| `apps/pos-frontend/public/icons/icon-512.png` | new (placeholder) |
| `apps/pos-frontend/public/icons/apple-touch-icon.png` | new (placeholder) |
| `ERP-PLANNING/reports/OFFLINE_FIRST_ROADMAP.md` | OFFLINE-08 marked complete |

## Known Issues / Deferred
- **Icon artwork is a placeholder** — swap for real brand assets before client-facing use (see caveat above).
- Electron/Tauri native packaging intentionally not built — revisit only if a concrete hardware requirement forces it.
- `web-frontend` manifest deferred until it has offline capability (OFFLINE-09).
- Real device install-click verification (Chrome/Edge desktop, Android, iOS) not done this session — no hardware available.
