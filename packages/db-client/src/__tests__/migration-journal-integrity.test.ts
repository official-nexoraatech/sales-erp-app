import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = join(__dirname, '../../migrations');
const JOURNAL_PATH = join(MIGRATIONS_DIR, 'meta/_journal.json');

interface JournalEntry {
  idx: number;
  when: number;
  tag: string;
}

/**
 * Known pre-existing exception: idx 87 (0087_hr_employee_user_link_self_service) has a
 * `when` timestamp larger than every entry from idx 88 through the end of the journal.
 * This exact shape (an out-of-order timestamp) has already caused a real, confirmed
 * outage on a separate dev database — drizzle-orm's migrate() only compares a migration's
 * folderMillis against the single most-recently-applied row's created_at, so once idx 87
 * is the last-applied migration on some database, nothing after it can ever satisfy the
 * check again. Rewriting historical journal timestamps is a separate, higher-risk decision
 * (a shared journal, could affect already-migrated databases) and is deliberately not done
 * here. Do not add further entries to this set — any NEW out-of-order timestamp is a real
 * bug this test should catch and fail on.
 */
const KNOWN_PREEXISTING_TIMESTAMP_EXCEPTIONS = new Set([87]);

describe('migration journal integrity', () => {
  const journalRaw = readFileSync(JOURNAL_PATH);
  const journal = JSON.parse(journalRaw.toString('utf-8')) as { entries: JournalEntry[] };
  const migrationFiles = readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith('.sql'));

  it('has no UTF-8 BOM at the start of _journal.json', () => {
    const hasBom = journalRaw[0] === 0xef && journalRaw[1] === 0xbb && journalRaw[2] === 0xbf;
    expect(hasBom).toBe(false);
  });

  it('has exactly one journal entry per migration .sql file on disk', () => {
    expect(journal.entries.length).toBe(migrationFiles.length);
  });

  it('has a journal entry for every migration file tag, and vice versa', () => {
    const journalTags = new Set(journal.entries.map((e) => e.tag));
    const fileTags = new Set(migrationFiles.map((f) => f.replace(/\.sql$/, '')));

    const filesWithoutJournalEntry = [...fileTags].filter((t) => !journalTags.has(t));
    const journalEntriesWithoutFile = [...journalTags].filter((t) => !fileTags.has(t));

    expect(filesWithoutJournalEntry).toEqual([]);
    expect(journalEntriesWithoutFile).toEqual([]);
  });

  it('has sequential idx values with no gaps or duplicates', () => {
    const sortedIdx = journal.entries.map((e) => e.idx).sort((a, b) => a - b);
    const expectedIdx = journal.entries.map((_, i) => i);
    expect(sortedIdx).toEqual(expectedIdx);
  });

  it('has strictly increasing `when` timestamps, except at documented pre-existing exceptions', () => {
    const violations: string[] = [];
    for (let i = 1; i < journal.entries.length; i++) {
      const prev = journal.entries[i - 1];
      const curr = journal.entries[i];
      if (curr.when <= prev.when && !KNOWN_PREEXISTING_TIMESTAMP_EXCEPTIONS.has(prev.idx)) {
        violations.push(
          `idx ${prev.idx} (${prev.tag}, when=${prev.when}) is not < idx ${curr.idx} (${curr.tag}, when=${curr.when})`
        );
      }
    }
    expect(violations).toEqual([]);
  });
});
