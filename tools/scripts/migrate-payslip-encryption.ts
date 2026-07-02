/* global process */
/**
 * Payslip Encryption Data Migration Script (ES-06)
 *
 * Usage:
 *   DRY-RUN: ts-node tools/scripts/migrate-payslip-encryption.ts
 *   EXECUTE: ts-node tools/scripts/migrate-payslip-encryption.ts --execute
 *
 * IMPORTANT: Apply the schema migration (0010_es06_hr_encryption_holidays.sql)
 * BEFORE running this script in execute mode.
 * Take a full database backup before running in execute mode.
 */

import postgres from 'postgres';
import { encryptField, decryptField } from '../../packages/shared-utils/src/encryption.js';

const dryRun = !process.argv.includes('--execute');

const DATABASE_URL = process.env['DATABASE_URL'];
const FIELD_ENCRYPTION_KEY = process.env['FIELD_ENCRYPTION_KEY'];

if (!DATABASE_URL) {
  process.stderr.write('DATABASE_URL env var is required\n');
  process.exit(1);
}
if (!FIELD_ENCRYPTION_KEY) {
  process.stderr.write('FIELD_ENCRYPTION_KEY env var is required\n');
  process.exit(1);
}

const sql = postgres(DATABASE_URL, { max: 1 });

interface PayrollSlipRow {
  id: number;
  gross_salary: string;
  net_salary: string;
}

async function main(): Promise<void> {
  process.stdout.write(`Payslip encryption migration — mode: ${dryRun ? 'DRY-RUN' : 'EXECUTE'}\n`);

  const rows = await sql<PayrollSlipRow[]>`
    SELECT id, gross_salary, net_salary FROM payroll_slips
  `;

  process.stdout.write(`Found ${rows.length} payroll slip rows.\n`);

  let skipped = 0;
  let migrated = 0;
  let errors = 0;

  for (const row of rows) {
    const isAlreadyEncrypted = row.gross_salary.includes(':');
    if (isAlreadyEncrypted) {
      skipped++;
      continue;
    }

    const grossStr = row.gross_salary;
    const netStr = row.net_salary;

    const encryptedGross = encryptField(grossStr, FIELD_ENCRYPTION_KEY);
    const encryptedNet = encryptField(netStr, FIELD_ENCRYPTION_KEY);

    // Verify round-trip before writing
    const verifyGross = decryptField(encryptedGross, FIELD_ENCRYPTION_KEY);
    const verifyNet = decryptField(encryptedNet, FIELD_ENCRYPTION_KEY);

    if (verifyGross !== grossStr || verifyNet !== netStr) {
      process.stderr.write(`[ERROR] Verification failed for slip id=${row.id}\n`);
      errors++;
      continue;
    }

    if (dryRun) {
      process.stdout.write(`[DRY-RUN] slip id=${row.id}: gross=${grossStr} → ${encryptedGross.slice(0, 20)}... net=${netStr} → ${encryptedNet.slice(0, 20)}...\n`);
    } else {
      await sql`
        UPDATE payroll_slips
        SET gross_salary = ${encryptedGross}, net_salary = ${encryptedNet}
        WHERE id = ${row.id}
      `;
      process.stdout.write(`[MIGRATED] slip id=${row.id}\n`);
    }
    migrated++;
  }

  process.stdout.write(`\nSummary: ${migrated} migrated, ${skipped} already encrypted, ${errors} errors.\n`);
  if (dryRun) {
    process.stdout.write('Run with --execute to apply changes.\n');
  }

  await sql.end();
}

main().catch((err: unknown) => {
  const msg = err instanceof Error ? err.message : String(err);
  process.stderr.write(`Fatal: ${msg}\n`);
  process.exit(1);
});
