export interface BiometricColumnMapping {
  employeeCode: string;
  date: string;
  time: string;
  direction: string;
}

export interface BiometricDeviceConfigInput {
  columnMapping: BiometricColumnMapping;
  dateFormat: string;
}

export const DEFAULT_BIOMETRIC_CONFIG: BiometricDeviceConfigInput = {
  columnMapping: { employeeCode: 'EmployeeID', date: 'Date', time: 'Time', direction: 'Direction' },
  dateFormat: 'YYYY-MM-DD',
};

export interface RawPunch {
  employeeCode: string;
  date: string; // normalized YYYY-MM-DD
  time: string; // normalized HH:mm:ss
}

export interface ParseWarning {
  row: number;
  message: string;
}

export interface ParseResult {
  punches: RawPunch[];
  warnings: ParseWarning[];
}

export interface GroupedPunchDay {
  employeeCode: string;
  date: string;
  checkInTime: string;
  checkOutTime?: string;
  punchCount: number;
}

export interface ShiftLike {
  startTime: string; // HH:mm or HH:mm:ss
  gracePeriodMinutes: number;
  halfDayHours: number;
}

export type DerivedStatus = 'PRESENT' | 'LATE' | 'HALF_DAY';

function timeToMinutes(time: string): number {
  const [h, m] = time.split(':').map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
}

function normalizeTime(value: string): string | null {
  const match = /^(\d{1,2}):(\d{2})(?::(\d{2}))?$/.exec(value.trim());
  if (!match) return null;
  const hh = match[1]!.padStart(2, '0');
  const mm = match[2]!;
  const ss = match[3] ?? '00';
  if (Number(hh) > 23 || Number(mm) > 59) return null;
  return `${hh}:${mm}:${ss}`;
}

function normalizeDate(value: string, format: string): string | null {
  const parts = value.trim().split(/[-/]/);
  const order = format.trim().toUpperCase().split(/[-/]/);
  if (parts.length !== 3 || order.length !== 3) return null;

  const map: Record<string, string> = {};
  order.forEach((token, i) => {
    map[token] = parts[i] ?? '';
  });
  const yyyy = map['YYYY'];
  const mm = map['MM'];
  const dd = map['DD'];
  if (!yyyy || !mm || !dd) return null;

  const y = yyyy.padStart(4, '0');
  const m = mm.padStart(2, '0');
  const d = dd.padStart(2, '0');
  const iso = `${y}-${m}-${d}`;
  return /^\d{4}-\d{2}-\d{2}$/.test(iso) ? iso : null;
}

function parseCsvRows(raw: string): Array<{ row: number; values: Record<string, string> }> {
  const lines = raw.trim().split(/\r?\n/);
  if (lines.length < 2) return [];
  const headers = lines[0]!.split(',').map((h) => h.trim().replace(/^"|"$/g, ''));
  return lines.slice(1).map((line, i) => {
    const values = line.split(',').map((v) => v.trim().replace(/^"|"$/g, ''));
    return { row: i + 2, values: Object.fromEntries(headers.map((h, idx) => [h, values[idx] ?? ''])) };
  });
}

export class BiometricPunchNormalizer {
  static parseRawPunches(raw: string, config: BiometricDeviceConfigInput): ParseResult {
    const rows = parseCsvRows(raw);
    const warnings: ParseWarning[] = [];
    const punches: RawPunch[] = [];
    const { employeeCode: ecCol, date: dateCol, time: timeCol } = config.columnMapping;

    for (const { row, values } of rows) {
      const employeeCode = values[ecCol]?.trim();
      if (!employeeCode) {
        warnings.push({ row, message: 'Missing employee code' });
        continue;
      }

      const date = normalizeDate(values[dateCol] ?? '', config.dateFormat);
      if (!date) {
        warnings.push({ row, message: `Unparseable date: ${values[dateCol] ?? ''}` });
        continue;
      }

      const time = normalizeTime(values[timeCol] ?? '');
      if (!time) {
        warnings.push({ row, message: `Unparseable time: ${values[timeCol] ?? ''}` });
        continue;
      }

      punches.push({ employeeCode, date, time });
    }

    return { punches, warnings };
  }

  static groupByEmployeeDay(punches: RawPunch[]): GroupedPunchDay[] {
    const groups = new Map<string, { employeeCode: string; date: string; times: string[] }>();
    for (const p of punches) {
      const key = `${p.employeeCode}__${p.date}`;
      const existing = groups.get(key);
      if (existing) existing.times.push(p.time);
      else groups.set(key, { employeeCode: p.employeeCode, date: p.date, times: [p.time] });
    }

    return Array.from(groups.values()).map((g) => {
      const sorted = [...g.times].sort();
      return {
        employeeCode: g.employeeCode,
        date: g.date,
        checkInTime: sorted[0]!,
        ...(sorted.length > 1 ? { checkOutTime: sorted[sorted.length - 1]! } : {}),
        punchCount: g.times.length,
      };
    });
  }

  static deriveStatus(checkInTime: string, checkOutTime: string | undefined, shift: ShiftLike | undefined): DerivedStatus {
    if (!shift) return 'PRESENT';

    if (checkOutTime) {
      const workHours = Math.max(0, (timeToMinutes(checkOutTime) - timeToMinutes(checkInTime)) / 60);
      if (workHours < shift.halfDayHours) return 'HALF_DAY';
    }

    const shiftStartMinutes = timeToMinutes(shift.startTime);
    const checkInMinutes = timeToMinutes(checkInTime);
    if (checkInMinutes > shiftStartMinutes + shift.gracePeriodMinutes) return 'LATE';

    return 'PRESENT';
  }
}
