/**
 * Excel → ERP Import Converter
 *
 * Reads the ERP standard Excel templates (see tools/migration/templates/)
 * and converts them to canonical ERP import format.
 *
 * Uses the `xlsx` package (SheetJS community edition).
 *
 * Template column layouts:
 *   customers-template.xlsx  → row 1 = headers (see CustomerSchema)
 *   suppliers-template.xlsx  → row 1 = headers (see SupplierSchema)
 *   items-template.xlsx      → row 1 = headers (see ItemSchema)
 *   opening-stock-template.xlsx → row 1 = headers (see OpeningStockSchema)
 */

import * as XLSX from 'xlsx';
import path from 'node:path';
import fs from 'node:fs';

/** Reads an Excel file and returns all rows as plain objects (row 1 = headers). */
export function readExcelFile(filePath: string): Record<string, unknown>[] {
  const absPath = path.resolve(filePath);
  if (!fs.existsSync(absPath)) {
    throw new Error(`File not found: ${absPath}`);
  }

  const workbook = XLSX.readFile(absPath, { type: 'file', cellText: false, cellDates: true });
  const sheetName = workbook.SheetNames[0];
  if (!sheetName) {
    throw new Error('Excel file has no sheets');
  }

  const sheet = workbook.Sheets[sheetName];
  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, {
    raw: false, // convert dates and numbers to strings for Zod coercion
    defval: '',
  });

  // Normalise column headers: lowercase, spaces → underscores
  return rows.map((row) => {
    const normalised: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(row)) {
      const normKey = key.trim().toLowerCase().replace(/\s+/g, '_').replace(/[^a-z0-9_]/g, '');
      normalised[normKey] = val;
    }
    return normalised;
  });
}

/**
 * Generates blank Excel templates with correct headers.
 * Run once to produce the templates that clients fill in.
 */
export function generateTemplates(outputDir: string): void {
  const templates: Array<{ name: string; headers: string[] }> = [
    {
      name: 'customers-template',
      headers: [
        'displayName', 'companyName', 'gstin', 'pan',
        'phone', 'email', 'address', 'city', 'state', 'pincode',
        'creditLimit', 'openingBalance',
      ],
    },
    {
      name: 'suppliers-template',
      headers: [
        'displayName', 'companyName', 'gstin',
        'phone', 'email', 'address', 'city', 'state', 'pincode',
        'openingBalance',
      ],
    },
    {
      name: 'items-template',
      headers: [
        'name', 'sku', 'hsnCode', 'gstRate', 'unit',
        'category', 'brand', 'sellingPrice', 'costPrice', 'minSalePrice',
      ],
    },
    {
      name: 'opening-stock-template',
      headers: ['itemSku', 'warehouseName', 'quantity', 'costPerUnit'],
    },
    {
      name: 'opening-balances-template',
      headers: ['accountCode', 'accountName', 'debit', 'credit', 'narration'],
    },
  ];

  for (const tpl of templates) {
    const wb = XLSX.utils.book_new();
    // Row 1 = headers, Row 2 = example row
    const ws = XLSX.utils.aoa_to_sheet([
      tpl.headers,
      tpl.headers.map(() => ''), // blank example row
    ]);

    // Bold the header row via cell styles (basic)
    XLSX.utils.book_append_sheet(wb, ws, 'Sheet1');
    const filePath = path.join(outputDir, `${tpl.name}.xlsx`);
    XLSX.writeFile(wb, filePath);
    console.log(`  ✅ Generated: ${filePath}`);
  }
}
