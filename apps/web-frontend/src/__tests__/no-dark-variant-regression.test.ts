import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

// 2026-07-15 — High Contrast mode (`.hc` on <html>) and Dark mode (`.dark`) are mutually
// exclusive, and Tailwind's `dark:` variant is scoped to `.dark` only (index.css:
// `@custom-variant dark (&:where(.dark, .dark *));`). Any component using a raw
// `text-gray-900 dark:text-white`-style class instead of the semantic token utilities
// (text-primary, bg-surface-card, border-default, etc.) silently renders in its light-mode
// colors under HC mode — 30+ files across the GST and Accounting modules had this bug.
// This guard scans every source file for the literal Tailwind `dark:` variant prefix so the
// bug class can't silently return; use the token utilities in index.css instead, which
// resolve correctly under `.light`/`.dark`/`.hc` via CSS custom properties.
describe('no raw Tailwind dark: variant usage (breaks High Contrast mode)', () => {
  const srcDir = path.resolve(fileURLToPath(import.meta.url), '../../..');

  function collectSourceFiles(dir: string, out: string[] = []): string[] {
    for (const entry of readdirSync(dir)) {
      if (entry === '__tests__' || entry === 'node_modules') continue;
      const full = path.join(dir, entry);
      const stat = statSync(full);
      if (stat.isDirectory()) {
        collectSourceFiles(full, out);
      } else if (
        /\.(tsx|ts)$/.test(entry) &&
        !entry.endsWith('.test.tsx') &&
        !entry.endsWith('.test.ts')
      ) {
        out.push(full);
      }
    }
    return out;
  }

  it('contains zero `dark:` Tailwind variant usages in application source', () => {
    const files = collectSourceFiles(srcDir);
    const offenders: string[] = [];
    for (const file of files) {
      const content = readFileSync(file, 'utf-8');
      if (/\bdark:/.test(content)) {
        offenders.push(path.relative(srcDir, file));
      }
    }
    expect(
      offenders,
      `Files using dark: instead of semantic tokens:\n${offenders.join('\n')}`
    ).toEqual([]);
  });
});
