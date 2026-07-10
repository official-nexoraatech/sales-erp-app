# Offline-First Architecture Roadmap for Cloth ERP

**Date:** 2026-07-05
**Status:** All 10 phases of this program are now COMPLETE — `OFFLINE-01` through `OFFLINE-10` (see `ERP-PLANNING/phase-completions/OFFLINE-0{1..9}_COMPLETION.md` and `OFFLINE-10_COMPLETION.md`). Architecture, sync protocol, local DB, and conflict-resolution flow as actually built are documented in `ERP-PLANNING/reports/OFFLINE_ARCHITECTURE.md`. This closes the original 15-phase spec's offline scope to the subset that was actually prioritized (`apps/pos-frontend` only; `apps/web-frontend` remains online-only, per the OFFLINE-09 rescoping decision) — see `OFFLINE_ARCHITECTURE.md`'s "Known gaps" section for what remains open.
**Companion documents:**
- `ERP-PLANNING/reports/OFFLINE_READINESS_REPORT.md` — the detailed current-state audit this roadmap builds on (read that first for full evidence).
- `ERP-PLANNING/audit-phase-prompts/OFFLINE-01` through `OFFLINE-10` — the executable phase-prompt series this roadmap decomposes into, following the same convention as the existing `ES-01`–`ES-37` remediation phases.

---

## Why this document exists

The client wants Cloth ERP to keep operating through multi-hour internet outages in retail stores, with automatic, safe synchronization on reconnect — matching the bar set by Shopify POS, Square POS, Microsoft Dynamics 365, SAP Business One, and Odoo. The brief driving this work is explicit that its own Phase 1 ("Architecture Audit") must produce an implementation roadmap **before** any code changes are made, and that the work must reuse existing architecture rather than rebuild the ERP. This document is that roadmap.

---

## Phase 1 — Architecture Audit (complete)

### Current state, evidence-backed

- **Only `apps/pos-frontend` has any offline capability at all.** `apps/web-frontend` — the majority of the ERP's functionality (invoicing, inventory, accounting, HR, CRM, GST, reports) — has zero service worker, zero IndexedDB, zero offline queue, and zero PWA manifest. A dropped connection there simply throws and shows a toast; unsaved work is lost with no recovery path.
- **pos-frontend's offline surface is narrow and unsafe on retry.** It uses raw IndexedDB (one object store, `pending_sales`, in `offlineDb.ts`) synced via a manual `window.online` listener or a "Sync now" button (`POSScreen.tsx`). There is no Background Sync API usage despite a service worker already existing — its `SYNC_PENDING`/`DO_SYNC` message-passing scaffold (`sw.ts:53-65`) is dead, unreachable code.
- **The most severe finding: no idempotency key exists anywhere in the offline-sale flow.** `POST /pos/sales` (`apps/sales-service/src/api/pos.routes.ts`) mints a fresh `POS-${tenantId}-${Date.now()}` invoice number on every call. A retried sync — caused by a lost acknowledgment, the single most common failure mode on unstable connections — creates a second real invoice, a second stock deduction, a second payment record, and duplicated loyalty-points accrual. Nothing in the schema or handler catches this.
- Held sales, customer search/creation beyond the cached quick-items list, returns (delegated entirely to the offline-incapable `web-frontend`), and receipt delivery are all online-only, even inside `pos-frontend` itself.
- **No desktop packaging and no installable PWA exist anywhere in the repository.** Zero Electron/Tauri/NW.js/Capacitor across all 25 `package.json` files in the monorepo; neither frontend has a `manifest.json`.
- **A previously-unknown, critical blocker surfaced during this audit: POS access tokens expire in 15 minutes, and `apps/pos-frontend` has no refresh-token flow at all.** Login (`LoginScreen.tsx`) persists only the access token to `localStorage`; the refresh token issued at login is discarded. The backend's `POST /auth/refresh` (`apps/auth-service/src/routes/refresh.ts`) is real and working, but nothing in `pos-frontend` calls it. **A device offline for several hours will have a dead access token by the time connectivity returns — every sync request will 401, and the current code path clears the token outright, forcing a fresh login before the queued sales can flush.** This must be fixed before any sync design can work for the outage durations this project cares about.
- **A branch-isolation gap exists in the exact endpoint the sync layer will scale up.** `apps/sales-service/src/api/pos.routes.ts` never validates `branchId` against the caller's JWT `branchIds` — it trusts the client-submitted value, scoping only by tenant. The helper that would fix this (`getBranchScope`, `packages/platform-sdk/src/auth.ts`) already exists and is used correctly elsewhere (`invoice.routes.ts`), just not here.

