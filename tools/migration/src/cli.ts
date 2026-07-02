#!/usr/bin/env node
/**
 * ERP Migration CLI
 *
 * Usage:
 *   erp-migrate <entity> --source=<source> --file=<file> --tenant=<id> --mode=<mode>
 *   erp-migrate verify --tenant=<id>
 *   erp-migrate generate-templates --output=./templates
 *
 * Examples:
 *   erp-migrate customers --source=busy --file=customers.csv --tenant=42 --mode=DRY_RUN
 *   erp-migrate customers --source=busy --file=customers.csv --tenant=42 --mode=EXECUTE
 *   erp-migrate items --source=tally --file=stock-items.xml --tenant=42 --mode=DRY_RUN
 *   erp-migrate customers --source=excel --file=customers.xlsx --tenant=42 --mode=DRY_RUN
 *   erp-migrate verify --tenant=42
 *   erp-migrate generate-templates --output=./templates
 */

import process from 'node:process';
import path from 'node:path';
import type { MigrationEntity, MigrationMode, MigrationSource } from './types.js';
import { validateRows, printValidationResult } from './core/validator.js';
import { runMigration, printMigrationResult } from './core/runner.js';
import { runReconciliation, printReconciliationReport } from './core/reconciliation.js';
import { readBusyCsv } from './sources/busy/busy-extractor.js';
import { transformBusyCustomer, transformBusySupplier, transformBusyItem } from './sources/busy/transform-busy.js';
import { validateBusyCustomerExport, validateBusyItemExport, printBusyValidationIssues } from './sources/busy/validate-busy-export.js';
import { parseTallyCustomers, parseTallySuppliers, parseTallyItems } from './sources/tally/tally-xml-parser.js';
import { readExcelFile, generateTemplates } from './sources/excel/excel-to-import.js';

// ── Arg parser (no extra deps) ────────────────────────────────────────────────

function parseArgs(argv: string[]): Record<string, string> {
  const args: Record<string, string> = {};
  for (const arg of argv) {
    if (arg.startsWith('--')) {
      const [key, val] = arg.slice(2).split('=');
      args[key] = val ?? 'true';
    } else if (!arg.startsWith('-')) {
      args['_command'] = arg;
    }
  }
  return args;
}

function requireArg(args: Record<string, string>, key: string): string {
  const val = args[key];
  if (!val) {
    console.error(`❌ Missing required argument: --${key}`);
    process.exit(1);
  }
  return val;
}

// ── Data loader (dispatches to correct source adapter) ────────────────────────

