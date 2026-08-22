# 19 — Rollout & Rollback

## 1. Sequencing (why this order)

```
1. Migration (flag seed + permission backfill)   — inert until step 2/3 ship; safe to run alone
2. Backend: item.routes.ts field + capability check, ValuationService ordering change
   — deploy, verify via automated tests + a manual GRN→sale trace on a test tenant, BEFORE step 3
3. Backend: GET /inventory/near-expiry-stock route
   — depends on step 2's data existing to be meaningful, but is independently safe to ship first
     or same-day; no hard ordering requirement between 2 and 3, listed sequentially for clarity
4. Frontend: item form toggle, nav item, Near-Expiry Stock page
   — depends on steps 2+3's routes existing; shipping frontend before backend would 404, so this
     is the one hard ordering constraint
5. Manual in-browser verification (16-testing-strategy.md §5)
```

## 2. Why this is lower-risk than Phase 1's own rollout

Phase 1 shipped a mechanism with zero live enforcement (nothing to break). This phase **does** activate real enforcement on real, already-live routes (`POST/PUT /items`) — the risk profile is closer to `16-phase-roadmap.md` Phase 4's ("wire onto real routes") than Phase 1's inert-by-design scope. Mitigated by: the capability check only activates for the _new_ `fefoEnabled` field specifically (§17's "the one real change" analysis) — the routes' existing behavior for every other field is untouched, and the new field is additive/optional, so there is no code path where a pre-existing, already-passing request starts failing after this phase ships.

## 3. Rollback per step

| Step                         | Rollback                                                                                                                                                                                                                                                                      |
| ---------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Migration                    | Revert flag row + permission grants (dev-phase: delete migration file; prod-future: `DELETE`/`UPDATE` as noted in `17-migration-and-backward-compatibility.md` §3)                                                                                                            |
| `item.routes.ts` change      | Revert the diff — `fefoEnabled` becomes unreachable again, exactly Phase 0 state                                                                                                                                                                                              |
| `ValuationService.ts` change | Revert the diff — pure FIFO-by-`receivedAt` again for all items (safe even if some items already have `fefoEnabled: true` at rollback time — they'd just stop getting FEFO preference, no data corruption, since `remainingQty` bookkeeping is unaffected by ordering choice) |
| New route                    | Delete the route registration — 404s again, frontend gracefully degrades if deployed in the wrong order (existing empty-state handling, not a crash)                                                                                                                          |
| Frontend                     | Revert — nav item/form section disappear, no backend dependency to clean up                                                                                                                                                                                                   |

## 4. Shadow/dry-run consideration

Unlike Phase 1's genuinely inert rollout, this phase's changes are live from the moment they deploy (the field becomes settable immediately). A dry-run isn't meaningful here the way it was for Phase 1 (there's no "prove it resolves correctly with nothing depending on the answer" phase available, since the very first real use is also the production use) — mitigated instead by shipping to a single test/staging tenant first (existing repo convention, not new process) before wider rollout, and by the fact that the default state (`fefoEnabled: false`) is unchanged from today for every tenant until an admin acts.

## 5. Feature-complete gate before wider announcement

Per `19-first-industry-recommendation.md`'s reuse thesis and this phase's own `10-entitlement-impact.md` §2, this capability is safe to leave "quietly available" (BETA status in the registry, `03-capability-definition.md`) rather than announced/marketed until a real Distribution/Manufacturing business type exists to consume it — Grocery tenants can start using it immediately as a genuine quality-of-life improvement without waiting for that.
