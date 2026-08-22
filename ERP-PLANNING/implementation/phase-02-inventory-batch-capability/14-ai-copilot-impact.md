# 14 — AI Copilot Impact

## 1. Inherited-for-free, per the already-confirmed pattern

`ai-copilot-service`'s `ToolRegistry.ts` proxies every tool call through the gateway using the calling user's own JWT (`01-current-state.md` §6, re-confirmed by Phase 1's `21-post-implementation-review.md` §8 and `13-security-architecture.md` §4). If a copilot tool ever calls `GET /inventory/near-expiry-stock` (`07-api-contracts.md` §2) or reads/writes `fefoEnabled` via the item tools, it hits the exact same `requireCapability`/`isCapabilityEnabled` + `requirePermission` chain any browser request would — no AI-specific authorization logic needed, matching `21-capability-resolution-architecture.md` §5's worked example for `LOYALTY` verbatim.

## 2. One open verification item, not resolved by this planning pass

Phase 1's own `21-post-implementation-review.md` §8 flagged its AI Copilot conclusion as "verification-by-absence" (no route was gated, so there was nothing to verify against). This phase **does** gate a real route for the first time — `GET /inventory/near-expiry-stock` — so it is the first opportunity to positively re-verify (not just re-assert) that the copilot's tool-calling path correctly surfaces a `CAPABILITY_NOT_ENABLED` response to the end user (e.g., the copilot should say "batch tracking isn't enabled for your account" rather than a raw error or a silent failure) if `ToolRegistry.ts` has any tool that would call this route. **Recommended for the implementation session's testing pass** (`16-testing-strategy.md` §5), not resolved here since it depends on whether a copilot tool for this route is even registered (may not exist yet — copilot tools are added deliberately, not automatically, per the existing `ToolRegistry` pattern).

## 3. What this phase does not do

Does not add a new AI-specific authorization layer. Does not register a new copilot tool as part of this phase's required scope (optional, separately decidable).
