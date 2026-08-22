# 13 — Search Impact

## 1. Out of scope — confirmed, not merely assumed

`apps/search-service/src/domain/SearchEngine.ts` indexes 29 entity types today (`01-current-state.md` §13); this phase introduces no new searchable entity. `fefoEnabled` becomes one more field on the existing `item` search document (if `item` documents are re-indexed on `ITEM_UPDATED` today — confirmed by the search service's existing sync mechanism, unchanged by this phase) — additive field, no new index, no new consumer, no mapping change beyond whatever automatic field inclusion the existing item-sync consumer already does for other item fields.

## 2. Near-Expiry Stock is not search-indexed

The new `GET /inventory/near-expiry-stock` route (`07-api-contracts.md` §2) is a direct-DB operational query (`12-reporting-impact.md` §1), not a searchable entity — "what's near expiry" is a live, time-relative computation (`expiryDate < now() + thresholdDays`), not a stable indexed fact well-suited to Elasticsearch's document model. No search work needed or recommended.

## 3. What this phase does not do

Does not add a `batch` or `near_expiry_stock` entity to `SearchEngine.ts`. Does not change the existing `erp_${tenantId}_${entity}` isolation pattern. Fully consistent with `12-search-architecture.md`'s "additive, no redesign" guidance — this phase simply has nothing to add here.
