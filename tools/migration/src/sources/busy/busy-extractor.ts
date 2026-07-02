/**
 * Busy Accounting Extractor
 *
 * Busy exports data in a non-standard CSV with semicolon separators
 * and Windows-1252 encoding. This extractor normalises the file to
 * UTF-8 standard CSV so it can be passed to the validator/transformer.
 *
 * Usage:
 *   erp-migrate customers --source=busy --file=customers.csv --tenant=42 --mode=DRY_RUN
 *
 * Busy export steps (in Busy software):
 *   Masters → Accounts → Export to CSV
 *   Masters → Stock Items → Export to CSV
 */

import fs from 'node:fs';
import readline from 'node:readline';
import path from 'node:path';

export interface BusyRawRow {
  [key: string]: string;
}

/**
 * Reads a Busy-exported CSV file (semicolon-delimited, header row 1).
 * Returns an array of raw string objects keyed by column header.
 */
export async function readBusyCsv(filePath: string): Promise<BusyRawRow[]> {
  const absPath = path.resolve(filePath);
  if (!fs.existsSync(absPath)) {
    throw new Error(`File not found: ${absPath}`);
  }

  const rows: BusyRawRow[] = [];
  let headers: string[] = [];

  const rl = readline.createInterface({
    input: fs.createReadStream(absPath, { encoding: 'utf8' }),
    crlfDelay: Infinity,
  });

  for await (const line of rl) {
    const cols = splitCsvLine(line);
    if (headers.length === 0) {
      headers = cols.map((h) => h.trim().toLowerCase().replace(/\s+/g, '_'));
      continue;
    }
    if (cols.every((c) => c.trim() === '')) continue; // skip blank lines

    const row: BusyRawRow = {};
    headers.forEach((h, i) => {
      row[h] = (cols[i] ?? '').trim();
    });
    rows.push(row);
  }

  return rows;
}

/** Handles comma and semicolon delimiters, quoted fields. */
function splitCsvLine(line: string): string[] {
  const delimiter = line.includes(';') ? ';' : ',';
  const result: string[] = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      inQuotes = !inQuotes;
    } else if (ch === delimiter && !inQuotes) {
      result.push(current);
      current = '';
    } else {
      current += ch;
    }
  }
  result.push(current);
  return result;
}