### Reusable infrastructure (design new work around these — do not reinvent)

| Need | Existing pattern to reuse | Location |
|---|---|---|
| Idempotent write claim | Atomic `INSERT ... ON CONFLICT (eventId, consumerService) DO UPDATE ... WHERE status != 'PROCESSED' RETURNING` — a TOCTOU race in this exact mechanism was already found and fixed in ES-24 | `packages/platform-sdk/src/events.ts` (`PlatformEventConsumer.subscribe`) |
| Delta/incremental download | `modifiedSince` + offset pagination, response shape `{content, totalElements, hasMore}` | `apps/sales-service/src/api/search-sync.internal.routes.ts` (duplicated in `tenant-service`) |
| Server-side reference-data caching convention | Generic `TenantScopedCache` (get/set/getJson/setJson/incr/invalidate, auto-namespaced `tenant:{id}:{key}`) | `packages/platform-sdk/src/cache.ts` |
| Atomic stock deduction under concurrent writes | `UPDATE items SET availableQty = availableQty - qty, version = version + 1 WHERE availableQty >= qty`, inside a transaction — already correct, reuse as-is | `apps/sales-service/src/domain/InvoiceService.ts:374-387` |
| Multi-step orchestration with compensation (optional) | `SagaOrchestrator` — generic engine, persists to `saga_log`; only `INVOICE_CREATION` wired today, registry-based so new saga types can be added | `packages/platform-sdk/src/saga.ts` |
| Working token-refresh backend | `POST /auth/refresh` — validates a hashed refresh token, rotates it, reissues an access token with fresh roles/permissions/branchIds | `apps/auth-service/src/routes/refresh.ts` |
| Branch-scoping helper (exists, just unused in `pos.routes.ts`) | `getBranchScope(req.auth)` | `packages/platform-sdk/src/auth.ts`, correctly used in `apps/sales-service/src/api/invoice.routes.ts:84` |

---

## Key architectural decisions

1. **Local storage: Dexie over raw IndexedDB, and over a full local-first sync framework.** `pos-frontend` already talks to IndexedDB directly with no wrapper dependency. That approach doesn't scale past a single object store without a lot of hand-rolled boilerplate for schema versioning, indexes, and reactive queries — all of which the local-database and delta-sync phases need (multiple stores: catalog, customers, price lists, taxes, held sales, sync queue, sync metadata). Dexie is a thin (~25KB), widely-used wrapper over the same native IndexedDB API — an incremental step from the current code, not a replacement of it. A full local-first framework (ElectricSQL, PowerSync, RxDB) is out of scope: adopting one would mean replacing the existing architecture and API conventions, contradicting the "reuse existing architecture" and "avoid unnecessary dependencies" constraints.
2. **Sync protocol: extend the existing delta-sync convention rather than invent a new one.** The "download reference data" side reuses `search-sync.internal.routes.ts`'s `modifiedSince`/pagination/`{content, totalElements, hasMore}` shape, exposed as a new public endpoint per module (items, customers, price lists, taxes). The "upload offline writes" side mirrors the inbox atomic-claim pattern from `events.ts`: every offline-queued write carries a client-generated `operationId`, and the accepting endpoint performs an atomic `INSERT ... ON CONFLICT (operationId) DO NOTHING RETURNING` (or equivalent), so a retried sync is provably a no-op instead of a duplicate.
3. **Fix POS token refresh and the branch-isolation gap first, as prerequisite work, before sync volume lands on either.** Both are correctness/security issues independent of "offline" as a feature; the sync design specifically depends on the access token surviving the outage.
4. **Desktop packaging: PWA manifest first, Electron/Tauri deferred.** A manifest (icons + `manifest.json` + a registration in `index.html`) is small and low-risk, and makes `pos-frontend` installable as a standalone window via the browser's own install mechanism on Windows/macOS/Linux/Android — no new runtime, no auto-update infrastructure, no new attack surface. Electron/Tauri only earns its cost if a concrete hardware requirement forces it (direct ESC/POS access without an OS print dialog, filesystem access, running fully detached from browser chrome). Ship the PWA first; revisit native packaging only if such a requirement surfaces.
5. **Scope order: POS-first, not ERP-wide simultaneously.** The full wishlist (POS breadth, `web-frontend` offline parity, conflict-resolution UI, monitoring dashboards, hardware integration, full test/documentation suites) is a multi-month program if built in one pass, and a big-bang rewrite would violate "don't rebuild, don't touch working modules unnecessarily." The phased plan below sequences POS-hardening first (closes the duplicate-invoice bug), then POS feature breadth, then generalized reference-data sync, with `web-frontend` offline support and enterprise monitoring/hardware phases explicitly last, since they are the largest and least urgent pieces relative to the client's stated pain point (retail counter continuity).

