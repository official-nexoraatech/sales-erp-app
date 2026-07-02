import postgres from 'postgres';
import type { ReconciliationReport } from '../types.js';

interface ReconciliationInput {
  tenantId: number;
  databaseUrl: string;
  sourceCustomerCount?: number;
  sourceSupplierCount?: number;
  sourceItemCount?: number;
  sourceCustomerOutstanding?: number;
  sourceSupplierOutstanding?: number;
  sourceStockValue?: number;
}

export async function runReconciliation(input: ReconciliationInput): Promise<ReconciliationReport> {
  const sql = postgres(input.databaseUrl, { max: 3 });
  const checks: ReconciliationReport['checks'] = [];

  try {
    const { tenantId } = input;

    // ── Customer count ────────────────────────────────────────────────────────
    const [{ count: custCount }] = await sql<[{ count: string }]>`
      SELECT COUNT(*) as count FROM customers WHERE tenant_id = ${tenantId} AND deleted_at IS NULL
    `;
    checks.push({
      name: 'Customer count',
      sourceValue: input.sourceCustomerCount ?? 'N/A (not provided)',
      erpValue: parseInt(custCount),
      tolerance: 0,
      passed: input.sourceCustomerCount == null || parseInt(custCount) === input.sourceCustomerCount,
    });

    // ── Supplier count ────────────────────────────────────────────────────────
    const [{ count: suppCount }] = await sql<[{ count: string }]>`
      SELECT COUNT(*) as count FROM suppliers WHERE tenant_id = ${tenantId} AND deleted_at IS NULL
    `;
    checks.push({
      name: 'Supplier count',
      sourceValue: input.sourceSupplierCount ?? 'N/A',
      erpValue: parseInt(suppCount),
      tolerance: 0,
      passed: input.sourceSupplierCount == null || parseInt(suppCount) === input.sourceSupplierCount,
    });

    // ── Item count ────────────────────────────────────────────────────────────
    const [{ count: itemCount }] = await sql<[{ count: string }]>`
      SELECT COUNT(*) as count FROM items WHERE tenant_id = ${tenantId} AND deleted_at IS NULL
    `;
    checks.push({
      name: 'Item count',
      sourceValue: input.sourceItemCount ?? 'N/A',
      erpValue: parseInt(itemCount),
      tolerance: 0,
      passed: input.sourceItemCount == null || parseInt(itemCount) === input.sourceItemCount,
    });

    // ── Customer outstanding ──────────────────────────────────────────────────
    const [{ total: custOutstanding }] = await sql<[{ total: string }]>`
      SELECT COALESCE(SUM(opening_balance), 0) AS total
      FROM customers WHERE tenant_id = ${tenantId}
    `;
    const erpCustOutstanding = parseFloat(custOutstanding);
    const srcCustOut = input.sourceCustomerOutstanding ?? null;
    checks.push({
      name: 'Total customer outstanding (₹)',
      sourceValue: srcCustOut ?? 'N/A',
      erpValue: erpCustOutstanding,
      tolerance: 10,
      passed: srcCustOut == null || Math.abs(erpCustOutstanding - srcCustOut) <= 10,
      difference: srcCustOut != null ? Math.abs(erpCustOutstanding - srcCustOut) : undefined,
    });

    // ── Supplier outstanding ──────────────────────────────────────────────────
    const [{ total: suppOutstanding }] = await sql<[{ total: string }]>`
      SELECT COALESCE(SUM(opening_balance), 0) AS total
      FROM suppliers WHERE tenant_id = ${tenantId}
    `;
    const erpSuppOutstanding = parseFloat(suppOutstanding);
    const srcSuppOut = input.sourceSupplierOutstanding ?? null;
    checks.push({
      name: 'Total supplier outstanding (₹)',
      sourceValue: srcSuppOut ?? 'N/A',
      erpValue: erpSuppOutstanding,
      tolerance: 10,
      passed: srcSuppOut == null || Math.abs(erpSuppOutstanding - srcSuppOut) <= 10,
      difference: srcSuppOut != null ? Math.abs(erpSuppOutstanding - srcSuppOut) : undefined,
    });

    // ── Stock value ───────────────────────────────────────────────────────────
    const [{ total: stockValue }] = await sql<[{ total: string }]>`
      SELECT COALESCE(SUM(total_cost), 0) AS total
      FROM inventory_ledger WHERE tenant_id = ${tenantId} AND transaction_type = 'OPENING'
    `;
    const erpStockValue = parseFloat(stockValue);
    const srcStockVal = input.sourceStockValue ?? null;
    checks.push({
      name: 'Total opening stock value (₹)',
      sourceValue: srcStockVal ?? 'N/A',
      erpValue: erpStockValue,
      tolerance: 10,
      passed: srcStockVal == null || Math.abs(erpStockValue - srcStockVal) <= 10,
      difference: srcStockVal != null ? Math.abs(erpStockValue - srcStockVal) : undefined,
    });

    // ── Trial balance ─────────────────────────────────────────────────────────
    const [{ dr, cr }] = await sql<[{ dr: string; cr: string }]>`
      SELECT COALESCE(SUM(debit), 0) AS dr, COALESCE(SUM(credit), 0) AS cr
      FROM financial_entries WHERE tenant_id = ${tenantId} AND entry_type = 'OPENING_BALANCE'
    `;
    const drTotal = parseFloat(dr);
    const crTotal = parseFloat(cr);
    checks.push({
      name: 'Trial balance: DR = CR',
      sourceValue: `DR=${drTotal.toFixed(2)}`,
      erpValue: `CR=${crTotal.toFixed(2)}`,
      tolerance: 0,
      passed: Math.abs(drTotal - crTotal) < 0.01,
      difference: Math.abs(drTotal - crTotal),
    });
  } finally {
    await sql.end();
  }

  const overallPass = checks.every((c) => c.passed);

  return {
    tenantId: input.tenantId,
    generatedAt: new Date().toISOString(),
    checks,
    overallPass,
  };
}

export function printReconciliationReport(report: ReconciliationReport): void {
  console.log(`\n${'═'.repeat(60)}`);
  console.log(`RECONCILIATION REPORT — Tenant ${report.tenantId}`);
  console.log(`Generated: ${report.generatedAt}`);
  console.log(`${'═'.repeat(60)}`);

  for (const check of report.checks) {
    const icon = check.passed ? '✅' : '❌';
    console.log(`\n${icon} ${check.name}`);
    console.log(`   Source ERP  : ${check.sourceValue}`);
    console.log(`   New ERP     : ${check.erpValue}`);
    if (check.difference !== undefined) {
      console.log(`   Difference  : ${check.difference} (tolerance: ₹${check.tolerance})`);
    }
  }

  console.log(`\n${'═'.repeat(60)}`);
  console.log(report.overallPass ? '✅ ALL CHECKS PASSED — SAFE TO GO LIVE' : '❌ RECONCILIATION FAILED — DO NOT GO LIVE');
  console.log(`${'═'.repeat(60)}\n`);
}
