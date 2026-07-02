import postgres from 'postgres';
import type {
  MigrationMode,
  MigrationEntity,
  MigrationResult,
  CanonicalCustomer,
  CanonicalSupplier,
  CanonicalItem,
  CanonicalOpeningStock,
  CanonicalOpeningBalance,
} from '../types.js';

// ── DB helpers ────────────────────────────────────────────────────────────────

function buildSql(databaseUrl: string) {
  return postgres(databaseUrl, { max: 5 });
}

// ── Customer inserter ─────────────────────────────────────────────────────────

async function insertCustomers(
  sql: ReturnType<typeof buildSql>,
  tenantId: number,
  rows: CanonicalCustomer[],
): Promise<{ success: number; errors: Array<{ row: number; message: string }> }> {
  let success = 0;
  const errors: Array<{ row: number; message: string }> = [];

  for (let i = 0; i < rows.length; i++) {
    const c = rows[i];
    try {
      await sql`
        INSERT INTO customers (
          tenant_id, display_name, company_name, gstin, pan,
          phone, email, address, city, state, pincode,
          credit_limit, opening_balance,
          created_by, created_at, updated_at, version
        ) VALUES (
          ${tenantId}, ${c.displayName}, ${c.companyName ?? null}, ${c.gstin || null},
          ${c.pan || null}, ${c.phone || null}, ${c.email || null},
          ${c.address ?? null}, ${c.city ?? null}, ${c.state ?? null},
          ${c.pincode || null}, ${c.creditLimit ?? 0}, ${c.openingBalance ?? 0},
          1, NOW(), NOW(), 0
        )
        ON CONFLICT DO NOTHING
      `;
      success++;
    } catch (err) {
      errors.push({ row: i + 2, message: (err as Error).message });
    }
  }

  return { success, errors };
}

// ── Supplier inserter ─────────────────────────────────────────────────────────

async function insertSuppliers(
  sql: ReturnType<typeof buildSql>,
  tenantId: number,
  rows: CanonicalSupplier[],
): Promise<{ success: number; errors: Array<{ row: number; message: string }> }> {
  let success = 0;
  const errors: Array<{ row: number; message: string }> = [];

  for (let i = 0; i < rows.length; i++) {
    const s = rows[i];
    try {
      await sql`
        INSERT INTO suppliers (
          tenant_id, display_name, company_name, gstin,
          phone, email, address, city, state, pincode,
          opening_balance, created_by, created_at, updated_at, version
        ) VALUES (
          ${tenantId}, ${s.displayName}, ${s.companyName ?? null}, ${s.gstin || null},
          ${s.phone || null}, ${s.email || null},
          ${s.address ?? null}, ${s.city ?? null}, ${s.state ?? null},
          ${s.pincode || null}, ${s.openingBalance ?? 0},
          1, NOW(), NOW(), 0
        )
        ON CONFLICT DO NOTHING
      `;
      success++;
    } catch (err) {
      errors.push({ row: i + 2, message: (err as Error).message });
    }
  }

  return { success, errors };
}

// ── Item inserter ─────────────────────────────────────────────────────────────

async function insertItems(
  sql: ReturnType<typeof buildSql>,
  tenantId: number,
  rows: CanonicalItem[],
): Promise<{ success: number; errors: Array<{ row: number; message: string }> }> {
  let success = 0;
  const errors: Array<{ row: number; message: string }> = [];

  for (let i = 0; i < rows.length; i++) {
    const item = rows[i];
    try {
      await sql`
        INSERT INTO items (
          tenant_id, name, sku, hsn_code, gst_rate, unit,
          selling_price, cost_price, min_sale_price,
          created_by, created_at, updated_at, version
        ) VALUES (
          ${tenantId}, ${item.name}, ${item.sku ?? null}, ${item.hsnCode},
          ${item.gstRate}, ${item.unit},
          ${item.sellingPrice}, ${item.costPrice ?? item.sellingPrice},
          ${item.minSalePrice ?? 0},
          1, NOW(), NOW(), 0
        )
        ON CONFLICT (tenant_id, sku) WHERE sku IS NOT NULL DO NOTHING
      `;
      success++;
    } catch (err) {
      errors.push({ row: i + 2, message: (err as Error).message });
    }
  }

  return { success, errors };
}

// ── Opening stock inserter ────────────────────────────────────────────────────

async function insertOpeningStock(
  sql: ReturnType<typeof buildSql>,
  tenantId: number,
  rows: CanonicalOpeningStock[],
): Promise<{ success: number; errors: Array<{ row: number; message: string }> }> {
  let success = 0;
  const errors: Array<{ row: number; message: string }> = [];

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    try {
      // Resolve item id by sku
      const [item] = await sql<[{ id: number }?]>`
        SELECT id FROM items WHERE tenant_id = ${tenantId} AND sku = ${row.itemSku} LIMIT 1
      `;
      const [wh] = await sql<[{ id: number }?]>`
        SELECT id FROM warehouses WHERE tenant_id = ${tenantId} AND name = ${row.warehouseName} LIMIT 1
      `;

      if (!item) {
        errors.push({ row: i + 2, message: `Item SKU not found: ${row.itemSku}` });
        continue;
      }
      if (!wh) {
        errors.push({ row: i + 2, message: `Warehouse not found: ${row.warehouseName}` });
        continue;
      }

      await sql`
        INSERT INTO inventory_ledger (
          tenant_id, item_id, warehouse_id, transaction_type,
          quantity, unit_cost, total_cost, reference_type,
          created_by, created_at
        ) VALUES (
          ${tenantId}, ${item.id}, ${wh.id}, 'OPENING',
          ${row.quantity}, ${row.costPerUnit}, ${row.quantity * row.costPerUnit},
          'MIGRATION', 1, NOW()
        )
      `;
      success++;
    } catch (err) {
      errors.push({ row: i + 2, message: (err as Error).message });
    }
  }

  return { success, errors };
}

