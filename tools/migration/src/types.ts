/**
 * Canonical import format — all source adapters transform to these shapes.
 * These match the ERP database schema (packages/db-client).
 */

export type MigrationMode = 'DRY_RUN' | 'EXECUTE' | 'VERIFY';
export type MigrationSource = 'busy' | 'tally' | 'excel';
export type MigrationEntity =
  | 'customers'
  | 'suppliers'
  | 'items'
  | 'opening-stock'
  | 'opening-balances'
  | 'historical-transactions'
  | 'verify';

// ── Canonical Customer ───────────────────────────────────────────────────────

export interface CanonicalCustomer {
  displayName: string;
  companyName?: string;
  gstin?: string;
  pan?: string;
  phone?: string;
  email?: string;
  address?: string;
  city?: string;
  state?: string;
  pincode?: string;
  creditLimit?: number;
  openingBalance?: number; // positive = receivable (customer owes us)
}

// ── Canonical Supplier ────────────────────────────────────────────────────────

export interface CanonicalSupplier {
  displayName: string;
  companyName?: string;
  gstin?: string;
  pan?: string;
  phone?: string;
  email?: string;
  address?: string;
  city?: string;
  state?: string;
  pincode?: string;
  openingBalance?: number; // positive = payable (we owe supplier)
}

// ── Canonical Item ────────────────────────────────────────────────────────────

export interface CanonicalItem {
  name: string;
  sku?: string;
  hsnCode: string;
  gstRate: number; // 0, 5, 12, 18, 28
  unit: string; // 'Metres', 'Pieces', 'Kg'
  category?: string;
  brand?: string;
  sellingPrice: number;
  costPrice?: number;
  minSalePrice?: number;
}

// ── Canonical Opening Stock ───────────────────────────────────────────────────

export interface CanonicalOpeningStock {
  itemSku: string;
  warehouseName: string;
  quantity: number;
  costPerUnit: number;
}

// ── Canonical Opening Balance ─────────────────────────────────────────────────

export interface CanonicalOpeningBalance {
  accountCode: string;
  accountName: string;
  debit: number;
  credit: number;
  narration?: string;
}

// ── Validation Result ─────────────────────────────────────────────────────────

export interface ValidationError {
  row: number;
  field: string;
  value: unknown;
  message: string;
}

export interface ValidationResult {
  entity: MigrationEntity;
  totalRows: number;
  validRows: number;
  errorRows: number;
  errors: ValidationError[];
}

// ── Migration Result ──────────────────────────────────────────────────────────

export interface MigrationResult {
  entity: MigrationEntity;
  mode: MigrationMode;
  source: MigrationSource;
  tenantId: number;
  totalRows: number;
  successRows: number;
  skippedRows: number;
  errorRows: number;
  errors: Array<{ row: number; message: string }>;
  durationMs: number;
}

// ── Reconciliation Report ─────────────────────────────────────────────────────

export interface ReconciliationReport {
  tenantId: number;
  generatedAt: string;
  checks: Array<{
    name: string;
    sourceValue: number | string;
    erpValue: number | string;
    tolerance: number;
    passed: boolean;
    difference?: number;
  }>;
  overallPass: boolean;
}

// ── CLI Options ───────────────────────────────────────────────────────────────

export interface CliOptions {
  entity: MigrationEntity;
  source: MigrationSource;
  file?: string;
  tenantId: number;
  mode: MigrationMode;
  databaseUrl: string;
}
