# 11 — API Contracts / Error Contract

## 1. Reuse the existing error envelope — no new error system

Every error response in this codebase, across both the direct-reply pattern (`requirePermission`) and the thrown-error pattern (`registerErrorHandler`/`ERPError`), uses the same JSON shape: `{ error: { code, message, details? } }` (`01-current-code-evidence.md` §1–2). `CAPABILITY_NOT_ENABLED` reuses this envelope exactly — no new response shape is introduced.

## 2. DECIDED (2026-08-18, corrected by Decision 5) — three distinct outcomes, not two

**Correction to the original Decision 2 write-up**: the earlier version of this section treated "capability disabled" and "capability resolution failure" as one outcome (both 403). That was wrong — they are different operational states (a definitive "no" vs. an infrastructure failure that prevented an answer) and must be distinguishable. The corrected, final contract has three outcomes:

### 2a. CAPABILITY DISABLED

Resolution _succeeded_ and definitively determined the capability is unavailable for this tenant. → **HTTP 403**, `code: 'CAPABILITY_NOT_ENABLED'`.

### 2b. PERMISSION DENIED — unchanged, existing contract, NOT part of this phase's decisions

Capability is enabled; the separate, independent `requirePermission` guard denies the request. **This phase preserves the existing live permission-error contract exactly as-is and does not modify it.** The `01-current-code-evidence.md` §1 finding stands: `requirePermission` currently emits `{ error: { code: 'FORBIDDEN', message: ... } }` at **HTTP 403** — this phase does not rename it to `PERMISSION_DENIED`, does not introduce a new code for it, and does not touch `requirePermission`'s source at all (out of scope per `17-file-level-change-plan.md`, which touches zero existing authorization guards). A `PermissionError` class with `code: 'PERMISSION_DENIED'` exists in `packages/shared-types/src/errors.ts:33-37` but is not thrown by any live guard — noted for completeness, not acted on. _(This corrects the prior version of this document, which incorrectly presented `PERMISSION_DENIED` as a decided/target code — it is not; `FORBIDDEN` is simply preserved.)_

### 2c. CAPABILITY RESOLUTION FAILURE — new in this correction

The resolution call itself could not complete: DB/Redis/infrastructure/configuration failure. Capability state is **unknown**, not "no." The request is still denied (fail-closed is unchanged as the governing principle — `04-capability-resolution.md` §5), but reported honestly: → **HTTP 503 Service Unavailable**, `code: 'CAPABILITY_RESOLUTION_UNAVAILABLE'`. **Never** reported as `CAPABILITY_NOT_ENABLED`/403 — doing so would misrepresent an infrastructure outage as a deliberate plan restriction, which is both misleading to the caller (a 403 typically means "don't retry," while a 503 invites a retry) and to any operator reading logs/metrics trying to distinguish the two situations.

This uses the same existing `{error:{code,message,details}}` envelope for all three outcomes — no new response shape, consistent with `11-api-contracts.md` §1's "reuse the existing error envelope" principle.

## 3. Full contract

**Request:** any route with `requireCapability(key, db, redis)` in its `preHandler` chain.

**Response — capability disabled (2a):**

```
HTTP 403
{
  "error": {
    "code": "CAPABILITY_NOT_ENABLED",
    "message": "This tenant's plan does not include HR_PAYROLL.",
    "details": { "capabilityKey": "HR_PAYROLL" }
  }
}
```

**Response — resolution failure (2c):**

```
HTTP 503
{
  "error": {
    "code": "CAPABILITY_RESOLUTION_UNAVAILABLE",
    "message": "Unable to determine capability state. Please retry.",
    "details": { "capabilityKey": "HR_PAYROLL" }
  }
}
```

**Response on unauthenticated (no `request.auth`):**

```
HTTP 401
{ "error": { "code": "UNAUTHORIZED", "message": "Unauthenticated" } }
```

(Identical shape to `requirePermission`'s own 401 branch — same code string, intentionally, since it's the same underlying condition.)

**For reference — the unchanged, existing permission-denial contract (2b)**, preserved exactly as-is by this phase:

```
HTTP 403
{ "error": { "code": "FORBIDDEN", "message": "Missing permission: ..." } }
```

This phase's tests and documentation assert only on the new `CAPABILITY_NOT_ENABLED`/`CAPABILITY_RESOLUTION_UNAVAILABLE` contracts and do not assert on `requirePermission`'s existing `FORBIDDEN` string being anything other than what it already is.

## 4. User-facing meaning and frontend handling

Three distinct user-facing meanings, corresponding to the three outcomes in §2:

- `CAPABILITY_NOT_ENABLED` → "this feature isn't part of your plan" (with an upgrade prompt, if applicable) — a plan message, not an access-control message.
- `FORBIDDEN` (unchanged, existing permission-denial contract) → "you don't have permission to do this" — an access-control message.
- `CAPABILITY_RESOLUTION_UNAVAILABLE` → "something went wrong, please try again" — a transient-failure message, distinct from both of the above; the frontend should treat this as retryable (matching its 503 status), not as a permanent denial.

The frontend's existing error-handling code (wherever it currently branches on `error.code === 'FORBIDDEN'`) gains two more cases: `error.code === 'CAPABILITY_NOT_ENABLED'` and `error.code === 'CAPABILITY_RESOLUTION_UNAVAILABLE'`. Not built in this phase (no real route produces either response yet) — documented here so the contract is stable and ready for whichever future phase's frontend work needs it.

## 5. Logging

See `14-observability-and-audit.md`.

## 6. No new error system introduced

Confirms explicit compliance with governing-prompt §12's instruction: this reuses the exact existing `{error:{code,message,details}}` envelope and the exact existing direct-reply guard pattern — no parallel error-handling mechanism is created.
