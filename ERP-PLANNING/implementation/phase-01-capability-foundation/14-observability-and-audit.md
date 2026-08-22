# 14 — Observability and Audit

## 1. Logging

Two distinct log lines, at two distinct severities, matching the two distinct response codes (Decision 5 — corrects the earlier version of this section, which had both cases collapsed into the same `403` response and a single `warn` level):

1. **Capability disabled** (resolution _succeeded_, cleanly resolves `false`) — `warn`-level, expected/routine, matches the zero-log-on-success precedent (no existing guard logs successful checks):

```ts
logger.warn(
  { tenantId: auth.tenantId, capabilityKey, requestId: request.id },
  'Capability check denied'
);
```

2. **Capability resolution failure** (`04-capability-resolution.md` §5 case 3 — the `catch` block in `05-platform-sdk.md` §2's code) — `error`-level, not `warn`, because this represents actual infrastructure trouble (DB/Redis unavailable, or an unexpected exception), not a routine denial:

```ts
request.log.error(
  { err, tenantId: auth.tenantId, capabilityKey },
  'Capability resolution failed — denying (fail-closed), reporting as unavailable, not disabled'
);
```

**These two cases now produce different HTTP responses to the caller too** (`403 CAPABILITY_NOT_ENABLED` vs. `503 CAPABILITY_RESOLUTION_UNAVAILABLE`, `11-api-contracts.md` §2) — the log-level distinction exists to make the same split legible to an operator scanning logs/alerts, on top of (not instead of) the client-visible distinction. A spike specifically in case 2's `error`-level line is what should page someone about capability-system health; a steady baseline of case 1's `warn`-level line is expected, routine tenant/plan behavior and should not alert.

No sensitive data logged in either case — `tenantId` and `capabilityKey` are not secrets; no user PII, no token contents, no flag `config` jsonb payload (which could theoretically contain tenant-specific configuration not meant for logs). The caught `err` object in case 2 must not include request bodies or auth headers — only the error's own message/stack, matching how `@erp/logger` is used elsewhere in this codebase.

## 2. Metrics

One new Prometheus counter, following the existing idempotent-registration pattern (`getOrCreateCounter` from `packages/logger/src/erp-metrics.ts` — per project convention, never `new Counter(...)` directly, which throws "already registered" under repeated Vitest imports). **Labelled by outcome, not just capability key** (corrected per Decision 5 — a single undifferentiated counter would blend "expected plan-based denials" with "infrastructure is failing," defeating the point of distinguishing them):

```ts
const capabilityCheckDeniedCounter = getOrCreateCounter({
  name: 'erp_capability_check_denied_total',
  help: 'Count of requests denied by requireCapability, labelled by capability key and outcome',
  labelNames: ['capability_key', 'outcome'], // outcome: 'disabled' | 'resolution_error'
});
```

Incremented with `outcome: 'disabled'` alongside the `warn`-level log (§1 case 1), and `outcome: 'resolution_error'` alongside the `error`-level log (§1 case 2). This lets an operator alert specifically on `outcome="resolution_error"` (infrastructure health) without that alert being drowned out or falsely triggered by routine `outcome="disabled"` volume, and without needing a second, separate counter. No counter for successful checks in this phase — would add overhead to every request for a metric with unclear immediate value; can be added later if a real operational need arises (e.g. capability adoption tracking), not built speculatively now.

## 3. Audit events

**None.** Matches the confirmed existing precedent: `requirePermission`'s denial path does not write to `audit_log` or `security_audit_log` (`01-current-code-evidence.md` §1 — verified, not assumed). Introducing audit-on-denial for capability checks specifically, while permission checks remain unaudited, would be an inconsistent, arbitrary distinction. If a future decision is made to start auditing authorization denials generally (a legitimate security hardening idea), it should apply uniformly to both `requirePermission` and `requireCapability` at that time — not introduced piecemeal by this phase.

## 4. Error tracking

Nothing beyond what already exists — `requireCapability` never throws (matches `requirePermission`'s pattern, `01-current-code-evidence.md` §1), so it never reaches any Sentry-equivalent/uncaught-exception tracking. This is intentional: a capability check failing is expected, routine authorization behavior, not an application error.

## 5. Capability evaluation telemetry

Answered by §2's counter, labelled by `capability_key` — an operator can already answer "how often is `HR_PAYROLL` being denied, across which tenants" from Prometheus without source-code debugging, satisfying the governing prompt's stated goal.

## 6. Permission denial telemetry

Out of scope for this phase — `requirePermission` has no equivalent metric today, and adding one is a separate, independently-justifiable change not bundled into this phase (bundling it would violate the "surgical changes" / "only touch what you must" principle — this phase's job is the capability mechanism, not retrofitting observability onto an unrelated, already-working guard).

## 7. Answering "why was this request denied?" without source-code debugging

Given the log lines (§1) + labelled metric (§2) + the response body itself, an operator or the requesting client both have everything needed, for either outcome:

- `{error:{code:'CAPABILITY_NOT_ENABLED', details:{capabilityKey}}}` (403) — "this tenant's plan doesn't include this."
- `{error:{code:'CAPABILITY_RESOLUTION_UNAVAILABLE', details:{capabilityKey}}}` (503) — "the system couldn't determine this, and denied out of caution — likely transient, retry or check infrastructure health."

Neither requires reading `capability-guard.ts`'s source, and — critically per Decision 5 — neither can be mistaken for the other from the response alone.
