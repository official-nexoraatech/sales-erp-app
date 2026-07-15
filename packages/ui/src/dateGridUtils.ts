/** Plain-Date calendar-grid helpers shared by DatePicker and DateTimePicker — no date
 * library dependency, matching the rest of this codebase (lib/format.ts also uses plain
 * Date math). */

export function toISODate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function parseISODate(iso: string): Date {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y!, (m ?? 1) - 1, d ?? 1);
}

export function isSameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

export function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

/** Returns a 6-row x 7-col grid of Dates for the month containing `viewDate`, padded with
 * the tail of the previous month and the head of the next so every week row is complete. */
export function buildMonthGrid(viewDate: Date): Date[][] {
  const year = viewDate.getFullYear();
  const month = viewDate.getMonth();
  const firstOfMonth = new Date(year, month, 1);
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const startOffset = firstOfMonth.getDay();
  const cells: Date[] = [];
  for (let i = 0; i < startOffset; i++) cells.push(new Date(year, month, 1 - (startOffset - i)));
  for (let d = 1; d <= daysInMonth; d++) cells.push(new Date(year, month, d));
  while (cells.length % 7 !== 0 || cells.length < 42) {
    cells.push(new Date(year, month, daysInMonth + (cells.length - startOffset - daysInMonth) + 1));
  }
  const rows: Date[][] = [];
  for (let i = 0; i < cells.length; i += 7) rows.push(cells.slice(i, i + 7));
  return rows;
}

export const WEEKDAY_LABELS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];
