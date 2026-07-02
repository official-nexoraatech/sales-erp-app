import * as XLSX from 'xlsx';
import type { ReportDefinition } from './ReportRegistry.js';
import type { ReportResult, ReportRow } from './ReportEngine.js';

export type ExportFormat = 'JSON' | 'CSV' | 'EXCEL';

function formatCellValue(value: unknown, type: string): string | number {
  if (value === null || value === undefined) return '';
  if (type === 'currency' || type === 'number' || type === 'percent') {
    const n = parseFloat(String(value));
    return isNaN(n) ? 0 : n;
  }
  if (type === 'date') {
    const d = new Date(String(value));
    return isNaN(d.getTime()) ? String(value) : d.toLocaleDateString('en-IN');
  }
  return String(value);
}

export class ReportFormatter {
  toCSV(definition: ReportDefinition, result: ReportResult): string {
    const { columns } = definition;
    const header = columns.map((c) => `"${c.label}"`).join(',');
    const rows = result.rows.map((row) => {
      return columns
        .map((col) => {
          const raw = row[col.key];
          const val = formatCellValue(raw, col.type);
          return typeof val === 'string' ? `"${val.replace(/"/g, '""')}"` : val;
        })
        .join(',');
    });
    return [header, ...rows].join('\n');
  }

  toExcel(definition: ReportDefinition, result: ReportResult): Buffer {
    const { columns } = definition;

    const headerRow = columns.map((c) => c.label);
    const dataRows = result.rows.map((row) =>
      columns.map((col) => formatCellValue(row[col.key], col.type))
    );

    const wsData = [headerRow, ...dataRows];
    const ws = XLSX.utils.aoa_to_sheet(wsData);

    // Style header row bold
    const range = XLSX.utils.decode_range(ws['!ref'] ?? 'A1');
    for (let c = range.s.c; c <= range.e.c; c++) {
      const cellAddress = XLSX.utils.encode_cell({ r: 0, c });
      if (!ws[cellAddress]) continue;
      ws[cellAddress].s = { font: { bold: true } };
    }

    // Auto column widths
    ws['!cols'] = columns.map((col) => ({
      wch: Math.max(col.label.length + 2, 12),
    }));

    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, definition.name.slice(0, 31));

    // Add metadata sheet
    const metaWs = XLSX.utils.aoa_to_sheet([
      ['Report', definition.name],
      ['Category', definition.category],
      ['Generated At', result.generatedAt],
      ['Total Rows', result.totalRows],
    ]);
    XLSX.utils.book_append_sheet(wb, metaWs, 'Info');

    return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
  }

  getContentType(format: ExportFormat): string {
    switch (format) {
      case 'CSV': return 'text/csv';
      case 'EXCEL': return 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
      default: return 'application/json';
    }
  }

  getFileName(slug: string, format: ExportFormat): string {
    const ts = new Date().toISOString().slice(0, 10);
    const ext = format === 'EXCEL' ? 'xlsx' : format.toLowerCase();
    return `${slug}-${ts}.${ext}`;
  }

  summarize(result: ReportResult, definition: ReportDefinition): Record<string, number> {
    const totals: Record<string, number> = {};
    for (const col of definition.columns) {
      if (col.type === 'currency' || col.type === 'number') {
        totals[col.key] = result.rows.reduce((sum, row) => {
          const v = parseFloat(String(row[col.key] ?? 0));
          return sum + (isNaN(v) ? 0 : v);
        }, 0);
      }
    }
    return totals;
  }
}
