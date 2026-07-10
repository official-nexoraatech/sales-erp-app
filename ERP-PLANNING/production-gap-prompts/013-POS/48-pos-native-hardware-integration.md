# [PG-052] POS native hardware integration

> Template version 1.0. Every gap-prompt file in this tree must follow this exact section order. Do not add sections; do not omit sections that apply. If a section genuinely does not apply to this gap, write "Not applicable — <one-line reason>" instead of deleting it, so the structure stays diffable across files.

**Category:** POS
**Priority:** Medium
**Complexity:** L — browser hardware APIs (WebUSB/WebSerial) have real per-device/per-browser compatibility variance, and a cash-drawer-kick or scale-read integration touches the checkout flow's timing/error-handling, not just an isolated component.
**Depends on:** none
**Blocks:** none
**Primary service(s)/package(s):** apps/pos-frontend (all work — this is a pure frontend/hardware-integration gap, no backend change)

---

## Overview

- **Business objective:** this POS has no cash-drawer-kick integration (the drawer must be opened manually or via a printer-triggered pulse the software has no control over), no weighing-scale integration (any weight-based item must have its price/quantity entered manually), and thermal receipt printing goes through the OS/browser print dialog rather than a native ESC/POS driver — meaning receipt formatting (paper cut, drawer-kick-on-print, font/alignment fidelity) is fragile and inconsistent across different printer models and browsers. For a retail counter, cash-drawer auto-open on sale completion and reliable thermal formatting are baseline expectations of a POS system; their absence adds friction and manual-error risk to every single transaction.
- **Current implementation:** Receipt "printing" is `window.print()`, called directly from `apps/pos-frontend/src/components/pos/ReceiptOverlay.tsx` (line 101, `onClick={() => window.print()}`), with paper-size-specific `@page` CSS rules injected inline (lines 10-14, 48: a `PAPER_SIZES` map for `A4`/`80mm`/`58mm` controlling `@page { size: ...; margin: ... }`). This relies entirely on the browser's print pipeline and the OS print driver correctly interpreting those CSS `@page` hints for whatever physical printer is configured as the system default — there is no ESC/POS command stream, no direct printer-model targeting, and no programmatic drawer-kick (most thermal receipt printers support a drawer-kick pulse tied to a specific ESC/POS command sent to the printer, which this flow has no way to send). There is no cash-drawer or weighing-scale code anywhere in `apps/pos-frontend/src` (confirmed by search — no `WebUSB`, `WebSerial`, `escpos`, or drawer/scale-related file names or code found).
- **Current architecture:** pos-frontend already has one real precedent for browser-native hardware access: barcode scanning via camera, using `@zxing/browser`'s `BrowserMultiFormatReader` (`POSScreen.tsx` line 5, instantiated at line 439, driven off `getUserMedia` through a `<video>` element, gated behind a `cameraOpen` toggle state at line 106). This is a "browser-native over native companion app" architectural choice already made and working for one hardware class (camera/barcode) — the question this package answers is whether the same choice extends to cash drawers and scales, or whether those specific device classes need a different answer.
- **Current limitations:** No drawer-kick means a cashier must have a separate, unintegrated way to open the till (a manual key/button on the drawer itself, typically), which is a workable but suboptimal retail workflow. No scale integration means weighed items (produce, bulk goods — relevant if this ERP serves any such retail vertical) require manual weight entry, which is slower and more error-prone than a scale feeding weight directly into the cart line. Browser print dependency means receipt formatting quality varies by whatever printer driver/browser combination is in use at a given till, with no way to send raw ESC/POS bytes for guaranteed formatting (bold, cut, drawer-kick-on-print) regardless of OS print-driver quirks.

## Existing Code Analysis