---

## Phased delivery plan

| Phase | Scope | Effort |
|---|---|---|
| **OFFLINE-01** ✅ COMPLETE | Prerequisite fixes: POS refresh-token flow (persist refresh token, silent refresh on reconnect/401), branch-isolation check in `pos.routes.ts` — see `ERP-PLANNING/phase-completions/OFFLINE-01_COMPLETION.md` | Small |
| **OFFLINE-02** ✅ COMPLETE | Idempotency: client-generated `operationId` on every offline-queued sale; backend atomic dedupe on `POST /pos/sales`; dead `incrementRetries`/backoff wired up with a max-retry + stuck-item state — see `ERP-PLANNING/phase-completions/OFFLINE-02_COMPLETION.md` | Small–Medium |
| **OFFLINE-03** ✅ COMPLETE | Local DB upgrade: migrate `offlineDb.ts` to Dexie with proper schema/versioning; add stores for cached catalog, customers, price lists, taxes — see `ERP-PLANNING/phase-completions/OFFLINE-03_COMPLETION.md` | Medium |
| **OFFLINE-04** ✅ COMPLETE | Delta-sync download endpoint(s) (reusing the `search-sync` convention) + client-side periodic/on-login catalog sync into the OFFLINE-03 stores — see `ERP-PLANNING/phase-completions/OFFLINE-04_COMPLETION.md` | Medium |
| **OFFLINE-05** ✅ COMPLETE | POS feature breadth offline: held sales, customer search/create against local cache, on-screen printable receipt — see `ERP-PLANNING/phase-completions/OFFLINE-05_COMPLETION.md` | Medium |
| **OFFLINE-06** ✅ COMPLETE | Background Sync API wiring (real `sync` event registration, replacing the dead `DO_SYNC` scaffold) + sync status/health UI (pending count, last sync, failed items) — see `ERP-PLANNING/phase-completions/OFFLINE-06_COMPLETION.md` | Medium |
| **OFFLINE-07** ✅ COMPLETE | Conflict handling: stock-changed-since-queued surfaces a clear resolution flow instead of a stuck generic error — see `ERP-PLANNING/phase-completions/OFFLINE-07_COMPLETION.md` | Medium |
| **OFFLINE-08** ✅ COMPLETE | PWA manifest + installable app shell for `pos-frontend` — see `ERP-PLANNING/phase-completions/OFFLINE-08_COMPLETION.md` | Small |
| **OFFLINE-09** ✅ COMPLETE | Read-only counter lookup (item/price/tax + customer), rescoped with the client to `pos-frontend` (reusing its existing offline foundation) instead of `web-frontend` — see `ERP-PLANNING/phase-completions/OFFLINE-09_COMPLETION.md` | Large → Small (once rescoped) |
| **OFFLINE-10** ✅ COMPLETE | Test suite for OFFLINE-01 through 09 (the "pos-frontend currently has zero tests" premise turned out stale — 6 test files already existed; this phase filled the component-level/cross-cutting gaps) + documentation updates — see `ERP-PLANNING/phase-completions/OFFLINE-10_COMPLETION.md` | Medium |

Hardware integration beyond what's already documented in `HARDWARE_AND_MARKETING_READINESS_REPORT.md`, multi-store performance tuning, and a full admin monitoring dashboard are folded into the phases above where they overlap with POS-scoped work, and otherwise deferred until OFFLINE-01 through OFFLINE-08 are live and real usage data (store count, catalog size, actual outage patterns) exists to size them against — building for hypothetical scale ahead of real data would be over-engineering.

---

## What this pass delivered

Per the client's explicit Phase 1 instruction ("produce an implementation roadmap before making changes"), and confirmed with the client before proceeding: **this pass produced the roadmap and the ten `OFFLINE-XX` phase-prompt documents only — no code was changed.** Implementation begins with `OFFLINE-01` in a follow-up session.