// ── Opening balance inserter ──────────────────────────────────────────────────

async function insertOpeningBalances(
  sql: ReturnType<typeof buildSql>,
  tenantId: number,
  rows: CanonicalOpeningBalance[],
): Promise<{ success: number; errors: Array<{ row: number; message: string }> }> {
  let success = 0;
  const errors: Array<{ row: number; message: string }> = [];

  // Validate trial balance before inserting
  const totalDebit = rows.reduce((sum, r) => sum + r.debit, 0);
  const totalCredit = rows.reduce((sum, r) => sum + r.credit, 0);
  if (Math.abs(totalDebit - totalCredit) > 0.01) {
    errors.push({
      row: 0,
      message: `Trial balance does not balance! DR=${totalDebit.toFixed(2)} CR=${totalCredit.toFixed(2)} diff=${(totalDebit - totalCredit).toFixed(2)}`,
    });
    return { success: 0, errors };
  }

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    try {
      await sql`
        INSERT INTO financial_entries (
          tenant_id, account_code, account_name, debit, credit,
          narration, entry_date, entry_type, created_by, created_at
        ) VALUES (
          ${tenantId}, ${row.accountCode}, ${row.accountName},
          ${row.debit}, ${row.credit},
          ${row.narration ?? 'Opening Balance'},
          NOW(), 'OPENING_BALANCE', 1, NOW()
        )
      `;
      success++;
    } catch (err) {
      errors.push({ row: i + 2, message: (err as Error).message });
    }
  }

  return { success, errors };
}

// ── Public runner ─────────────────────────────────────────────────────────────

export async function runMigration(opts: {
  entity: MigrationEntity;
  mode: MigrationMode;
  source: string;
  tenantId: number;
  databaseUrl: string;
  rows: unknown[];
}): Promise<MigrationResult> {
  const startMs = Date.now();
  const result: MigrationResult = {
    entity: opts.entity,
    mode: opts.mode,
    source: opts.source as never,
    tenantId: opts.tenantId,
    totalRows: opts.rows.length,
    successRows: 0,
    skippedRows: 0,
    errorRows: 0,
    errors: [],
    durationMs: 0,
  };

  if (opts.mode === 'DRY_RUN') {
    result.durationMs = Date.now() - startMs;
    result.successRows = opts.rows.length;
    return result;
  }

  const sql = buildSql(opts.databaseUrl);

  try {
    let outcome: { success: number; errors: Array<{ row: number; message: string }> };

    switch (opts.entity) {
      case 'customers':
        outcome = await insertCustomers(sql, opts.tenantId, opts.rows as CanonicalCustomer[]);
        break;
      case 'suppliers':
        outcome = await insertSuppliers(sql, opts.tenantId, opts.rows as CanonicalSupplier[]);
        break;
      case 'items':
        outcome = await insertItems(sql, opts.tenantId, opts.rows as CanonicalItem[]);
        break;
      case 'opening-stock':
        outcome = await insertOpeningStock(sql, opts.tenantId, opts.rows as CanonicalOpeningStock[]);
        break;
      case 'opening-balances':
        outcome = await insertOpeningBalances(sql, opts.tenantId, opts.rows as CanonicalOpeningBalance[]);
        break;
      default:
        outcome = { success: 0, errors: [{ row: 0, message: `Entity ${opts.entity} not supported for direct insert` }] };
    }

    result.successRows = outcome.success;
    result.errorRows = outcome.errors.length;
    result.errors = outcome.errors;
  } finally {
    await sql.end();
  }

  result.durationMs = Date.now() - startMs;
  return result;
}

export function printMigrationResult(result: MigrationResult): void {
  const icon = result.errorRows === 0 ? '✅' : result.successRows === 0 ? '❌' : '⚠️';
  console.log(`\n── Migration Result: ${result.entity} [${result.mode}] ${icon} ────`);
  console.log(`  Source      : ${result.source}`);
  console.log(`  Tenant      : ${result.tenantId}`);
  console.log(`  Total rows  : ${result.totalRows}`);
  console.log(`  Success     : ${result.successRows}`);
  console.log(`  Errors      : ${result.errorRows}`);
  console.log(`  Duration    : ${result.durationMs}ms`);

  if (result.errors.length > 0) {
    console.log(`\n  Errors:`);
    result.errors.slice(0, 30).forEach((e) => {
      console.log(`    Row ${e.row}: ${e.message}`);
    });
  }
}
