# OFFLINE-06 — Background Sync API & Sync Status UI
## STATUS: 🔲 NOT STARTED
## Sprint: Offline-6 | Effort: Medium (2–4 days) | Risk: Low–Medium (progressive enhancement over existing manual sync)
## Depends on: OFFLINE-02 (idempotent sync must exist before making sync trigger more aggressively/automatically)
## Unlocks: OFFLINE-07 (conflict UI needs a place to surface conflicts — this phase builds that surface)
## Source: `ERP-PLANNING/reports/OFFLINE_READINESS_REPORT.md` §5 (sync triggers), the dead `SYNC_PENDING`/`DO_SYNC` scaffold in `sw.ts`

---

## YOUR ROLE

You are the **Frontend Platform Engineer** replacing today's fragile sync trigger
(`window.online` listener + manual "Sync now" button, both requiring the tab to be open)
with the Background Sync API the service worker already half-implements, and giving the
cashier/store manager actual visibility into sync health.

---

## PRE-FLIGHT CHECKLIST

- [ ] Read `apps/pos-frontend/src/sw.ts` in full, especially the `SYNC_PENDING`/`DO_SYNC` message-passing scaffold (confirmed dead/unreachable in the audit — verify this is still the case) and the existing `install`/`fetch` handlers you must not break
- [ ] Read `apps/pos-frontend/src/POSScreen.tsx`'s current `syncPending()`, `handleOnline()`, and "Sync now" button code
- [ ] Research the Background Sync API's actual browser support (it's Chromium-only; Safari/iOS has no support) — this affects whether it can be the *only* sync trigger or must remain a progressive enhancement over the existing manual/online-event triggers
- [ ] Confirm the OFFLINE-02 idempotency mechanism is in place before this phase increases how often/aggressively sync fires — background sync retries are exactly the kind of traffic that would have caused duplicate invoices before that fix
- [ ] Check what pending-count/sync-status UI currently exists in `POSScreen.tsx` (the badge mentioned in the audit) as the starting point for this phase's status UI expansion

---

## PROJECT CONTEXT

### Why Background Sync, and why it can only be an enhancement, not a replacement

