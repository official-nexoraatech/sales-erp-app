# OFFLINE-08 — PWA Manifest & Installable App Shell
## STATUS: 🔲 NOT STARTED
## Sprint: Offline-8 | Effort: Small (1–2 days) | Risk: Low
## Depends on: none (independent of the sync-hardening phases; can run any time, sequenced here since it's low-risk and self-contained)
## Unlocks: nothing downstream — purely additive
## Source: `ERP-PLANNING/reports/OFFLINE_READINESS_REPORT.md` §1, roadmap decision #4

---

## YOUR ROLE

You are the **Frontend Engineer** closing the audit's finding that "no PWA manifest
exists anywhere... neither app is installable via Add-to-Home-Screen/Add-to-Desktop."
This phase adds a manifest and icon set to `apps/pos-frontend` (and optionally
`apps/web-frontend`, see Step 3) so it can be installed as a standalone window on
Windows/macOS/Linux/Android via the browser's native install mechanism.

**Per the roadmap's explicit decision, this phase does NOT build an Electron/Tauri
wrapper.** A PWA manifest is the recommended first step; native packaging is deferred
until a concrete hardware requirement (e.g. direct thermal-printer access) forces it. Do
not expand this phase's scope into evaluating or scaffolding Electron/Tauri.

---

## PRE-FLIGHT CHECKLIST

- [ ] Read `apps/pos-frontend/index.html` and confirm current absence of any `<link rel="manifest">`, theme-color meta, or icon links
- [ ] Confirm `apps/pos-frontend` has no `public/` directory today (per the audit) — this phase creates one
- [ ] Read `apps/pos-frontend/src/sw.ts` — the existing service worker this manifest will pair with (a manifest without a working SW gives partial installability in some browsers but full support needs both)
- [ ] Check whether `apps/pos-frontend`'s Vite config would benefit from `vite-plugin-pwa` for manifest injection, vs. hand-writing `manifest.json` and linking it manually — given the existing SW is hand-rolled (no Workbox), prefer hand-writing the manifest and a manual `<link>` tag for consistency with the existing approach, rather than introducing a plugin that assumes Workbox
- [ ] Identify or request app icon assets (at minimum 192x192 and 512x512 PNG, ideally maskable-safe) — if no brand icon assets exist in the repo, flag this explicitly rather than shipping a placeholder that looks unfinished

---

## PROJECT CONTEXT

### What "installable" actually buys here

A PWA manifest + registered service worker lets a user (or an IT admin doing store
setup) install the POS app from the browser's install prompt (Chrome/Edge's
install-icon in the address bar, or "Add to Home Screen" on Android) so it opens in its
own window without browser chrome (address bar, tabs) and gets its own taskbar/dock
icon and app-switcher entry — a meaningfully more "desktop app"-like experience with
near-zero engineering cost, compared to Electron/Tauri's cost of a whole separate
build/packaging/auto-update pipeline.

### What it does NOT buy

