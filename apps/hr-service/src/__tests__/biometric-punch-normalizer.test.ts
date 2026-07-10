import { describe, it, expect } from 'vitest';
import { BiometricPunchNormalizer, DEFAULT_BIOMETRIC_CONFIG, type BiometricDeviceConfigInput } from '../domain/BiometricPunchNormalizer.js';

describe('BiometricPunchNormalizer.parseRawPunches', () => {
  it('parses a generic CSV punch log using the default column mapping', () => {
    const csv = [
      'EmployeeID,Date,Time,Direction',
      'EMP-00010,2024-01-15,09:02:00,IN',
      'EMP-00010,2024-01-15,18:10:00,OUT',
    ].join('\n');

    const { punches, warnings } = BiometricPunchNormalizer.parseRawPunches(csv, DEFAULT_BIOMETRIC_CONFIG);

    expect(warnings).toHaveLength(0);
    expect(punches).toHaveLength(2);
    expect(punches[0]).toEqual({ employeeCode: 'EMP-00010', date: '2024-01-15', time: '09:02:00' });
  });

  it('parses an ESSL-style layout with DD-MM-YYYY dates via a custom column mapping', () => {
    const config: BiometricDeviceConfigInput = {
      columnMapping: { employeeCode: 'UserID', date: 'AttDate', time: 'AttTime', direction: 'C/I C/O' },
      dateFormat: 'DD-MM-YYYY',
    };
    const csv = ['UserID,AttDate,AttTime,C/I C/O', '42,15-01-2024,09:05,IN'].join('\n');

    const { punches, warnings } = BiometricPunchNormalizer.parseRawPunches(csv, config);

    expect(warnings).toHaveLength(0);
    expect(punches).toEqual([{ employeeCode: '42', date: '2024-01-15', time: '09:05:00' }]);
  });

  it('parses a ZKTeco-style layout with MM/DD/YYYY dates', () => {
    const config: BiometricDeviceConfigInput = {
      columnMapping: { employeeCode: 'PIN', date: 'Date', time: 'Time', direction: 'Verify' },
      dateFormat: 'MM/DD/YYYY',
    };
    const csv = ['PIN,Date,Time,Verify', '7,01/15/2024,17:45,1'].join('\n');

    const { punches, warnings } = BiometricPunchNormalizer.parseRawPunches(csv, config);

    expect(warnings).toHaveLength(0);
    expect(punches).toEqual([{ employeeCode: '7', date: '2024-01-15', time: '17:45:00' }]);
  });

  it('collects a warning and skips a row with a missing employee code', () => {
    const csv = ['EmployeeID,Date,Time,Direction', ',2024-01-15,09:00:00,IN'].join('\n');
    const { punches, warnings } = BiometricPunchNormalizer.parseRawPunches(csv, DEFAULT_BIOMETRIC_CONFIG);

    expect(punches).toHaveLength(0);
    expect(warnings).toEqual([{ row: 2, message: 'Missing employee code' }]);
  });

  it('collects a warning and skips a row with an unparseable date', () => {
    const csv = ['EmployeeID,Date,Time,Direction', 'EMP-1,not-a-date,09:00:00,IN'].join('\n');
    const { warnings, punches } = BiometricPunchNormalizer.parseRawPunches(csv, DEFAULT_BIOMETRIC_CONFIG);

    expect(punches).toHaveLength(0);
    expect(warnings[0]?.message).toContain('Unparseable date');
  });

  it('collects a warning and skips a row with an unparseable time', () => {
    const csv = ['EmployeeID,Date,Time,Direction', 'EMP-1,2024-01-15,not-a-time,IN'].join('\n');
    const { warnings, punches } = BiometricPunchNormalizer.parseRawPunches(csv, DEFAULT_BIOMETRIC_CONFIG);

    expect(punches).toHaveLength(0);
    expect(warnings[0]?.message).toContain('Unparseable time');
  });
});

describe('BiometricPunchNormalizer.groupByEmployeeDay', () => {
  it('collapses multiple punches for the same employee/day into a single check-in/check-out row', () => {
    const grouped = BiometricPunchNormalizer.groupByEmployeeDay([
      { employeeCode: 'EMP-1', date: '2024-01-15', time: '09:02:00' },
      { employeeCode: 'EMP-1', date: '2024-01-15', time: '13:00:00' },
      { employeeCode: 'EMP-1', date: '2024-01-15', time: '18:10:00' },
    ]);

    expect(grouped).toEqual([
      { employeeCode: 'EMP-1', date: '2024-01-15', checkInTime: '09:02:00', checkOutTime: '18:10:00', punchCount: 3 },
    ]);
  });

  it('leaves checkOutTime undefined for a single-punch day', () => {
    const grouped = BiometricPunchNormalizer.groupByEmployeeDay([
      { employeeCode: 'EMP-1', date: '2024-01-15', time: '09:02:00' },
    ]);

    expect(grouped).toEqual([
      { employeeCode: 'EMP-1', date: '2024-01-15', checkInTime: '09:02:00', checkOutTime: undefined, punchCount: 1 },
    ]);
  });

  it('keeps separate employees and separate days as distinct groups', () => {
    const grouped = BiometricPunchNormalizer.groupByEmployeeDay([
      { employeeCode: 'EMP-1', date: '2024-01-15', time: '09:00:00' },
      { employeeCode: 'EMP-2', date: '2024-01-15', time: '09:00:00' },
      { employeeCode: 'EMP-1', date: '2024-01-16', time: '09:00:00' },
    ]);

    expect(grouped).toHaveLength(3);
  });
});

describe('BiometricPunchNormalizer.deriveStatus', () => {
  const shift = { startTime: '09:00:00', gracePeriodMinutes: 15, halfDayHours: 4 };

  it('returns PRESENT with no shift configured (cannot determine lateness)', () => {
    expect(BiometricPunchNormalizer.deriveStatus('10:30:00', '18:00:00', undefined)).toBe('PRESENT');
  });

  it('returns PRESENT for an on-time check-in within the grace period', () => {
    expect(BiometricPunchNormalizer.deriveStatus('09:10:00', '18:00:00', shift)).toBe('PRESENT');
  });

  it('returns LATE when check-in is after start time plus grace period', () => {
    expect(BiometricPunchNormalizer.deriveStatus('09:20:00', '18:00:00', shift)).toBe('LATE');
  });

  it('returns HALF_DAY when total work hours fall below the shift half-day threshold, even if check-in was late', () => {
    expect(BiometricPunchNormalizer.deriveStatus('09:20:00', '12:00:00', shift)).toBe('HALF_DAY');
  });

  it('returns PRESENT for a single punch (no check-out) that is on time', () => {
    expect(BiometricPunchNormalizer.deriveStatus('08:55:00', undefined, shift)).toBe('PRESENT');
  });
});
