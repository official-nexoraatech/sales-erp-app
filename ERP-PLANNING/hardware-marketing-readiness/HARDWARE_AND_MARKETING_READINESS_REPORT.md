# Hardware & Marketing Services Readiness Report

**Date:** 2026-07-05
**Prepared for:** Client "complete setup" request — barcode scanner, barcode printer, billing printer, marketing services
**Scope reviewed:** the active product — `apps/*` Node/TypeScript microservices, including `apps/web-frontend` (main back-office app) and `apps/pos-frontend` (a separate, dedicated point-of-sale screen).
**Out of scope:** this repo also contains an earlier prototype (`sale-erp-backend` — Java/Spring Boot, `sale-erp-froentend` — React "Texmintra") abandoned around 2026-06-28 in favor of the current rewrite, and not part of the pnpm workspace. It's mentioned once below because it happens to contain the most complete barcode-label-printing code in the whole repo — worth salvaging, not worth treating as part of "almost done."

---

## Bottom line

| Client ask | Status |
|---|---|
| Barcode **scanner** (scan-to-bill) | 🟡 Real scan input exists in the POS screen, but only matches a small local "quick items" list — not the full catalog |
| Barcode **printer** (product labels) | 🔴 Value-generation backend exists; **no label rendering, no print page, anywhere in the shipping product** |
| **Billing printer** (invoice/receipt printing) | 🔴 A4 invoice PDF engine is real and solid, but **no button triggers it anywhere**, and the POS screen prints **nothing at all** after a sale |
| **Marketing services** (SMS/WhatsApp/Email campaigns) | 🟢 Real, working, close to production-ready |

None of this requires custom device drivers — barcode scanners are USB "keyboard wedge" devices and printers work through the OS print dialog or a generated PDF, neither of which needs special hardware code. The gap is entirely in the **application workflows**: some exist half-built, one is missing outright, and — importantly — **the cashier training material describes features that don't exist in the code yet.**

---

## 1. Barcode Scanner (scan items during billing)

**What exists:**
- Item and item-variant barcode fields, indexed and unique per tenant (`packages/db-client/src/schema/items.ts:180,222-226,240,258-260`).
- Two real, Redis-cached, tenant-scoped barcode-lookup APIs: `GET /items/by-barcode/:barcode` in `apps/inventory-service/src/api/item.routes.ts:80-113`, and a second one in `apps/production-service` (`BarcodeService.lookupByValue`, <50ms cached).
- **A real, dedicated POS screen** at `apps/pos-frontend/src/POSScreen.tsx` — separate from the main back-office `web-frontend` app. It has:
  - A barcode input auto-focused on load and refocused after every sale (`:162, 245`).
  - An `onKeyDown` handler that on Enter checks the typed/scanned value against a locally-fetched `quickItems` list (`:276-283`) — this is the correct keyboard-wedge scanner pattern.
  - Offline-first design: queues sales in IndexedDB and syncs via a service worker when connectivity returns (`offlineDb.ts`, `sw.ts`) — a genuinely useful feature for a retail counter with flaky internet.

**What's missing:**
- **The scan match is local-only.** It checks against `quickItems` (`GET /pos/quick-items`, a small curated grid, presumably fast-moving items), not a live call to either of the real barcode-lookup APIs above. Scan a barcode for anything outside that quick-items set and **nothing happens** — no error, no fallback lookup, it silently fails to add the item.
- The main `web-frontend` app (used for full invoice creation, not quick counter sales) has **no scan-oriented input at all** — its "Search items to add..." box (`apps/web-frontend/src/pages/sales/InvoiceFormPage.tsx:263-283`) is a name-search-and-click flow with no Enter-to-add behavior and no barcode API call.
- Self-documented in the codebase's own audit: `FUNCTIONAL_AUDIT_REPORT.md:88` — *"POS: Barcode scanner hardware integration absent (HID/camera)"* (rated P1) and `:249` — *"No barcode format checksum validated for EAN-13 on client side."*

**Effort to close:** small-to-medium. Wire the POS barcode input to fall back to the real `/items/by-barcode/:value` lookup when there's no local quick-item match. That's most of the way to "scan anything in the catalog, not just the quick list."

---

## 2. Barcode Printer (product label printing)

**What exists:**
- `apps/production-service/src/domain/BarcodeService.ts` generates real EAN13 (correct check-digit math), CODE128, and QR values, in batches, with a chosen print format (`A4_SHEET` / `LABEL_40x25` / `LABEL_60x40`).
- Routes for generate/print-data/deactivate/list exist and are RBAC-gated (`apps/production-service/src/api/barcode.routes.ts`).
- `apps/web-frontend/src/api/endpoints.ts:744-756` has client methods for all of this wired up and ready to call.

