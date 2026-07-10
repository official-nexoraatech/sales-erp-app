#!/usr/bin/env node
// Fails if anything imports the removed event-bus-client package or the removed
// OutboxPublisher export from @erp/sdk (see PG-003 gap-prompt: both were dead code).
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const ROOTS = ['apps', 'packages'];
const SKIP_DIRS = new Set(['node_modules', 'dist', '.turbo', 'coverage']);
const FILE_EXT = /\.(ts|tsx|js|jsx|mjs|cjs)$/;

const FORBIDDEN = [
  { pattern: /from\s+['"]@erp\/events['"]/, message: "import from removed 'event-bus-client' package (@erp/events)" },
  {
    pattern: /import\s*(?:type\s*)?\{[^}]*\bOutboxPublisher\b[^}]*\}\s*from\s*['"]@erp\/sdk['"]/,
    message: "import of removed 'OutboxPublisher' export from @erp/sdk",
  },
];

function* walk(dir) {
  for (const entry of readdirSync(dir)) {
    if (SKIP_DIRS.has(entry)) continue;
    const full = join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) yield* walk(full);
    else if (FILE_EXT.test(entry)) yield full;
  }
}

let violations = [];

for (const root of ROOTS) {
  try {
    for (const file of walk(root)) {
      const content = readFileSync(file, 'utf8');
      for (const { pattern, message } of FORBIDDEN) {
        if (pattern.test(content)) {
          violations.push(`${file}: ${message}`);
        }
      }
    }
  } catch {
    // root doesn't exist, skip
  }
}

if (violations.length > 0) {
  console.error('Forbidden import/reference check failed:');
  for (const v of violations) console.error(`  - ${v}`);
  process.exit(1);
}

console.log('check-forbidden-imports: OK');
