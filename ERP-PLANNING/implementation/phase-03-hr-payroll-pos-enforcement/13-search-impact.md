# 13 — Search Impact

## Out of scope, confirmed

`search-service` indexes items, customers, and other searchable entities — it does not index routes, permissions, or capability state, and this phase creates no new searchable entity. `pos.routes.ts:650`'s `GET /pos/items/search` calls into the existing item-search mechanism (confirmed unrelated to `search-service`'s own indexed search — this is sales-service's own trigram-based item lookup, per the existing `SearchItemsQuerySchema`/`decodeSearchCursor` code read in `01-current-code-evidence.md`'s file read) and is simply one more route in the gated set (`26-affected-flow-matrix.md` row 7) — gating it changes nothing about how search itself works, only whether the route that calls it is reachable.

No indexing, backfill, or permission-filter change needed anywhere in `search-service`.
