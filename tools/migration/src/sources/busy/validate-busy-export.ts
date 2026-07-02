/**
 * Busy Export Validator
 *
 * Validates a Busy-exported CSV before transformation.
 * Reports Busy-specific data quality issues (duplicate account names,
 * missing HSN codes for items above GST threshold, etc.).
 */

import type { BusyRawRow } from './busy-extractor.js';

export interface BusyValidationIssue {
  row: number;
  severity: 'ERROR' | 'WARNING';
  field: string;
  message: string;
}

export function validateBusyCustomerExport(rows: BusyRawRow[]): BusyValidationIssue[] {
  const issues: BusyValidationIssue[] = [];
  const seenNames = new Set<string>();

  rows.forEach((row, idx) => {
    const rowNum = idx + 2;
    const name = (row['account_name'] ?? row['name'] ?? '').trim();

    if (!name) {
      issues.push({ row: rowNum, severity: 'ERROR', field: 'account_name', message: 'Account name is empty' });
    }

    if (name && seenNames.has(name.toLowerCase())) {
      issues.push({ row: rowNum, severity: 'WARNING', field: 'account_name', message: `Duplicate account name: "${name}"` });
    }
    seenNames.add(name.toLowerCase());

    const gstin = (row['gst_number'] ?? row['gstin'] ?? '').trim();
    if (gstin && !/^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}$/.test(gstin)) {
      issues.push({ row: rowNum, severity: 'ERROR', field: 'gstin', message: `Invalid GSTIN format: "${gstin}"` });
    }

    const balance = parseFloat((row['opening_balance'] ?? '0').replace(/,/g, ''));
    if (isNaN(balance)) {
      issues.push({ row: rowNum, severity: 'WARNING', field: 'opening_balance', message: 'Opening balance is not a number' });
    }
  });

  return issues;
}

export function validateBusyItemExport(rows: BusyRawRow[]): BusyValidationIssue[] {
  const issues: BusyValidationIssue[] = [];
  const seenNames = new Set<string>();

  rows.forEach((row, idx) => {
    const rowNum = idx + 2;
    const name = (row['item_name'] ?? row['name'] ?? '').trim();

    if (!name) {
      issues.push({ row: rowNum, severity: 'ERROR', field: 'item_name', message: 'Item name is empty' });
    }
    if (name && seenNames.has(name.toLowerCase())) {
      issues.push({ row: rowNum, severity: 'WARNING', field: 'item_name', message: `Duplicate item name: "${name}"` });
    }
    seenNames.add(name.toLowerCase());

    const hsn = (row['hsn_code'] ?? row['hsn'] ?? '').trim();
    if (!hsn) {
      issues.push({ row: rowNum, severity: 'ERROR', field: 'hsn_code', message: 'HSN code is missing (mandatory for GST)' });
    } else if (!/^[0-9]{4,8}$/.test(hsn)) {
      issues.push({ row: rowNum, severity: 'ERROR', field: 'hsn_code', message: `Invalid HSN format: "${hsn}" (must be 4–8 digits)` });
    }

    const gstRaw = (row['gst_rate'] ?? row['gst_%'] ?? '').replace('%', '').trim();
    const gstRate = parseFloat(gstRaw);
    const VALID_RATES = [0, 0.1, 0.25, 1.5, 3, 5, 7.5, 12, 18, 28];
    if (!VALID_RATES.includes(gstRate)) {
      issues.push({
        row: rowNum,
        severity: 'ERROR',
        field: 'gst_rate',
        message: `Invalid GST rate: ${gstRaw}. Valid rates: ${VALID_RATES.join(', ')}`,
      });
    }

    const saleRate = parseFloat((row['sale_rate'] ?? row['selling_price'] ?? '0').replace(/,/g, ''));
    if (isNaN(saleRate) || saleRate <= 0) {
      issues.push({ row: rowNum, severity: 'WARNING', field: 'sale_rate', message: 'Selling price is missing or zero' });
    }
  });

  return issues;
}

export function printBusyValidationIssues(issues: BusyValidationIssue[]): void {
  const errors = issues.filter((i) => i.severity === 'ERROR');
  const warnings = issues.filter((i) => i.severity === 'WARNING');

  console.log(`\n── Busy Export Validation ──────────────────────────────`);
  console.log(`  Errors   : ${errors.length}`);
  console.log(`  Warnings : ${warnings.length}`);

  if (errors.length > 0) {
    console.log(`\n  ERRORS (must fix before migrating):`);
    errors.slice(0, 30).forEach((e) => {
      console.log(`    Row ${e.row} | ${e.field}: ${e.message}`);
    });
  }

  if (warnings.length > 0) {
    console.log(`\n  WARNINGS (review recommended):`);
    warnings.slice(0, 20).forEach((w) => {
      console.log(`    Row ${w.row} | ${w.field}: ${w.message}`);
    });
  }
}