- **What already exists and should be reused:** The `@zxing/browser` + `getUserMedia` pattern in `POSScreen.tsx` as the *precedent and template* for "browser API grants access to physical hardware, gated behind explicit user action and graceful degradation" — the same shape (feature-detect, request permission, fall back cleanly if unsupported) should apply to any WebUSB/WebSerial work in this package. `ReceiptOverlay.tsx`'s existing `PAPER_SIZES` map and paper-size selector UI — if ESC/POS raw printing is added, it should extend this same component (adding a "Print via connected printer" option alongside the existing `window.print()` button) rather than replacing the working browser-print fallback, since browser-print must remain the fallback for printers/browsers that don't support the direct-hardware path.
- **What should never be modified:** The existing `window.print()` fallback path itself — it must remain functional for any till whose printer/browser combination doesn't support WebUSB/WebSerial (which, per the browser-support reality below, will be a meaningful fraction of real deployments, especially anything on Safari/iOS). Barcode-scanning code (`@zxing/browser` usage) — unrelated, out of scope, do not refactor while touching hardware-integration code nearby.
- **Prior related work:** OFFLINE-06 (Background Sync API, `apps/pos-frontend/src/POSScreen.tsx` lines 66-85) already established the pattern this package should follow for browser-API-with-partial-support: `supportsBackgroundSync()` feature-detection (line 69-71) before ever attempting to use the API, with an explicit comment about Chromium/Android-only support and a documented fallback path (tab-open/manual sync). This package's WebUSB/WebSerial work should read as the same kind of "feature-detect, use if present, explicit documented fallback if not" code, not a hard dependency.

## Architecture

**Recommendation: browser-native (WebUSB/WebSerial) for cash-drawer-kick and scale integration where the printer/scale supports it, with the existing browser-print dialog remaining as the permanent, non-optional fallback — not a temporary stopgap to be removed later.** Reasoning:

- **Why not a native companion app:** this system has deliberately avoided a native app anywhere in the POS stack — pos-frontend is a browser SPA with an offline-first Dexie/IndexedDB architecture (OFFLINE-01 through OFFLINE-07) specifically so it can run on whatever hardware a retail counter has (a browser, no install step, no per-OS build/distribution problem). Introducing a native companion helper app now would mean: a second codebase to build/sign/distribute/update per OS, a new update-channel problem (retail till hardware is notoriously hard to keep patched), and a support burden (helper-app-not-running is now a new failure mode support has to diagnose) — all to solve a problem WebUSB/WebSerial already solve for the printer/scale models that support them. This would be a significant architectural reversal not justified unless browser APis are proven insufficient for the actual hardware in use, which is the next point.
- **Why WebUSB/WebSerial is viable, with caveats:** most modern USB/serial thermal receipt printers and USB scales are approachable via WebUSB (device claimed exclusively by the browser tab, raw byte read/write) or WebSerial (for serial/virtual-COM-port devices) in Chromium-based browsers (Chrome, Edge — the same browser family already required for OFFLINE-06's Background Sync, so this doesn't introduce a *new* browser constraint, it aligns with one already implicitly required). **The real caveat: neither API exists in Safari, and WebUSB specifically is unavailable on iOS entirely (Apple's WebKit policy) — so any till running Safari/iOS gets zero hardware integration and must use the manual/browser-print path unconditionally.** This is not a defect to "fix" — it is a platform limitation to document and design around, exactly the same shape as OFFLINE-06's Background Sync limitation.
- **Cash-drawer-kick specifically:** most thermal receipt printers with a drawer-kick port (RJ11/RJ12) trigger the kick via a specific ESC/POS command sent *to the printer* (the printer relays the pulse to the drawer), not by talking to the drawer directly as its own USB/serial device. This means drawer-kick and ESC/POS raw printing are effectively the same integration — once the code can open a WebUSB/WebSerial connection to the printer and write raw ESC/POS bytes, sending the drawer-kick command (`ESC p m t1 t2`, a well-documented standard command) is a small addition, not a separate integration.
- **Weighing-scale specifically:** USB/serial scales typically stream weight readings as plain text/simple binary frames over a virtual COM port — a WebSerial `read()` loop parsing incoming frames into a weight value, feeding it into the current cart-line-quantity field. This is architecturally simpler than the printer case (read-only, no command protocol to drive) but has more per-manufacturer frame-format variance — this package should target one well-documented common protocol/manufacturer first (verify which specific scale hardware the business actually uses or plans to use before building against an assumed protocol) rather than building speculative multi-vendor support.
- **Data flow:** `ReceiptOverlay.tsx` gains a new "Print via connected printer" action alongside the existing "Print Receipt" (`window.print()`) button — feature-detected (`'usb' in navigator` / `'serial' in navigator`), offering device-pairing on first use (browser-native permission prompt), building an ESC/POS byte sequence (item lines, totals, cut, optional drawer-kick) client-side, and writing it via the paired `USBDevice`/`SerialPort`. Drawer-kick-on-sale (independent of printing, for a cashier who wants the drawer to pop without reprinting) is a small separate "Open Drawer" button sending just the kick command to the same paired printer connection.

## Database Changes

Not applicable — this is a pure frontend/hardware-integration gap; no new persisted business data. (A per-device "which printer/scale is paired" preference could optionally be stored in `localStorage`, matching this app's existing `pos_paper_size` convention in `ReceiptOverlay.tsx` — not a Postgres concern either way.)

## Backend

Not applicable — no backend service is involved in this gap. Cash-drawer-kick, scale reads, and raw ESC/POS printing are entirely client-side/local-hardware concerns; nothing here needs to reach sales-service or any other backend service.

## Frontend

- **`ReceiptOverlay.tsx` changes:** add a feature-detected "connected printer" path alongside the existing `window.print()` button — pairing flow (`navigator.usb.requestDevice()` / `navigator.serial.requestPort()`), an ESC/POS byte-builder function (new module, e.g. `apps/pos-frontend/src/escpos.ts`, pure functions turning `CompletedSale` data into a raw byte sequence — text lines, cut command, optional drawer-kick), and a write call to the paired device. The existing paper-size selector and `window.print()` button remain unchanged and always available.
- **New "Open Drawer" action:** a small button in `POSScreen.tsx`'s header (near the existing sync-status/theme-toggle icons) or in `ReceiptOverlay.tsx`, sending just the drawer-kick ESC/POS command to whatever printer is currently paired — disabled/hidden if no printer is paired or the browser lacks WebUSB/WebSerial support.
- **Scale integration (if a specific scale device is confirmed in scope — verify with the business before building):** a small "Read Scale" affordance on cart lines for weight-based items, opening a WebSerial connection, reading a weight frame, and populating the line's quantity field. Given the higher protocol-variance risk here versus the printer case, this sub-feature should be treated as the more speculative/lower-confidence half of this package — if no specific scale hardware is confirmed, defer this part and ship the printer/drawer-kick integration alone, rather than guessing at a protocol nobody has validated against real hardware.
- **Graceful degradation:** every new UI element in this package must be feature-detected and either hidden or clearly disabled-with-explanation (not a broken button) when `navigator.usb`/`navigator.serial` are unavailable (Safari/iOS) — matching OFFLINE-06's `supportsBackgroundSync()` precedent exactly.
- **Accessibility:** new buttons follow this app's existing `aria-label` conventions (axe-core harness coverage expected, same as every other pos-frontend screen).

## API Contract

Not applicable — no new REST endpoint. All communication in this package is browser-to-USB/Serial-device, not browser-to-backend-service.

## Multi-Tenant Considerations

Not applicable — hardware pairing is a per-device, per-browser-profile concern (a WebUSB/WebSerial permission grant is scoped to the browser origin + physical device, not to any tenant/user identity). No tenant-isolation implication.

## Integration

- **apps/pos-frontend:** the entirety of this package's work.
- No other service is touched. This is one of the few gaps in this backlog that is genuinely single-app in scope.

## Coding Standards

Follows this app's existing feature-detection convention (`supportsBackgroundSync()` in `POSScreen.tsx` as the template) rather than assuming API availability. Follows `ReceiptOverlay.tsx`'s existing component structure for the new print-path addition rather than a rewrite. No new state-management library needed — device-pairing state is transient (lives for the tab's lifetime, or persisted to `localStorage` as a device preference, matching `pos_paper_size`'s existing pattern) and doesn't need a dedicated store.

## Performance

Not applicable in the caching/indexing sense. The one relevant consideration: WebUSB/WebSerial device I/O is asynchronous and should never block the checkout flow — a failed or slow printer write must not delay the next sale from starting (matches this app's existing philosophy of never letting a secondary concern, like receipt sending in `ReceiptOverlay.tsx`'s WhatsApp/Email buttons, block the primary "New Sale" action).

## Security

- WebUSB/WebSerial device access requires explicit user gesture + browser permission prompt (browser-enforced, not something this app's code can weaken or strengthen) — this is a stronger security model than a native companion app would have (no arbitrary background hardware access, no elevated OS permissions needed).
- No PII or business data is exposed to the paired device beyond what's already printed on a physical receipt today (item names, prices, totals) — no new data-exposure surface versus the existing `window.print()` path.
- No new RBAC/permission constant is needed — hardware pairing/printing is a device-operational concern, not a business-permission concern (any cashier who can complete a sale can already print its receipt via the existing button).

## Testing

- **Unit:** new `apps/pos-frontend/src/__tests__/escpos.test.ts` covering the byte-builder functions (given a `CompletedSale`, produces the expected ESC/POS byte sequence including the cut and drawer-kick commands) — pure-function logic, testable without real hardware.
- **Integration/manual:** WebUSB/WebSerial device I/O cannot be meaningfully unit-tested without real or emulated hardware — this package's acceptance should include a manual verification checklist (pair a real/representative thermal printer, confirm print output and drawer-kick fire correctly) rather than claiming automated coverage that isn't achievable for actual hardware I/O.
- **Feature-detection tests:** confirm the new UI elements render in a disabled/hidden state when `navigator.usb`/`navigator.serial` are mocked as absent, extending the same testing shape OFFLINE-06's Background Sync feature-detection already uses.

## Acceptance Criteria

- [ ] The existing `window.print()` browser-print path in `ReceiptOverlay.tsx` continues to work unchanged for every till — verifiable by confirming no regression in that existing button's behavior.
- [ ] On a Chromium browser with a WebUSB/WebSerial-compatible printer paired, a real print produces correctly formatted thermal output including a drawer-kick pulse — verifiable via manual hardware test (documented in the deliverable, since this can't be asserted by an automated test).
- [ ] On Safari/iOS (or any browser lacking WebUSB/WebSerial), the new hardware-integration UI is absent or clearly disabled, with the standard `window.print()` path remaining fully usable — verifiable via a feature-detection unit test plus manual check on an actual Safari session.
- [ ] The ESC/POS byte-builder functions have unit test coverage for at least: item lines, totals, paper cut, and drawer-kick command generation.
- [ ] If scale integration is included in this pass: a confirmed real scale device/protocol was validated against before shipping (not built speculatively against an assumed, unverified protocol).

## Deliverables

- **Files to create:** `apps/pos-frontend/src/escpos.ts` (byte-builder module), `apps/pos-frontend/src/__tests__/escpos.test.ts`; optionally a `apps/pos-frontend/src/scaleReader.ts` if scale integration is confirmed in scope.
- **Files to modify:** `apps/pos-frontend/src/components/pos/ReceiptOverlay.tsx` (new connected-printer path, drawer-kick action), `apps/pos-frontend/src/POSScreen.tsx` (possible "Open Drawer" header action, scale-read wiring on cart lines if in scope).
- **Migrations:** none.
- **APIs added/changed:** none.
- **Events added/changed:** none.
- **Tests added:** `escpos.test.ts`; feature-detection tests for the new UI elements' disabled/hidden state.

---

## Context Preservation (for a fresh AI session with no prior history)

**Previous Work Summary:** pos-frontend prints receipts via `window.print()` only (`ReceiptOverlay.tsx`), with no cash-drawer-kick or weighing-scale integration anywhere. The app already has one working precedent for browser-native hardware access — camera-based barcode scanning via `@zxing/browser` (`POSScreen.tsx`) — and one working precedent for graceful feature-detection of a browser API with partial support — Background Sync (`supportsBackgroundSync()`, OFFLINE-06).

**Current Objective:** Add WebUSB/WebSerial-based direct ESC/POS printing (with drawer-kick) as an additional, feature-detected path alongside the existing browser-print fallback (which must remain functional permanently, not be deprecated), and — only if a specific scale device is confirmed in scope — a WebSerial-based scale-reading integration.

**Architecture Snapshot:**
1. `ReceiptOverlay.tsx`'s `window.print()` (line 101) + `PAPER_SIZES` map (lines 10-14) is the existing, must-remain-working receipt path.
2. `@zxing/browser`'s `BrowserMultiFormatReader` in `POSScreen.tsx` is this app's existing precedent for "browser API accesses physical hardware."
3. `supportsBackgroundSync()` (`POSScreen.tsx` lines 69-71) is this app's existing precedent for feature-detecting a partially-supported browser API and documenting the fallback explicitly.
4. WebUSB is entirely unavailable on Safari/iOS — any Safari/iOS till gets zero hardware integration from this package and must keep using `window.print()`; this is a platform limitation, not a bug to chase.
5. This system has deliberately never introduced a native companion app anywhere in the POS stack (offline-first browser SPA architecture, OFFLINE-01–07) — recommending one now for hardware access would be a real architectural reversal, not justified unless WebUSB/WebSerial prove insufficient for the actual printer/scale hardware in use.

**Completed Components:** Camera barcode scanning (`@zxing/browser`), Background Sync (OFFLINE-06) — both reference patterns, neither touched by this package.

**Pending Components:** Scale integration is explicitly the lower-confidence half of this package — do not build it against an assumed/unverified protocol; confirm real scale hardware with the business first, and ship the printer/drawer-kick half alone if scale hardware isn't yet confirmed.

**Known Constraints:** WebUSB/WebSerial hardware I/O cannot be meaningfully covered by automated tests without real or emulated devices — acceptance for the hardware-I/O parts of this package necessarily includes a manual verification step, not just a test-suite pass.

**Coding Standards:** See "Coding Standards" section above — follows the existing feature-detection and component-extension conventions already established in this app; no new state-management library.

**Reusable Components:** `supportsBackgroundSync()`'s feature-detection shape (as a pattern to replicate for `'usb' in navigator`/`'serial' in navigator`), `ReceiptOverlay.tsx`'s existing structure (extend, don't replace), `POSButton`/`POSCard` for any new UI.

**APIs Already Available:** Not applicable — this package adds no backend API calls.

**Events Already Available:** Not applicable.

**Shared Utilities:** Not applicable — pure frontend/browser-hardware work.

**Feature Flags:** Not strictly necessary given the work is already self-gating via browser feature-detection, but a tenant-level "hardware integration enabled" flag could be considered if some tenants explicitly don't want cashiers attempting device pairing — optional, not required for this package's core deliverable.

**Multi-Tenant Rules:** Not applicable — hardware pairing is per-device/per-browser-origin, not tenant-scoped.

**Security Rules:** No new permission constant needed — printing/drawer-kick is available to any cashier who can already complete a sale.

**Database State:** Not applicable — no schema involvement.

**Testing Status:** No existing test coverage for hardware integration (none exists yet, since no hardware-integration code exists yet). `escpos.ts`'s pure byte-building logic should get full unit coverage; actual device I/O needs manual verification per the Testing section.

**Next Session Plan:** Given the L complexity and the scale-integration uncertainty, this package should be split: **Session 1** — ESC/POS byte-builder + WebUSB/WebSerial printer pairing + drawer-kick, fully unit-tested and manually verified against at least one real printer. **Session 2 (only if scale hardware is confirmed in scope)** — scale-reading integration against the specific confirmed device/protocol.

**Prompt for the Next Session:** "Read `ERP-PLANNING/production-gap-prompts/013-POS/48-pos-native-hardware-integration.md` in full. Before writing any scale-related code, confirm with the business/product owner whether a specific weighing-scale device/protocol is actually in scope — if not, implement only the printer/drawer-kick half (Session 1 in this file's 'Next Session Plan'). Build `apps/pos-frontend/src/escpos.ts` with full unit test coverage, then extend `ReceiptOverlay.tsx` with a feature-detected WebUSB/WebSerial printer-pairing and print path alongside the existing, unchanged `window.print()` button, plus a drawer-kick action. Verify manually against at least one real thermal printer before considering this package complete."
