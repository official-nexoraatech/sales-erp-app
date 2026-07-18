import { describe, it, expect } from 'vitest';
import { toCsv } from '../erpTableExport.js';

describe('toCsv — CSV/formula injection (CWE-1236)', () => {
  const columns = [{ key: 'name', header: 'Name' }];
  const cellOf = (value: unknown) => toCsv(columns, [{ name: value }]).split('\n')[1];

  it('prefixes a leading single quote on values starting with =, +, -, @, tab, or CR', () => {
    expect(cellOf('=1+1')).toBe("'=1+1");
    expect(cellOf('+1+1')).toBe("'+1+1");
    expect(cellOf('-1+1')).toBe("'-1+1");
    expect(cellOf('@SUM(1,1)')).toBe('"\'@SUM(1,1)"');
    expect(cellOf('\tmalicious')).toBe("'\tmalicious");
  });

  it('leaves ordinary values untouched', () => {
    expect(cellOf('Acme Corp')).toBe('Acme Corp');
  });
});
