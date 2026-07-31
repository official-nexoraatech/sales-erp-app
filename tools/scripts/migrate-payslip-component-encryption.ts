/* global process */
/**
 * Payslip Component Encryption Data Migration Script (2026-07-20 HR audit, G5)
 *
 * Usage:
 *   DRY-RUN: ts-node tools/scripts/migrate-payslip-component-encryption.ts
 *   EXECUTE: ts-node tools/scripts/migrate-payslip-component-encryption.ts --execute
 *
 * IMPORTANT: Apply the schema migration (0085_hr_payslip_component_encryption.sql)
 * BEFORE running this script in execute mode.
 * Take a full database backup before running in execute mode.
 *
 * Encrypts the 13 payroll_slips columns that were left plaintext when ES-06 encrypted
 * only grossSalary/netSalary (same pattern as tools/scripts/migrate-payslip-encryption.ts).
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

const COLUMNS = [
  'basic_salary',
  'hra_amount',
  'da_amount',
  'other_allowances',
  'piece_rate_amount',
  'pf_employee',
  'pf_employer',
  'eps_amount',
  'esi_employee',
  'esi_employer',
  'professional_tax',
  'loan_deduction',
  'tds_deduction',
  'total_deductions',
] as const;

type ColumnName = (typeof COLUMNS)[number];
type PayrollSlipRow = { id: number } & Record<ColumnName, string>;

async function main(): Promise<void> {
  process.stdout.write(
    `Payslip component encryption migration — mode: ${dryRun ? 'DRY-RUN' : 'EXECUTE'}\n`
  );

  const rows = await sql<PayrollSlipRow[]>`
    SELECT id, ${sql(COLUMNS)} FROM payroll_slips
  `;

  process.stdout.write(`Found ${rows.length} payroll slip rows.\n`);

  let skipped = 0;
  let migrated = 0;
  let errors = 0;

  for (const row of rows) {
    // A row is already migrated if every column looks like ciphertext (contains ':') —
    // partial states shouldn't occur since this script updates all columns for a row in one
    // UPDATE, but check defensively rather than assume.
    const alreadyEncrypted = COLUMNS.every((col) => row[col].includes(':'));
    if (alreadyEncrypted) {
      skipped++;
      continue;
    }

    const encrypted: Record<ColumnName, string> = {} as Record<ColumnName, string>;
    let verifyFailed = false;
    for (const col of COLUMNS) {
      const plain = row[col];
      const ciphertext = encryptField(plain, FIELD_ENCRYPTION_KEY);
      const verify = decryptField(ciphertext, FIELD_ENCRYPTION_KEY);
      if (verify !== plain) {
        process.stderr.write(`[ERROR] Verification failed for slip id=${row.id}, column=${col}\n`);
        verifyFailed = true;
        break;
      }
      encrypted[col] = ciphertext;
    }
    if (verifyFailed) {
      errors++;
      continue;
    }

    if (dryRun) {
      process.stdout.write(
        `[DRY-RUN] slip id=${row.id}: would encrypt ${COLUMNS.length} columns\n`
      );
    } else {
      await sql`
        UPDATE payroll_slips
        SET ${sql(encrypted, ...COLUMNS)}
        WHERE id = ${row.id}
      `;
      process.stdout.write(`[MIGRATED] slip id=${row.id}\n`);
    }
    migrated++;
  }

  process.stdout.write(
    `\nSummary: ${migrated} migrated, ${skipped} already encrypted, ${errors} errors.\n`
  );
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
