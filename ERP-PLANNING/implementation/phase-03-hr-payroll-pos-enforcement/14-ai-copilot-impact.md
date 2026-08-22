# 14 — AI Copilot Impact

## Inherited-for-free, same conclusion as Phase 1 and Phase 2B

`ai-copilot-service` proxies every tool call through the gateway using the caller's own JWT (`ToolRegistry.ts`, per `13-security-architecture.md` §4 and re-confirmed unchanged by Phase 1's/`39-implementation-report.md`'s own AI-impact sections). Any copilot tool that calls a now-gated route (a payroll or POS route) reaches the identical `authenticate → requireCapability → requirePermission` chain a browser request does — no bypass, no special-case needed, no code change in `ai-copilot-service`.

## One open check, not resolved by this planning pass

Whether `ai-copilot-service` currently registers any tool against `payroll.routes.ts` or `pos.routes.ts`/`day-end.routes.ts`/`promotion.routes.ts`'s endpoints is `TO VERIFY` at implementation time (this session did not grep `ai-copilot-service`'s tool registrations against these specific routes — Phase 2B's own equivalent check, `39-implementation-report.md` §9, did this for its own new route and found zero registrations; the equivalent check for this phase's 18 routes was not performed in this session and must not be assumed to have the same answer without checking). If a tool does exist and a user's tenant has the capability disabled, that tool call correctly fails with the same `403`/`503` a browser call would get — no new hallucination risk (the tool receives a structured error, not a silent no-op), but the copilot's response-generation layer should surface that error meaningfully to the user rather than presenting it as a generic failure. **Not built or verified in this planning pass** — flagged for implementation-time verification.

## No new AI-exposed capability

This phase exposes no new data or action to AI — it only changes whether an _existing_, already-AI-reachable-if-registered route succeeds or fails based on tenant capability state.