No filesystem access, no direct USB/serial device access beyond what a browser tab
already has (WebUSB/WebHID/WebSerial are available to a PWA exactly as much as to a
regular tab — installability doesn't change device-API availability), and background
sync/notifications still follow the same Background Sync API limitations covered in
OFFLINE-06. Don't oversell this phase's impact in the completion report.

### Coding Standards
- Keep the manifest and icons self-contained within `apps/pos-frontend/public/` — don't reach into other apps' directories
- Match this repo's existing branding if a design system/logo exists (`ERP_FRONTEND_DESIGN_SYSTEM.md`) rather than inventing new icon artwork

---

## OBJECTIVE

1. `apps/pos-frontend` has a valid `manifest.json` (or `.webmanifest`) with correct name, icons, `display: 'standalone'`, theme/background colors, and start URL
2. `index.html` links the manifest and includes appropriate meta tags
3. The app is installable in Chromium-based browsers and Android, verified manually

---

## SCOPE

### Step 1 — Manifest and icons

Create `apps/pos-frontend/public/manifest.json` with `name`, `short_name`, `start_url`,
`display: "standalone"`, `background_color`, `theme_color`, and an `icons` array (192x192
and 512x512 at minimum, plus a maskable variant if brand assets support it). Add the
icon PNG files to `apps/pos-frontend/public/icons/`.

### Step 2 — Wire it into `index.html`

Add `<link rel="manifest" href="/manifest.json">`, a `<meta name="theme-color"
content="...">`, and appropriate `<link rel="apple-touch-icon">` for iOS Add-to-Home-Screen
(note iOS has more limited PWA support — no true "standalone" install prompt UI, but
Add-to-Home-Screen still works via Safari's share sheet, so include the meta tags that
support it even though the experience is more limited there).

### Step 3 — Decide on `web-frontend`

Confirm with the roadmap/client whether `apps/web-frontend` should also get a manifest
in this phase. The roadmap lists this as optional ("and web-frontend if desired") — if
there's no clear driver for making the back-office app installable as well (it has no
offline capability yet, so installability alone has less value there until OFFLINE-09
lands), scope this phase to `pos-frontend` only and note `web-frontend` as an easy
follow-up once/if it gains offline support.

### OUT OF SCOPE
- Electron/Tauri/any native wrapper
- Push notifications (a separate PWA capability, not requested)
- Any change to the service worker's caching behavior beyond what's needed for manifest/installability compliance

---

## TESTING REQUIREMENTS

1. Chrome/Edge shows an install prompt/icon for `apps/pos-frontend`
2. Installing the app opens it in a standalone window (no browser address bar/tabs)
3. The installed app's icon and name match the manifest
4. iOS Safari's Add-to-Home-Screen produces a reasonable icon/name (manual check, given iOS's more limited PWA support)
5. Existing service worker caching/offline behavior (OFFLINE-01 through 07, whichever have landed) is unaffected

---

## BUILD VERIFICATION

```bash
pnpm --filter @erp/pos-frontend build
pnpm lint
```

Manual verification: serve the built app over HTTPS (or localhost, which browsers treat
as a secure context) and confirm the browser's install affordance appears.

---

## VERIFICATION CHECKLIST

- [ ] Manifest is valid (no console errors/warnings about it in devtools)
- [ ] App is installable in at least one Chromium-based browser
- [ ] Icons render correctly at all declared sizes
- [ ] Existing SW/offline behavior is unaffected

---

## REGRESSION CHECKLIST

- [ ] `sw.ts`'s existing caching behavior for quick-items/customer-search/navigation fallback is unchanged
- [ ] No change to any offline-sync logic from prior phases

---

## DEFINITION OF DONE

- [ ] `apps/pos-frontend` is installable with a correct manifest and icon set
- [ ] Manual install verification done on at least Chrome/Edge (desktop) and Android
- [ ] `pnpm lint` passes
- [ ] Completion report saved at `ERP-PLANNING/phase-completions/OFFLINE-08_COMPLETION.md`
- [ ] `ERP-PLANNING/reports/OFFLINE_FIRST_ROADMAP.md` updated to mark OFFLINE-08 complete

---

## COMPLETION REPORT TEMPLATE

**Save as:** `ERP-PLANNING/phase-completions/OFFLINE-08_COMPLETION.md`

```markdown
# OFFLINE-08 Completion Report — PWA Manifest & Installable Shell
**Date:** [YYYY-MM-DD]
**Status:** COMPLETE / PARTIAL

## What Changed
- manifest.json + icons added to apps/pos-frontend
- web-frontend: [included / deferred, and why]

## Manual Install Verification
| Browser/OS | Installable | Notes |
|---|---|---|

## Files Changed
[Table]

## Known Issues / Deferred
- Electron/Tauri native packaging intentionally not built — revisit only if a concrete hardware requirement forces it
```
