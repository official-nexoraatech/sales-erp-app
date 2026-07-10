// PG-014 — regression guard for "permission constant defined, never actually enforced
// anywhere" (the exact bug class this package remediated: 15 constants existed in
// PERMISSIONS but no route checked them, so granting/withholding them via a custom role
// did nothing — see permissions.ts's "PG-014" comments for the retire decisions, and
// ORGANIZATION_VIEW / BRANCH_SCOPE_BYPASS for the two that were wired up instead).
//
// This scans for the literal `PERMISSIONS.<KEY>` textual pattern across every backend
// service and the shared platform SDK (not just `requirePermission()` calls — some
// constants are legitimately enforced via an inline `.permissions.includes(PERMISSIONS.X)`
// check instead, e.g. BRANCH_SCOPE_BYPASS in packages/platform-sdk/src/auth.ts).
//
// KNOWN_PREEXISTING_DEAD_CONSTANTS: running this scan against the full PERMISSIONS object
// turned up 63 more dead constants beyond the 15 this package was scoped to fix (e.g.
// CUSTOMER_STATEMENT_VIEW, POS_ACCESS, ITEM_UPDATE) — a materially larger, separate gap
// that needs its own per-constant wire-up-vs-retire review (same shape as PG-014, much
// larger scope). Out of scope here; allowlisted below so this test still catches any *new*
// constant shipped without enforcement, rather than failing immediately on pre-existing debt
// this package didn't touch. Do not add to this list going forward — fix or retire instead.
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PERMISSIONS } from '../permissions.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, '../../../..');

const KNOWN_PREEXISTING_DEAD_CONSTANTS = [
  'WAREHOUSE_DELETE', 'CUSTOMER_CREDIT_LIMIT_VIEW', 'CUSTOMER_STATEMENT_VIEW', 'CUSTOMER_BLOCK',
  'CUSTOMER_IMPORT', 'CUSTOMER_EXPORT', 'SUPPLIER_UPDATE', 'SUPPLIER_IMPORT', 'SUPPLIER_EXPORT',
  'ITEM_UPDATE', 'ITEM_PRICE_UPDATE', 'ITEM_IMPORT', 'ITEM_EXPORT', 'ITEM_BARCODE_PRINT',
  'INVOICE_PRINT', 'INVOICE_EMAIL', 'INVOICE_EXPORT', 'INVOICE_DELETE_DRAFT', 'QUOTATION_PRINT',
  'PAYMENT_IN_CREATE', 'PAYMENT_IN_CANCEL', 'PAYMENT_IN_PRINT', 'SALE_RETURN_CANCEL',
  'CREDIT_NOTE_CANCEL', 'CREDIT_NOTE_ADJUST', 'POS_ACCESS', 'POS_OPEN_SHIFT', 'POS_CLOSE_SHIFT',
  'POS_APPLY_DISCOUNT', 'POS_VOID_BILL', 'POS_CASH_DRAWER', 'PO_PRINT', 'PO_EMAIL', 'GRN_CANCEL',
  'PAYMENT_OUT_CANCEL', 'PAYMENT_OUT_APPROVE', 'EXPENSE_CANCEL', 'VOUCHER_CANCEL', 'GST_RECONCILE',
  'EWAY_BILL_CANCEL', 'STOCK_ADJUST_APPROVE', 'STOCK_TRANSFER_APPROVE', 'STOCK_PHYSICAL_VERIFY',
  'STOCK_RESERVE', 'STOCK_REPORT_VIEW', 'FABRIC_ROLL_VIEW', 'FABRIC_ROLL_CREATE', 'CRM_LOYALTY_VIEW',
  'CRM_LOYALTY_ADJUST', 'REPORT_SHARE', 'NOTIFICATION_VIEW', 'NOTIFICATION_CONFIG', 'JOB_CONFIG',
  'PRICE_LIST_CREATE', 'PRICE_LIST_UPDATE', 'PRICE_LIST_DELETE', 'SUPPLIER_BANK_VIEW',
  'STOCK_TRANSFER_MANAGE', 'STOCK_ADJUSTMENT_MANAGE', 'PHYSICAL_VERIFICATION_VIEW',
  'PHYSICAL_VERIFICATION_MANAGE', 'FABRIC_ROLL_MANAGE', 'JOB_WORK_UPDATE',
];

function collectSourceFiles(dir: string, out: string[]): void {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (['node_modules', 'dist', '__tests__', 'test'].includes(entry.name)) continue;
      collectSourceFiles(full, out);
    } else if (entry.name.endsWith('.ts') || entry.name.endsWith('.tsx')) {
      out.push(full);
    }
  }
}

describe('permission-constant enforcement coverage', () => {
  it('every exported PERMISSIONS constant is referenced somewhere outside its own definition (or is documented pre-existing debt)', () => {
    const files: string[] = [];
    for (const rootName of ['apps', 'packages']) {
      const rootDir = join(REPO_ROOT, rootName);
      for (const pkg of readdirSync(rootDir, { withFileTypes: true })) {
        if (!pkg.isDirectory()) continue;
        const srcDir = join(rootDir, pkg.name, 'src');
        try {
          collectSourceFiles(srcDir, files);
        } catch {
          // no src/, skip
        }
      }
    }

    // Exclude permissions.ts itself (the definition) and its hand-mirrored frontend copy
    // (a dead constant redefined there would otherwise "prove" itself live).
    const relevant = files.filter((f) => {
      const norm = f.replace(/\\/g, '/');
      return !norm.endsWith('constants/permissions.ts') && !norm.endsWith('shared-types/src/permissions.ts');
    });
    const combined = relevant.map((f) => readFileSync(f, 'utf8')).join('\n');

    const dead: string[] = [];
    for (const key of Object.keys(PERMISSIONS)) {
      if (KNOWN_PREEXISTING_DEAD_CONSTANTS.includes(key)) continue;
      if (!combined.includes(`PERMISSIONS.${key}`)) {
        dead.push(key);
      }
    }

    expect(
      dead,
      `Permission constants defined but never referenced anywhere (dead constants — see PG-014 for the remediation pattern: wire it up or formally retire it):\n${dead.join('\n')}`
    ).toEqual([]);
  });
});
