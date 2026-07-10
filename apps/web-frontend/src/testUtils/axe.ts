import axeCore, { type Result } from 'axe-core';

/**
 * Runs axe-core directly against a rendered container and returns any violations.
 * ERP-PLANNING/07_ERP_IMPLEMENTATION_PLAN.md Phase 7 — wired directly against axe-core
 * rather than a jest-axe/vitest-axe wrapper package, since the available wrapper for this
 * Vitest version ships a broken build (empty `extend-expect` output, mismatched matcher
 * types) — this is fewer moving parts and no less capable.
 */
export async function runAxe(container: Element): Promise<Result[]> {
  const results = await axeCore.run(container, {
    rules: {
      // jsdom has no real layout engine, so color-contrast checks always fail on
      // false-positive "not visible" reasoning — this is the standard jsdom+axe carve-out.
      'color-contrast': { enabled: false },
    },
  });
  return results.violations;
}

export function formatViolations(violations: Result[]): string {
  return violations
    .map((v) => `${v.id} (${v.impact}): ${v.help}\n  ${v.nodes.map((n) => n.target.join(' ')).join('\n  ')}`)
    .join('\n\n');
}