async function loadRows(
  entity: MigrationEntity,
  source: MigrationSource,
  file: string,
): Promise<Record<string, unknown>[]> {
  switch (source) {
    case 'busy': {
      const rawRows = await readBusyCsv(file);

      if (entity === 'customers') {
        // Run Busy-specific validation first
        const busyIssues = validateBusyCustomerExport(rawRows);
        printBusyValidationIssues(busyIssues);
        const errors = busyIssues.filter((i) => i.severity === 'ERROR');
        if (errors.length > 0) {
          console.error(`\n❌ ${errors.length} errors in Busy export. Fix before migrating.`);
          process.exit(1);
        }
        return rawRows.map(transformBusyCustomer) as unknown as Record<string, unknown>[];
      }

      if (entity === 'suppliers') {
        return rawRows.map(transformBusySupplier) as unknown as Record<string, unknown>[];
      }

      if (entity === 'items') {
        const busyIssues = validateBusyItemExport(rawRows);
        printBusyValidationIssues(busyIssues);
        const errors = busyIssues.filter((i) => i.severity === 'ERROR');
        if (errors.length > 0) {
          console.error(`\n❌ ${errors.length} errors in Busy item export. Fix before migrating.`);
          process.exit(1);
        }
        return rawRows.map(transformBusyItem) as unknown as Record<string, unknown>[];
      }

      return rawRows as unknown as Record<string, unknown>[];
    }

    case 'tally': {
      if (entity === 'customers') return parseTallyCustomers(file) as unknown as Record<string, unknown>[];
      if (entity === 'suppliers') return parseTallySuppliers(file) as unknown as Record<string, unknown>[];
      if (entity === 'items') return parseTallyItems(file) as unknown as Record<string, unknown>[];
      throw new Error(`Tally adapter does not support entity: ${entity}`);
    }

    case 'excel': {
      return readExcelFile(file);
    }

    default:
      throw new Error(`Unknown source: ${source}`);
  }
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const argv = process.argv.slice(2);

  if (argv.length === 0 || argv[0] === '--help' || argv[0] === '-h') {
    printHelp();
    return;
  }

  const args = parseArgs(argv);
  const command = args['_command'];
  const databaseUrl = process.env['DATABASE_URL'] ?? '';

  if (!databaseUrl && command !== 'generate-templates') {
    console.error('❌ DATABASE_URL environment variable is required');
    console.error('   Set it: export DATABASE_URL="postgresql://erp:erp_password@localhost:5435/erp"');
    process.exit(1);
  }

  // ── generate-templates ────────────────────────────────────────────────────
  if (command === 'generate-templates') {
    const outputDir = args['output'] ?? './templates';
    console.log(`\n📝 Generating Excel templates → ${path.resolve(outputDir)}`);
    generateTemplates(outputDir);
    console.log('\n✅ Templates generated. Share these with clients to fill their data.');
    return;
  }

  // ── verify ────────────────────────────────────────────────────────────────
  if (command === 'verify') {
    const tenantId = parseInt(requireArg(args, 'tenant'));
    console.log(`\n🔍 Running reconciliation for tenant ${tenantId}...`);

    const report = await runReconciliation({
      tenantId,
      databaseUrl,
      sourceCustomerCount: args['source-customers'] ? parseInt(args['source-customers']) : undefined,
      sourceSupplierCount: args['source-suppliers'] ? parseInt(args['source-suppliers']) : undefined,
      sourceItemCount: args['source-items'] ? parseInt(args['source-items']) : undefined,
      sourceCustomerOutstanding: args['source-customer-outstanding']
        ? parseFloat(args['source-customer-outstanding'])
        : undefined,
      sourceSupplierOutstanding: args['source-supplier-outstanding']
        ? parseFloat(args['source-supplier-outstanding'])
        : undefined,
      sourceStockValue: args['source-stock-value'] ? parseFloat(args['source-stock-value']) : undefined,
    });

    printReconciliationReport(report);
    process.exit(report.overallPass ? 0 : 1);
    return;
  }

  // ── migration command ─────────────────────────────────────────────────────
  const entity = command as MigrationEntity;
  const source = requireArg(args, 'source') as MigrationSource;
  const file = requireArg(args, 'file');
  const tenantId = parseInt(requireArg(args, 'tenant'));
  const mode = (args['mode'] ?? 'DRY_RUN') as MigrationMode;

  console.log(`\n${'═'.repeat(60)}`);
  console.log(`ERP Migration CLI`);
  console.log(`${'═'.repeat(60)}`);
  console.log(`  Entity  : ${entity}`);
  console.log(`  Source  : ${source}`);
  console.log(`  File    : ${file}`);
  console.log(`  Tenant  : ${tenantId}`);
  console.log(`  Mode    : ${mode}`);
  console.log(`${'═'.repeat(60)}\n`);

  // Load and transform rows
  console.log('📂 Loading data...');
  const rows = await loadRows(entity, source, file);
  console.log(`  Loaded ${rows.length} rows from ${source}`);

  // Run schema validation
  console.log('\n🔍 Validating data...');
  const validationResult = validateRows(entity, rows);
  printValidationResult(validationResult);

  if (validationResult.errorRows > 0 && mode !== 'DRY_RUN') {
    console.error(`\n❌ ${validationResult.errorRows} validation errors. Fix before running EXECUTE mode.`);
    process.exit(1);
  }

  if (mode === 'DRY_RUN') {
    console.log(`\n✅ DRY_RUN complete. ${validationResult.validRows}/${validationResult.totalRows} rows would succeed.`);
    console.log('   Run with --mode=EXECUTE to commit to database.');
    return;
  }

  // Execute migration
  console.log(`\n💾 Executing migration (${mode})...`);
  const migrationResult = await runMigration({
    entity,
    mode,
    source,
    tenantId,
    databaseUrl,
    rows: rows.filter((_, i) => {
      // Only pass validated rows
      const errorRows = new Set(validationResult.errors.map((e) => e.row - 2));
      return !errorRows.has(i);
    }),
  });

  printMigrationResult(migrationResult);

  if (migrationResult.errorRows > 0) {
    process.exit(1);
  }

  console.log(`\n✅ Migration complete! Run: erp-migrate verify --tenant=${tenantId}`);
}

function printHelp(): void {
  console.log(`
ERP Migration CLI v1.0.0

COMMANDS:
  erp-migrate <entity> --source=<source> --file=<file> --tenant=<id> --mode=<mode>
  erp-migrate verify --tenant=<id> [reconciliation options]
  erp-migrate generate-templates --output=<dir>

ENTITIES:
  customers, suppliers, items, opening-stock, opening-balances

SOURCES:
  busy    Busy Accounting (CSV export)
  tally   Tally ERP (XML export)
  excel   Excel template (see generate-templates)

MODES:
  DRY_RUN   Validate and report without writing to DB (default)
  EXECUTE   Write to DB with transaction (rollback on error)
  VERIFY    Count and value reconciliation report

MIGRATION ORDER (follow this sequence):
  1. Customers      erp-migrate customers --source=busy --file=customers.csv --tenant=1 --mode=DRY_RUN
  2. Suppliers      erp-migrate suppliers --source=busy --file=suppliers.csv --tenant=1 --mode=DRY_RUN
  3. Items          erp-migrate items --source=busy --file=items.csv --tenant=1 --mode=DRY_RUN
  4. Opening Stock  erp-migrate opening-stock --source=excel --file=stock.xlsx --tenant=1 --mode=DRY_RUN
  5. Balances       erp-migrate opening-balances --source=excel --file=balances.xlsx --tenant=1 --mode=DRY_RUN
  (Run --mode=EXECUTE after each DRY_RUN passes)
  6. Verify         erp-migrate verify --tenant=1 --source-customers=500 --source-suppliers=50

ENVIRONMENT:
  DATABASE_URL  Required (e.g. postgresql://erp:erp_password@localhost:5435/erp)
`);
}

main().catch((err) => {
  console.error('❌ Fatal error:', (err as Error).message);
  process.exit(1);
});
