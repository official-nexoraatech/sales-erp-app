# PG-052 — POS Native Hardware Integration (Session 1) — Completion Report

**Date:** 2026-07-11
**Status:** Session 1 complete (ESC/POS byte-builder + WebUSB/WebSerial printer pairing +
drawer-kick). Session 2 (weighing-scale integration) deferred — no specific scale device/protocol
has been confirmed in scope, per the gap-prompt's own explicit instruction not to build against an
assumed protocol.

## Summary

pos-frontend previously had no cash-drawer-kick, no scale integration, and receipt "printing" was
`window.print()` only. This session adds a feature-detected, additional printing path — raw
ESC/POS bytes written directly to a paired WebUSB or Web Serial thermal printer — alongside the
existing `window.print()` button, which is untouched and remains the permanent fallback for any
till whose browser/printer doesn't support WebUSB/WebSerial (all of Safari/iOS, per Apple's WebKit
policy).

- New `apps/pos-frontend/src/escpos.ts` — pure byte-builder functions (`buildReceipt`,
  `buildDrawerKickOnly`, plus the individual ESC/POS command builders `cmdInit`/`cmdBold`/
  `cmdAlign`/`cmdCut`/`cmdDrawerKick`/`cmdFeed`). Money values render as `Rs.` rather than `₹`
  since ESC/POS printer codepages don't reliably include the rupee glyph.
- New `apps/pos-frontend/src/webPrinter.ts` — pairing (`pairUsbPrinter`/`pairSerialPrinter`),
  silent reconnect to a previously-granted device (`reconnectPairedPrinter`, using
  `getDevices()`/`getPorts()` which never prompt), and `writeToPairedPrinter()` which pairs on
  demand if nothing is paired yet. Feature-detection: `supportsUsbPrinting()`/
  `supportsSerialPrinting()`/`supportsAnyPrinting()`, mirroring `supportsBackgroundSync()`'s shape
  in `POSScreen.tsx` exactly.
- New `apps/pos-frontend/src/webPrinterTypes.d.ts` — minimal ambient types for the WebUSB/Web
  Serial APIs (no `@types` package exists for either); narrowed to only the members this app
  calls, not the full W3C spec surface.
