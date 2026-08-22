# 07 — API Contracts

## 1. `POST /items` / `PUT /items/:id` (`inventory-service`) — additive, conditional field

**Request body** gains optional `fefoEnabled: boolean`.

**Behavior**:

| Request state         | Capability state           | Outcome                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| --------------------- | -------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `fefoEnabled` omitted | any                        | Unchanged — defaults to existing column default (`false`), byte-identical to today                                                                                                                                                                                                                                                                                                                                                                                |
| `fefoEnabled: false`  | any                        | Accepted, no capability check needed (disabling never needs to be gated)                                                                                                                                                                                                                                                                                                                                                                                          |
| `fefoEnabled: true`   | `INVENTORY_BATCH` enabled  | Accepted                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| `fefoEnabled: true`   | `INVENTORY_BATCH` disabled | `422 VALIDATION_ERROR` — `{ error: { code: 'CAPABILITY_NOT_ENABLED', message: "This tenant's plan does not include INVENTORY_BATCH.", details: { capabilityKey: 'INVENTORY_BATCH', field: 'fefoEnabled' } } }` — reuses the exact `CAPABILITY_NOT_ENABLED` code Phase 1 already established for route-level denials (`21-post-implementation-review.md` §11), applied here to a field-level denial instead — same contract, finer grain, not a new error taxonomy |

**Response body**: unchanged shape, `fefoEnabled` included in the returned item like any other field (existing `ItemSchema`-derived response already round-trips all columns).

## 2. `GET /inventory/near-expiry-stock` (`inventory-service`) — new route

```
GET /inventory/near-expiry-stock?warehouseId=&thresholdDays=30
Auth: Bearer JWT (existing pattern)
preHandler: authenticate → requireCapability('INVENTORY_BATCH') → requirePermission(BATCH_VIEW)

200 → { data: { content: [{ itemId, itemName, warehouseId, batchNumber, expiryDate, remainingQty, unitCost }], totalElements } }
403 → { error: { code: 'CAPABILITY_NOT_ENABLED', ... } }               [capability off]
403 → { error: { code: 'FORBIDDEN', ... } }                            [capability on, permission missing — existing, unchanged contract]
503 → { error: { code: 'CAPABILITY_RESOLUTION_UNAVAILABLE', ... } }    [infra failure — existing Phase 1 contract]
401 → unauthenticated                                                  [existing, unchanged]
```

Query shape mirrors `nearExpiryAlert.job.ts`'s already-proven-correct query (`01-current-code-evidence.md` §5) — this route is a read-only, user-facing exposure of the same underlying data the alert job already computes, not new query logic.

## 3. `GET /users/me` (`auth-service`) — no change needed

Already computes `enabledCapabilities: string[]` generically by iterating `CAPABILITY_REGISTRY` (Phase 1, `apps/auth-service/src/routes/users.ts`). Adding `INVENTORY_BATCH` to the registry means it appears in this response automatically for any tenant with the flag resolved `true` — zero code change to this route, confirmed by reading Phase 1's implementation (`20-implementation-report.md` §10: the loop is registry-driven, not hardcoded to 2 keys).

## 4. What does NOT change

- No existing route's request/response shape changes.
- No existing error code is renamed or repurposed.
- `GRN` routes (`purchase-service`) — zero contract change, confirmed by `05-service-impact.md` §2.
- `PATCH .../stock-transfers`, `POST /invoices`, POS checkout — zero contract change; `consumeFifoLayers`'s ordering change is entirely internal to `ValuationService`, invisible at any API boundary (same total quantity consumed, same COGS calculation, only _which_ layer rows are decremented first changes for `fefoEnabled` items).
