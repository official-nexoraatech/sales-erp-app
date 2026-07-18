/* global Buffer */
import * as XLSX from 'xlsx';
import type { ExportColumn } from './ExportEngine.js';

// Deliberately duplicated from apps/report-service/src/domain/ReportFormatter.ts rather than
// shared — scheduler-service and report-service are separate deployables with no dependency
// edge between them today (see PG-009's Coding Standards section).

// Cell values starting with =, +, -, @ (or tab/CR) are interpreted as formulas by
// Excel/Sheets when a CSV/XLSX is opened, letting a free-text field (customer name,
// notes, etc.) that ends up in an export execute arbitrary formulas/commands on
// whoever opens the file (CWE-1236 CSV/formula injection). Prefixing a leading
// single quote is the standard mitigation — Excel then renders the value as literal text.
const FORMULA_INJECTION_PREFIX = /^[=+\-@\t\r]/;
function sanitizeCell(value: string): string {
  return FORMULA_INJECTION_PREFIX.test(value) ? `'${value}` : value;
}

function formatCellValue(value: unknown, type: ExportColumn['type']): string | number {
  if (value === null || value === undefined) return '';
  if (type === 'currency' || type === 'number' || type === 'percent') {
    const n = parseFloat(String(value));
    return isNaN(n) ? 0 : n;
  }
  if (type === 'date') {
    const d = new Date(String(value));
    return isNaN(d.getTime()) ? String(value) : d.toLocaleDateString('en-IN');
  }
  return sanitizeCell(String(value));
}

export class ExportFormatter {
  toCSV(columns: ExportColumn[], rows: Array<Record<string, unknown>>): string {
    const header = columns.map((c) => `"${c.label}"`).join(',');
    const dataRows = rows.map((row) =>
      columns
        .map((col) => {
          const val = formatCellValue(row[col.key], col.type);
          return typeof val === 'string' ? `"${val.replace(/"/g, '""')}"` : val;
        })
        .join(',')
    );
    return [header, ...dataRows].join('\n');
  }

  toExcel(
    entityType: string,
    columns: ExportColumn[],
    rows: Array<Record<string, unknown>>
  ): Buffer {
    const headerRow = columns.map((c) => c.label);
    const dataRows = rows.map((row) =>
      columns.map((col) => formatCellValue(row[col.key], col.type))
    );

    const wsData = [headerRow, ...dataRows];
    const ws = XLSX.utils.aoa_to_sheet(wsData);

    const range = XLSX.utils.decode_range(ws['!ref'] ?? 'A1');
    for (let c = range.s.c; c <= range.e.c; c++) {
      const cellAddress = XLSX.utils.encode_cell({ r: 0, c });
      if (!ws[cellAddress]) continue;
      ws[cellAddress].s = { font: { bold: true } };
    }

    ws['!cols'] = columns.map((col) => ({ wch: Math.max(col.label.length + 2, 12) }));

    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, entityType.slice(0, 31));

    return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
  }

  getContentType(format: 'CSV' | 'XLSX'): string {
    return format === 'XLSX'
      ? 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
      : 'text/csv';
  }

  getFileName(entityType: string, format: 'CSV' | 'XLSX'): string {
    const ts = new Date().toISOString().slice(0, 10);
    return `${entityType}-export-${ts}.${format.toLowerCase()}`;
  }
}