**What's missing — this is the biggest gap of the four:**
- **`GET /barcodes/print/:batchId` returns JSON, not an image or PDF.** There is no barcode-rendering library anywhere in the shipping product (`apps/production-service`, `apps/web-frontend`) — no `jsbarcode`, `bwip-js`, or canvas-based rendering. The data needed to print a label exists; nothing turns it into a visible barcode.
- **No page in `apps/web-frontend` calls any of the batch-generate/print-data endpoints** — confirmed no `pages/production/Barcode*.tsx` exists at all.
- The only barcode-related button reachable in the UI today is "Barcode" on the Items list (`apps/web-frontend/src/pages/items/ItemsPage.tsx:95`), which calls a **different, simpler, explicitly-stubbed endpoint** in `inventory-service` (`apps/inventory-service/src/api/item.routes.ts:422-455`) — its own code comment says `// Real implementation: use barcode library (bwip-js)`, and `bwip-js` isn't installed anywhere. It just toasts the generated numeric string as text — no visual barcode, no label, no print.
- **A complete, working reference implementation already exists — just not in the active codebase.** The abandoned prototype's frontend (`sale-erp-froentend/src/pages/utilities/GenerateBarcodePage.tsx`) renders real barcode/QR images with `jsbarcode` + `qrcode`, supports label sizes (100×50mm, 100×25mm, 50×25mm), and opens a print-formatted popup sized to the label stock. This is genuinely portable — it's the fastest path to closing this gap, by porting that page's logic into `apps/web-frontend`.

**Effort to close:** small-to-medium — the barcode-*value* logic (hard part) is done; what's missing is largely a UI rendering task, and there's already working reference code for it in the old prototype.

---

## 3. Billing Printer (printing the invoice/receipt)

**What exists:**
- A genuinely solid PDF engine: `apps/report-service/src/domain/PdfEngine.ts` uses **headless Chrome (Puppeteer)** to render Handlebars templates (`TAX_INVOICE`, `PAYMENT_RECEIPT`, `QUOTATION`, `DELIVERY_CHALLAN`, `PURCHASE_ORDER`, `SALARY_SLIP`, `PROFIT_LOSS`) to real A4 PDFs, including GST breakdowns and the e-invoice QR code.
- `GET /invoices/:id/pdf` (`apps/sales-service/src/api/invoice.routes.ts:203-304`) assembles the full invoice + customer + signed e-invoice QR and streams back a real PDF.
- One working example of print-via-browser exists: `apps/web-frontend/src/pages/hr/PayslipViewPage.tsx:88` calls `window.print()` for salary payslips with proper print CSS.

**What's missing:**
- **`invoiceApi.pdf()` is defined in the frontend API client but called from nowhere.** `InvoiceDetailPage.tsx` and every other file under `pages/sales/` has no Print or Download-PDF button. The capability is real and backend-complete; a user cannot reach it today.
- **The POS screen's "Complete Sale" button produces zero receipt output of any kind** — it ends with a toast notification and nothing else (`apps/pos-frontend/src/POSScreen.tsx:234-247`). No print call, no PDF fetch, no on-screen receipt.
- **This directly contradicts the cashier training guide** (`docs/training/CASHIER_GUIDE.md:46-48`): *"Receipt prints automatically if printer is connected... Click WhatsApp to send digital receipt to customer's phone."* Neither auto-print nor a WhatsApp-receipt button exists in the code. The same doc also describes a Discount button, a Split payment mode, and a UPI QR-code display at checkout (`:28-31, 41-43`) — **none of these exist in `POSScreen.tsx` either.** If cashiers are trained on this guide as-is, they'll hit a wall on day one.
- The PDF engine is A4-only (`portrait`/`landscape`) — there's no 58mm/80mm thermal-receipt format. If the client's "billing printer" specifically means a thermal receipt printer (typical for a retail counter), that format doesn't exist yet; today's output is a full A4 tax invoice.
- No ESC/POS, thermal-printer library, or WebUSB/WebSerial/WebHID code anywhere — consistent with the rest of the app relying on OS print dialogs rather than talking to devices directly (normal for this kind of app, just noting it explicitly).
- Self-documented gap: `FUNCTIONAL_AUDIT_REPORT.md:307` — *"AlterationsPage: No print/PDF button for alteration order receipt."*

**Effort to close:**
- Wiring the existing A4 invoice PDF to a button on `InvoiceDetailPage`: small — the fastest win in this whole report.
- Giving the POS screen *any* receipt (even just an on-screen printable summary via `window.print()`, matching the payslip pattern already in the codebase): small.
- A dedicated thermal-receipt template, if the client specifically wants slip printing: small-to-medium, and should be scoped explicitly since it's a distinct format from the existing A4 engine.
- Aligning `CASHIER_GUIDE.md` to what the POS screen actually does (or building the missing pieces — discount, split payment, UPI display, print/WhatsApp receipt — to match the guide): needs a decision either way, since right now the training material and the product disagree.

---

## 4. Marketing Services (SMS / WhatsApp / Email campaigns)

**This is the one area that's genuinely close to done.**

