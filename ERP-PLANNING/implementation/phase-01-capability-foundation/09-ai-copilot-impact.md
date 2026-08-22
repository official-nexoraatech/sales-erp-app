# 09 — AI Copilot Impact

## 1. Claim re-verified this session (not assumed)

The prior planning pass's claim — "every AI tool call is authorized through the same guarded routes as a normal user request" — was independently re-verified against live code this session, actively looking for counter-examples. None found:

- All 7 registered tools in `apps/ai-copilot-service/src/domain/ToolRegistry.ts` (`list_invoices`, `get_invoice`, `list_customers`, `get_customer`, `list_purchase_orders`, `list_reports`, `run_report`) call exclusively through `gatewayGet`/`gatewayPost` (lines 32-56), which always attach `Authorization: Bearer ${ctx.userJwt}` and always target `GATEWAY_URL` — zero exceptions, zero fallback path (`default: return { error: 'Unknown tool' }`).
- `ctx.userJwt` is the **literal, unmodified JWT string** forwarded from the original inbound request's `Authorization` header (`copilot.routes.ts:60-61`) — never re-signed or re-issued by the copilot service.
- The copilot's own inbound endpoint is gated (`copilot.routes.ts:26-32,34-42,45-74`, `requirePermission(PERMISSIONS.COPILOT_VIEW/USE)`).
- The copilot service's own DB access (`@erp/db`, `ConversationService.ts`) is confined to its own `copilotConversations`/`copilotMessages` tables — zero domain-table queries.
- No `x-internal-key` or other service-account bypass exists anywhere in `ai-copilot-service` (grepped, zero matches) — contrasted with a real example of that pattern elsewhere (`event-service`'s `gstComplianceProxy.ts`), confirming the codebase does have that pattern available and the copilot service deliberately doesn't use it.
- `api-gateway`'s `@fastify/http-proxy` forwards the `Authorization` header unmodified — the upstream service (e.g. `sales-service`) cannot distinguish a copilot-proxied call from the user's own browser call.

## 2. Consequence for Phase 1

**Zero code change required in `ai-copilot-service` for this phase, and zero for any future phase that wires `requireCapability` onto real routes.** Once a route like `POST /payroll/runs` gains `requireCapability('HR_PAYROLL', ...)` (a future phase, not this one), any AI tool that calls that route inherits the capability check automatically and for free — because the copilot's HTTP call is indistinguishable, at the receiving service, from the user's own request. This is the same reason permission checks are already inherited today without any AI-specific authorization code.

## 3. What this phase does verify, not build

This file documents the verification. No new test, no new code, no new tool is added to `ai-copilot-service` in this phase — there's nothing to change, and adding speculative "capability-aware AI tooling" now would be exactly the premature generalization the governing brief warns against, especially since none of the 7 existing tools currently call any route this phase's 2 registered capabilities (`HR_PAYROLL`, `POS`) would even gate (they call invoice/customer/purchase-order/report endpoints, not payroll or POS-checkout endpoints).

## 4. Flag for a future phase, not a gap in this one

When a future phase does wire `requireCapability` onto a route that an existing or future AI tool calls, the tool's error handling (`gatewayGet`/`gatewayPost`'s `if (!res.ok) return { error: ... }`) already generically surfaces any non-2xx response — including a future `403 CAPABILITY_NOT_ENABLED` — back to the LLM as a tool-result error string. Whether that error message is clear enough for the LLM to explain to the end user ("this feature isn't part of your plan" vs. a raw `Request failed with status 403`) is a UX-quality question for whichever future phase first gates a copilot-reachable route — not evaluated further here since no such route exists yet.