Today, sync only runs while `POSScreen.tsx` is mounted, the browser tab is open, and
either an `online` event fires or someone clicks "Sync now." If the tab is closed or the
device sleeps through the moment connectivity returns, queued sales sit unsynced
indefinitely until someone reopens the app. The Background Sync API
(`ServiceWorkerRegistration.sync.register(tag)` + the SW's `sync` event handler) lets the
service worker attempt a sync even without an open tab — but it's Chromium/Android-only
(no Safari/iOS support as of this codebase's target browsers, verify current support
before finalizing). Design this as a **progressive enhancement**: register for
background sync where supported, but keep the existing tab-open triggers as the
fallback everywhere else, so behavior degrades gracefully rather than silently doing
nothing on unsupported browsers.

### Sync status UI

Today's UI has only a pending-count badge. Extend it to show: pending count, last
successful sync timestamp, and a distinct indicator for stuck items (from OFFLINE-02's
max-retry state) — enough for a cashier or store manager to know "sync is healthy" vs.
"something needs attention," without building a full admin monitoring dashboard (that's
explicitly deferred per the roadmap, to be sized against real usage data later).

### Coding Standards
- TypeScript strict — no `any`
- Feature-detect Background Sync support (`'sync' in ServiceWorkerRegistration.prototype` or equivalent) before relying on it — don't assume support
- Don't remove the existing manual "Sync now" button or `window.online` listener — they remain the fallback path

---

## OBJECTIVE

1. Where the Background Sync API is supported, a real `sync` event is registered and handled in `sw.ts`, replacing the dead `SYNC_PENDING`/`DO_SYNC` scaffold with working logic
2. Where unsupported, existing tab-open sync triggers continue to work unchanged
3. The POS UI shows pending count, last-sync time, and a distinct stuck-item indicator

---

## SCOPE

### Step 1 — Real Background Sync registration

In `POSScreen.tsx` (or wherever queueing happens), after successfully queueing a sale
offline, call `registration.sync.register('sync-pending-sales')` (feature-detected).

### Step 2 — Service worker sync handler

In `sw.ts`, replace the dead message-passing scaffold with a real `self.addEventListener('sync', (event) => { if (event.tag === 'sync-pending-sales') event.waitUntil(syncPendingSales()); })`. Since the sync logic (`syncPending`/`syncPendingSales`) currently lives in `POSScreen.tsx` as page-context code, decide whether to duplicate a SW-safe version (no DOM access, must use `postMessage` to update UI state, or perform the sync purely against IndexedDB + fetch without touching page state) or refactor the sync logic into a shared module callable from both contexts — prefer the shared-module approach if the existing code doesn't have deep page-context dependencies, to avoid maintaining two copies of idempotency-sensitive sync logic.

### Step 3 — Sync status UI

Extend the existing pending-count badge into a small status panel: pending count,
last-successful-sync timestamp (persist this in `syncMeta` or a dedicated field,
whichever OFFLINE-03/04 already established), and a stuck-item count/link (from
OFFLINE-02's max-retry state) with enough detail for a manual "retry stuck items" action.

### OUT OF SCOPE
- A full admin/multi-terminal monitoring dashboard — deferred per roadmap
- Building Background Sync support for browsers that don't have it (iOS Safari) — the fallback path is sufficient, don't attempt a polyfill unless specifically requested
- Conflict-resolution UI — that's OFFLINE-07

---

## TESTING REQUIREMENTS

1. On a Background-Sync-capable browser, queueing a sale while offline and closing the tab, then restoring connectivity, results in the sale syncing without reopening the tab (test via browser devtools' background-sync simulation, not just relying on manual QA)
2. On a non-capable browser (or with the feature-detected off), existing tab-open sync behavior is unchanged
3. Sync status UI correctly reflects pending count, last-sync time, and stuck-item count in various states (0 pending, N pending, some stuck)
4. No duplicate sync logic paths cause double-processing of the same queued sale (cross-check against OFFLINE-02's idempotency, which should make this safe regardless, but verify)

---

## BUILD VERIFICATION

```bash
pnpm --filter @erp/pos-frontend build
pnpm --filter @erp/pos-frontend type-check
pnpm lint
```

---

## VERIFICATION CHECKLIST

- [ ] Background Sync is registered and handled where supported, with a working fallback elsewhere
- [ ] Sync status UI shows pending count, last sync time, and stuck items
- [ ] No dead/unreachable sync-trigger code remains (the old scaffold is either used for real or removed, not left half-wired)

---

## REGRESSION CHECKLIST

- [ ] Manual "Sync now" button still works
- [ ] `window.online`-triggered sync still works
- [ ] OFFLINE-01/02/03/04/05 behavior is unaffected

---

## DEFINITION OF DONE

- [ ] Background Sync works where supported, with graceful fallback elsewhere
- [ ] Sync status UI is live and accurate
- [ ] All tests pass; regression suite green
- [ ] `pnpm lint` and `pnpm type-check` pass
- [ ] Completion report saved at `ERP-PLANNING/phase-completions/OFFLINE-06_COMPLETION.md`
- [ ] `ERP-PLANNING/reports/OFFLINE_FIRST_ROADMAP.md` updated to mark OFFLINE-06 complete

---

## COMPLETION REPORT TEMPLATE

**Save as:** `ERP-PLANNING/phase-completions/OFFLINE-06_COMPLETION.md`

```markdown
# OFFLINE-06 Completion Report — Background Sync & Status UI
**Date:** [YYYY-MM-DD]
**Status:** COMPLETE / PARTIAL

## What Changed
- Background Sync registration + SW handler: [summary]
- Sync status UI: [summary]

## Browser Support Verified
| Browser | Background Sync | Fallback tested |
|---|---|---|

## Files Changed
[Table]

## Tests: [N]/[N] PASS | lint: PASS | type-check: PASS | build: PASS

## Known Issues / Deferred
- Full admin monitoring dashboard deferred per roadmap
```
