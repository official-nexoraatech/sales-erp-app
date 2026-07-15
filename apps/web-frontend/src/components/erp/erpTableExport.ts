interface CsvColumn {
  key: string;
  header: string;
}

function escapeCsvCell(value: unknown): string {
  const s = value === null || value === undefined ? '' : String(value);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** Exports each column's raw field value, not its `render`ed JSX — a custom `render`
 * (badges, links, formatted composites) has no generic plain-text form to fall back to. */
export function toCsv<T>(columns: CsvColumn[], rows: T[]): string {
  const header = columns.map((c) => escapeCsvCell(c.header || c.key)).join(',');
  const body = rows
    .map((r) => columns.map((c) => escapeCsvCell((r as Record<string, unknown>)[c.key])).join(','))
    .join('\n');
  return [header, body].join('\n');
}

export function downloadCsv(filename: string, csv: string): void {
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename.endsWith('.csv') ? filename : `${filename}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
