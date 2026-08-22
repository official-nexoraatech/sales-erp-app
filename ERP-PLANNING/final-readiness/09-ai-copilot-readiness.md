# 09 — AI Copilot Readiness Audit

## Tenant isolation — VERIFIED SOUND

`tenant_id` is JWT-derived end-to-end; the LLM's tool-call arguments cannot influence tenant scoping. `apps/ai-copilot-service/src/middleware/authenticate.ts:20,35` decodes the RS256 JWT server-side before any handler runs. `apps/ai-copilot-service/src/api/copilot.routes.ts:82-88` passes `tenantId: req.auth.tenantId` (from the JWT) into the orchestrator — the LLM/user never supplies a tenantId anywhere in the call. `apps/ai-copilot-service/src/domain/ClaudeOrchestrator.ts:76` threads the **raw user JWT itself** (not a re-derived/re-signed token) into tool execution. Every tool in `ToolRegistry.ts:32-56` proxies through the API Gateway using `Authorization: Bearer ${ctx.userJwt}` — the requesting user's own JWT, not a service-level credential.

Critically: **none of the 7 tool input schemas expose a tenantId/tenant-scoping parameter to the LLM at all.** A prompt-injected or hallucinated tool call has no argument path to smuggle in an alternate tenant. One deliberate, documented defensive measure was found: `run_report`'s LLM-controlled `slug` parameter is regex-validated (`/^[a-z0-9-]+$/`) before URL-path interpolation, explicitly to block path-traversal from untrusted LLM tool input — the code comment shows real awareness that "Claude's tool input is effectively untrusted."

**Residual gap (LOW, documented tradeoff)**: the orchestrator's conversation-history DB calls run on the plain, unscoped pool connection rather than GUC/RLS-scoped, deliberately, to avoid holding a Postgres transaction open across a multi-second external Anthropic API call. Correctness there relies on explicit `WHERE tenantId = ...` filtering rather than RLS — not independently re-verified for airtightness in this pass.

## Permission/capability enforcement — RBAC correctly inherited; no capability-registry integration

The copilot service itself performs only 2 permission checks (`COPILOT_VIEW`, `COPILOT_USE`) — there is no per-tool permission check inside `ToolRegistry.ts`/`ClaudeOrchestrator.ts`. This is architecturally sound **if** every downstream endpoint independently enforces its own RBAC/capability checks correctly — which is true for the endpoints this audit otherwise verified (invoices, customers, purchase orders, reports), but was not re-verified per-endpoint specifically from the copilot's calling pattern.

**No capability-registry integration exists at all.** `CAPABILITY_REGISTRY` has no `COPILOT` entry, and the tool list is **not filtered by which capabilities/verticals a tenant has enabled** — a tenant without inventory/purchase capabilities still has those tools offered to the LLM, discovering the restriction only via a downstream 403 in the tool result. Real but minor (the copilot can't proactively say "you don't have that feature"; it burns a model turn to find out). Every tool call **is** audit-logged (`ClaudeOrchestrator.ts:128-133`, tenant-scoped `PlatformAuditLogger` entry) — good practice, partially answering the observability question below for copilot specifically.

## Extensibility for a future Hotel vertical

**Verdict: no second AI architecture needed, but not a true registry despite the file's name.** `ToolRegistry.ts` is a flat hardcoded array of 7 tool definitions plus a single `switch` statement in `executeTool()` — no `registerTool()` API, no per-service tool manifest, no discovery from `CAPABILITY_REGISTRY`. Adding a Hotel-specific tool (e.g. `list_room_bookings`) means appending an array entry, adding a switch case, and possibly updating the system prompt — mechanically simple, same `Anthropic.messages.create` tool-use loop, but every tool always lives inside `ai-copilot-service` itself; there is no mechanism for `production-service` or a future `hotel-service` to register its own tools without a code change inside the copilot service. Rated **MEDIUM** (functionally extensible, architecturally centralized rather than truly pluggable).

## Observability answers to the audit's two example questions

**"Why does Tenant X have access to Capability Y?" — NOT reliably answerable.** Current state is inspectable (read the `featureFlags` row), but the mutation paths are unaudited: `PUT /admin/feature-flags/:name` (`apps/auth-service/src/routes/feature-flags.routes.ts:44-79`) never writes to `auditLog`; `BillingService.assignPlanEntitlements` — the codebase's own-labeled "sole writer of entitlement-derived feature_flags rows" — also never writes to `auditLog`. This is a real gap, not a missing nice-to-have: the same file has a working audit pattern for tenant suspend/activate/close (`suspendForNonPayment` does write a full `auditLog` entry) that was simply never extended to capability/entitlement grants. Rated **HIGH**.

**"Why did User Z get denied?" — split answer.** Capability denials are well-logged and metered (`capability-guard.ts:51-62`, `erp_capability_check_denied_total`, with resolution errors distinctly labeled from definitive denials). **Plain RBAC permission denials are never logged anywhere** — confirmed identical across all 15 services' `authorize.ts`: on a 403, the handler replies and returns with no `request.log.warn(...)` call and no counter, so an operator has no server-side trail to query for an ordinary RBAC denial, only whatever the client happened to log. Rated **HIGH** — the same class of gap capability logging already solved, not yet applied to the far more common RBAC-denial path.

## AI Copilot-specific metrics — MEDIUM gap

`packages/logger/src/erp-metrics.ts` has zero copilot-specific metrics (no tool-call counter, no latency histogram, no per-tenant usage/cost signal) — grepped, no matches for "opilot" anywhere in the file. The only observability signal is a structured log line and the per-tool audit-log rows described above — functionally fine, but invisible to the Prometheus/Grafana stack that every other feature in this file feeds.

## Ranked findings

| #   | Finding                                                                                               | Severity                   |
| --- | ----------------------------------------------------------------------------------------------------- | -------------------------- |
| 1   | Feature-flag/capability grant mutations never audit-logged                                            | HIGH                       |
| 2   | Plan-based entitlement assignment never audit-logged                                                  | HIGH                       |
| 3   | RBAC permission denials never logged server-side, no metric, identical gap across all 15 services     | HIGH                       |
| 4   | AI Copilot tool registry is hardcoded, not a real registry; no capability-registry filtering of tools | MEDIUM                     |
| 5   | AI Copilot has zero Prometheus metrics                                                                | MEDIUM                     |
| 6   | Conversation DB calls on unscoped pool connection (documented tradeoff)                               | LOW / NOT FURTHER VERIFIED |

## Confirmed correct, no gap

Tenant isolation for all tool execution (JWT-derived, no LLM-controllable tenant argument path) · RBAC inheritance via user's-own-JWT gateway proxying · `run_report` slug injection defense · per-tool-call audit logging · capability-check denial logging/metrics.