- Real third-party integrations in `apps/notification-service/src/domain/NotificationEngine.ts`: **MSG91** (SMS), **SendGrid** (Email), **Meta Cloud API** (WhatsApp) — actual API calls, not stubs, with retry-with-backoff, quiet-hours enforcement (22:00–08:00 IST for SMS), dedup, and per-user channel preferences.
- `apps/sales-service/src/domain/CampaignService.ts` — full campaign engine: targets a saved customer segment or explicit list, renders message templates with live variables, warns on SMS length limits, dispatches through a circuit-breaker (so a notification-service outage fails fast instead of hanging), tracks per-recipient delivery status, and supports the full draft → schedule → send → cancel lifecycle.
- Customer segmentation (`SegmentService`) — 6 pre-built segments (no-purchase-60-days, gold-tier, overdue, birthdays-this-month, etc.) plus a custom rule engine.
- Full campaign builder UI (`apps/web-frontend/src/pages/crm/CampaignFormPage.tsx`, `CampaignsPage.tsx`, `SegmentsPage.tsx`) with channel picker, recipient preview, and live character-limit warnings.
- Automation already running: payment-reminder campaigns for overdue invoices (WhatsApp→SMS fallback + Email), invoice-confirmed notifications, and daily birthday-greeting sends.
- Customer opt-out (`opt_out_sms`/`opt_out_whatsapp`/`opt_out_email`) with a toggle UI on the customer view page.

**Known, self-documented gaps:**
- **Opt-out is not enforced on campaign sends or birthday greetings yet** — the flags exist, but `CampaignService.resolveRecipients()` and the birthday-greeting job don't filter on them. This is a real compliance gap, explicitly logged as follow-up work in `ERP-PLANNING/phase-completions/ES-18_COMPLETION.md`.
- Campaign send is **synchronous in the HTTP request, no queue** — will block on large (10k+) recipient segments; flagged as a scaling risk for later.
- The `IN_APP` notification channel is a stub — it writes a DB row but doesn't actually push in real time.
- Two independent email-sending code paths exist in the codebase (SendGrid for marketing/CRM, a separate `nodemailer`/SMTP path for scheduled report delivery) — not a bug, just worth knowing they're not unified.
- `.env.example` doesn't list the MSG91/SendGrid/WhatsApp credential variables the code actually reads — only SMTP is documented there, so a deployment checklist should call these out explicitly.

**Effort to close the compliance gap:** small — retrofit the two send paths to check the three opt-out columns that already exist.

---

## Cross-cutting: Hardware Integration Layer

There is no physical-device driver layer anywhere in this codebase — no `serialport`, `WebUSB`, `WebSerial`, `navigator.usb`/`navigator.serial`, ESC/POS, or ZPL code. Everything that touches hardware relies on:
- **Keyboard-wedge emulation** for barcode scanners (the scanner types into a focused input + sends Enter) — implemented, partially, in `apps/pos-frontend`.
- **OS-level browser print dialogs** (`window.print()`) for anything visual — used exactly once today, for HR payslips.
- **Server-side PDF rendering via headless Chrome** for A4 documents — real and solid, but not yet reachable from any button, and not thermal-format.

This is a normal, standard architecture for this kind of app — no need to build custom drivers. The work that remains is entirely application-level: wiring existing backend capability to UI buttons, adding barcode image rendering, and deciding whether a thermal-receipt format is actually required.

---

## Summary Table

| Feature | Backend | Frontend UI | Ready to demo to client? |
|---|---|---|---|
| Barcode value generation (EAN13/CODE128/QR) | ✅ | ⚠️ one button, wrong/stub endpoint | No |
| Barcode scan-to-bill (POS) | ✅ (full-catalog lookup API) | ⚠️ works, but only against a small local list | Partially — works for "quick items" only |
| Barcode label printing | ✅ (batch + print-data) | ❌ no rendering, no page | No |
| Invoice PDF (A4) | ✅ | ❌ no button calls it | No |
| POS receipt printing | ❌ (no thermal format) | ❌ nothing happens after "Complete Sale" | No |
| Thermal/58-80mm receipt format | ❌ | ❌ | No |
| SMS/WhatsApp/Email marketing campaigns | ✅ | ✅ | **Yes** — with the opt-out enforcement gap disclosed |

## Recommendation

Marketing services can be shown to the client today as working, with the opt-out enforcement gap disclosed as a fast follow-up. The three hardware-adjacent asks — barcode scanner, barcode printer, billing printer — all have real backend groundwork but no complete, clickable path in the app yet, so don't present them as delivered. None of the three requires new architecture; they're UI wiring and one rendering component each (and there's already working reference code for the label-printing piece in the old prototype). Before any client demo or cashier training rollout, also reconcile `docs/training/CASHIER_GUIDE.md` with what `POSScreen.tsx` actually does — right now the guide promises discount handling, split payment, UPI QR display, and auto-print/WhatsApp receipts that don't exist in the code, which will surface as confidence-damaging surprises in front of the client or their staff.