- `ReceiptOverlay.tsx`: new "Print via connected printer" button, shown only when
  `supportsAnyPrinting()` is true **and** the selected paper size is thermal (`80mm`/`58mm` — A4
  is hidden from this path, since raw ESC/POS printing doesn't apply to A4/inkjet-laser output).
  The existing paper-size selector and `window.print()` button are unchanged.
- `POSScreen.tsx`: new "Open cash drawer" icon button in the header (next to the theme toggle),
  shown only when `supportsAnyPrinting()` is true, sending just the drawer-kick command to
  whatever printer is currently paired (pairing on demand if nothing is paired yet).

## Deviations from the gap-prompt (flagged during implementation, not silently decided)

1. **Scale integration deferred entirely (Session 2 not started).** The gap-prompt itself
   instructs: "if no specific scale hardware is confirmed, defer this part and ship the
   printer/drawer-kick integration alone, rather than guessing at a protocol nobody has validated
   against real hardware." No business/product owner confirmation of scale hardware was available
   this session, so `scaleReader.ts` was not built. This is the documented default path, not a
   scope cut made unilaterally.
2. **A4 paper size hides the hardware-print button.** The gap-prompt doesn't explicitly address
   this, but ESC/POS raw byte printing is a thermal-printer protocol — sending it to whatever's
   printing A4 (typically inkjet/laser via the OS driver) has no defined meaning. Gating the
   button on `paperSize !== 'A4'` (implemented via `PAPER_SIZES[size].widthChars !== null`) avoids
   offering an action that can't work correctly.
3. **USB endpoint/interface numbers are a fixed default (interface 0, endpoint 1), not
   configurable per-device.** The gap-prompt's Architecture section itself flags "real
   per-device/per-browser compatibility variance" as inherent to this work. Interface 0 / endpoint
   1 is the common convention most USB thermal printers and existing WebUSB-escpos libraries use
   as a default; a printer that doesn't match this convention will fail the write with a clear
   error (`USB printer write failed: ...`) rather than silently misbehaving. Making this
   configurable per-device was judged out of scope for Session 1 — flag for a future session if a
   real printer is found that doesn't match this default.

## Acceptance Criteria

- [x] The existing `window.print()` browser-print path in `ReceiptOverlay.tsx` continues to work
      unchanged — verified by reading the diff (the button/paper-size selector logic is untouched)
      and by `hardwarePrinting.test.tsx` asserting "Print Receipt" still renders in both the
      supported- and unsupported-browser cases.
- [ ] Real thermal printer manual verification (print output + drawer-kick fire correctly) — **not
      performed this session** (no live hardware, no Docker/dev server run). Documented here as
      required before relying on this in production, per the gap-prompt's own Testing section
      ("acceptance for the hardware-I/O parts of this package necessarily includes a manual
      verification step, not just a test-suite pass").
- [x] On a browser lacking WebUSB/Web Serial (Safari/iOS simulated via deleting
      `navigator.usb`/`navigator.serial`), the new hardware-integration UI (both the
      connected-printer button and the Open Drawer header button) is absent, with `window.print()`
      remaining fully usable — covered by `hardwarePrinting.test.tsx` and `webPrinter.test.ts`.
- [x] ESC/POS byte-builder functions have unit coverage for item lines, totals, paper cut, and
      drawer-kick command generation — `escpos.test.ts`, 7 cases.
- [x] Scale integration: not included this pass, per the documented default above.

## Verification performed this session

- `pnpm --filter @erp/pos-frontend type-check` — clean.
- `pnpm --filter @erp/pos-frontend test` — 120 passed (full suite, up from 108 at PG-051): 7 new
  `escpos.test.ts` cases, 3 new `webPrinter.test.ts` feature-detection cases, 2 new
  `hardwarePrinting.test.tsx` UI feature-detection cases. No regressions in any pre-existing test.
- `npx eslint` on all new/touched files — only pre-existing monorepo-wide lint debt (`no-undef` on
  `navigator`/`window`/`localStorage`/`TextEncoder`/`USBDevice`/`EventTarget`/etc. — see project
  memory `preexisting_lint_debt`; every existing browser-API file in this app, e.g. `session.ts`,
  `swSync.ts`, `sw.ts`, has the identical pattern from a missing ESLint browser-globals config).
  No new categories of lint error introduced.
- No live browser or real-hardware verification this session (no Docker/dev server, no physical
  thermal printer available) — the manual verification checklist the gap-prompt requires for the
  hardware-I/O acceptance criteria is **outstanding**, tracked below.

## Files touched

- `apps/pos-frontend/src/escpos.ts` — new.
- `apps/pos-frontend/src/webPrinter.ts` — new.
- `apps/pos-frontend/src/webPrinterTypes.d.ts` — new.
- `apps/pos-frontend/src/components/pos/ReceiptOverlay.tsx` — new "Print via connected printer"
  button + `printViaHardware` handler; `PAPER_SIZES` map extended with `widthChars`.
- `apps/pos-frontend/src/POSScreen.tsx` — new "Open cash drawer" header button + `openDrawer`
  handler; silent `reconnectPairedPrinter()` call added to the existing mount `useEffect`.
- `apps/pos-frontend/src/__tests__/escpos.test.ts` — new.
- `apps/pos-frontend/src/__tests__/webPrinter.test.ts` — new.
- `apps/pos-frontend/src/__tests__/hardwarePrinting.test.tsx` — new.
- `ERP-PLANNING/production-gap-prompts/IMPLEMENTATION-NOTES.md` — new PG-052 entry.

## Deployment Checklist

- [x] No migration — no schema change, matches the gap-prompt's own "Not applicable" call.
- [x] No new environment variables, no new backend API, no new RBAC permission — matches the
      gap-prompt's Database/Backend/API Contract/Security sections, all "Not applicable."
- [ ] **Manual hardware verification required before production reliance:** pair at least one
      real WebUSB or Web Serial thermal printer on a Chromium browser, confirm the printed output
      is correctly formatted and the drawer-kick pulse actually fires. Not performed this session
      — no physical hardware or live environment available. This is a real open item, not a
      formality.
- [ ] **Business/product confirmation needed before Session 2:** if scale-based weighing is
      wanted, confirm the specific scale device/protocol in use before any `scaleReader.ts` work
      begins.
