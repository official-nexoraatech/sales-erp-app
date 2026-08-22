import { sql } from 'drizzle-orm';
import type { ErpDatabase, ReplicaRouter } from '@erp/db';
import type Redis from 'ioredis';
import {
  TenantScopedCache,
  TenantScopedDatabase,
  ReportsEngine,
  withTenantConnection,
} from '@erp/sdk';
import { decryptField } from '@erp/utils/server';
import { requireEnv } from '@erp/config';

// payroll_slips' component/gross/net columns are AES-256-GCM ciphertext (2026-07-20 HR audit,
// G5) — raw SQL can't decrypt them, so HR reports that touch salary figures fetch ciphertext
// and decrypt here before returning rows. Never throws on a plain/legacy value: decryptField
// itself requires the iv:authTag:ciphertext format, so this only ever runs against real
// ciphertext produced by encryptField.
function decryptAmount(ciphertext: string | null | undefined): number {
  if (!ciphertext) return 0;
  const encKey = requireEnv('FIELD_ENCRYPTION_KEY');
  return parseFloat(decryptField(ciphertext, encKey)) || 0;
}

export interface ReportParams {
  fromDate?: string;
  toDate?: string;
  date?: string;
  asOfDate?: string;
  branchId?: string | number;
  warehouseId?: string | number;
  categoryId?: string | number;
  supplierId?: string | number;
  customerId?: string | number;
  itemId?: string | number;
  employeeId?: string | number;
  accountId?: string | number;
  bankAccountId?: string | number;
  status?: string;
  mode?: string;
  type?: string;
  limit?: string | number;
  sortBy?: string;
  maxSalesQty?: string | number;
  daysSinceMovement?: string | number;
  month?: string;
  financialYear?: string;
  [key: string]: string | number | undefined;
}

export interface ReportRow {
  [key: string]: string | number | null | undefined;
}

export interface ReportResult {
  rows: ReportRow[];
  totalRows: number;
  generatedAt: string;
  params: ReportParams;
}

type DbClient = ErpDatabase;

function p(val: string | number | undefined, fallback: string | number = 0): string | number {
  return val ?? fallback;
}

// PostgreSQL returns snake_case column names; registry uses camelCase keys.
function snakeToCamel(s: string): string {
  return s.replace(/_([a-z0-9])/g, (_, c: string) => c.toUpperCase());
}

// Trailing 12-month window start date, used when a trend report gets no explicit fromDate.
function defaultTrendFromDate(): string {
  const d = new Date();
  d.setUTCMonth(d.getUTCMonth() - 11);
  d.setUTCDate(1);
  return d.toISOString().slice(0, 10);
}

// GST-payable is queried on every GST filing/dashboard view but changes only when new
// invoices/GRNs post — a short cache absorbs repeat views without serving stale data for long.
const GST_PAYABLE_CACHE_TTL_SECONDS = 180;

export class ReportEngine {
  constructor(
    private readonly db: DbClient,
    private readonly redis?: Redis,
    // PG-005: report definitions are pure SELECT — route through the read replica
    // (with lag-aware fallback to this.db) when the caller supplies a router.
    private readonly replicaRouter?: ReplicaRouter
  ) {}

  // Phase 9 GUC-per-request rollout — migrated 2026-08-21. New pattern (mirrors
  // dashboard.routes.ts in this same service): replicaRouter.forRead() must resolve which
  // physical connection to use FIRST, then that resolved connection gets wrapped in
  // withTenantConnection — createReadReplicaClient() returns a full ErpDatabase, so
  // `.transaction()` + `SET LOCAL`/`set_config()` work identically against the replica (a hot
  // standby rejects DML, not read-only session operations). runQuery() now takes the scoped db
  // as a parameter instead of resolving replicaRouter.forRead() internally.
  async generate(slug: string, tenantId: number, params: ReportParams): Promise<ReportResult> {
    const readDb = this.replicaRouter ? await this.replicaRouter.forRead() : this.db;
    const rawRows = await withTenantConnection(readDb, tenantId, (scopedDb) =>
      this.runQuery(slug, tenantId, params, scopedDb)
    );
    const rows = rawRows.map((row) => {
      const out: ReportRow = {};
      for (const [k, v] of Object.entries(row)) {
        out[snakeToCamel(k)] = v as string | number | null | undefined;
      }
      return out;
    });
    return {
      rows,
      totalRows: rows.length,
      generatedAt: new Date().toISOString(),
      params,
    };
  }

  private async runQuery(
    slug: string,
    tenantId: number,
    params: ReportParams,
    db: DbClient
  ): Promise<ReportRow[]> {
    const tid = tenantId;
    const from = params.fromDate ?? params.date ?? params.asOfDate ?? '2000-01-01';
    const to = params.toDate ?? params.date ?? params.asOfDate ?? '2099-12-31';

    switch (slug) {
      // â”€â”€ SALES REPORTS â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
      case 'sales-register': {
        // ✓ tenant_id filtered — ES-05 audit
        const res = await db.execute(sql`
          SELECT
            i.invoice_number,
            i.invoice_date::date AS invoice_date,
            COALESCE(c.display_name, 'Walk-in') AS customer_name,
            i.subtotal,
            i.cgst_amount AS cgst,
            i.sgst_amount AS sgst,
            i.igst_amount AS igst,
            i.grand_total,
            COALESCE(i.paid_amount, 0) AS paid_amount,
            i.grand_total - COALESCE(i.paid_amount, 0) AS balance_due,
            i.status
          FROM invoices i
          LEFT JOIN customers c ON c.id = i.customer_id AND c.tenant_id = ${tid}
          WHERE i.tenant_id = ${tid}
            AND i.invoice_date BETWEEN ${from}::date AND ${to}::date
            AND (${params.branchId ?? null}::int IS NULL OR i.branch_id = ${params.branchId ?? null}::int)
            AND (${params.status ?? null}::text IS NULL OR i.status = ${params.status ?? null}::text)
            AND i.status != 'DRAFT'
          ORDER BY i.invoice_date DESC, i.id DESC
        `);
        return res as unknown as ReportRow[];
      }

      case 'sales-by-customer': {
        // ✓ tenant_id filtered — ES-05 audit
        const res = await db.execute(sql`
          SELECT
            COALESCE(c.display_name, 'Walk-in') AS customer_name,
            c.phone,
            COUNT(i.id)::int AS invoice_count,
            SUM(i.grand_total) AS total_sales,
            SUM(COALESCE(i.paid_amount, 0)) AS total_paid,
            SUM(i.grand_total - COALESCE(i.paid_amount, 0)) AS outstanding
          FROM invoices i
          LEFT JOIN customers c ON c.id = i.customer_id AND c.tenant_id = ${tid}
          WHERE i.tenant_id = ${tid}
            AND i.invoice_date BETWEEN ${from}::date AND ${to}::date
            AND i.status NOT IN ('CANCELLED', 'DRAFT')
            AND (${params.branchId ?? null}::int IS NULL OR i.branch_id = ${params.branchId ?? null}::int)
          GROUP BY c.id, c.display_name, c.phone
          ORDER BY total_sales DESC
        `);
        return res as unknown as ReportRow[];
      }

      case 'sales-by-item': {
        // FIXED: units has no `symbol` column (real: abbreviation); invoice_lines has no
        // cost_price column at all — COGS is derived from items.wacc_cost (tenant-wide WACC),
        // matching the same fallback used by stock-summary/dashboard.routes.ts elsewhere.
        const res = await db.execute(sql`
          SELECT
            it.item_code,
            it.name AS item_name,
            cat.name AS category,
            SUM(il.quantity) AS quantity_sold,
            u.abbreviation AS unit,
            SUM(il.line_total) AS revenue,
            SUM(il.quantity * COALESCE(it.wacc_cost, 0)) AS cogs,
            SUM(il.line_total) - SUM(il.quantity * COALESCE(it.wacc_cost, 0)) AS gross_profit,
            CASE WHEN SUM(il.line_total) > 0 THEN
              ROUND(((SUM(il.line_total) - SUM(il.quantity * COALESCE(it.wacc_cost, 0))) / SUM(il.line_total) * 100)::numeric, 2)
            ELSE 0 END AS gross_margin
          FROM invoice_lines il
          JOIN invoices i ON i.id = il.invoice_id AND i.tenant_id = ${tid}
          JOIN items it ON it.id = il.item_id AND it.tenant_id = ${tid}
          LEFT JOIN categories cat ON cat.id = it.category_id
          LEFT JOIN units u ON u.id = it.unit_id
          WHERE i.tenant_id = ${tid}
            AND i.invoice_date BETWEEN ${from}::date AND ${to}::date
            AND i.status NOT IN ('CANCELLED', 'DRAFT')
            AND (${params.categoryId ?? null}::int IS NULL OR it.category_id = ${params.categoryId ?? null}::int)
            AND (${params.branchId ?? null}::int IS NULL OR i.branch_id = ${params.branchId ?? null}::int)
          GROUP BY it.id, it.item_code, it.name, cat.name, u.abbreviation
          ORDER BY revenue DESC
        `);
        return res as unknown as ReportRow[];
      }

      case 'sales-by-category': {
        // ✓ tenant_id filtered — ES-05 audit
        const res = await db.execute(sql`
          WITH totals AS (
            SELECT SUM(il.line_total) AS grand_total
            FROM invoice_lines il
            JOIN invoices i ON i.id = il.invoice_id
            WHERE i.tenant_id = ${tid}
              AND i.invoice_date BETWEEN ${from}::date AND ${to}::date
              AND i.status NOT IN ('CANCELLED', 'DRAFT')
          )
          SELECT
            COALESCE(cat.name, 'Uncategorized') AS category,
            COUNT(DISTINCT i.id)::int AS invoice_count,
            SUM(il.quantity) AS quantity_sold,
            SUM(il.line_total) AS revenue,
            ROUND((SUM(il.line_total) / NULLIF((SELECT grand_total FROM totals), 0) * 100)::numeric, 2) AS revenue_share
          FROM invoice_lines il
          JOIN invoices i ON i.id = il.invoice_id AND i.tenant_id = ${tid}
          JOIN items it ON it.id = il.item_id
          LEFT JOIN categories cat ON cat.id = it.category_id
          WHERE i.tenant_id = ${tid}
            AND i.invoice_date BETWEEN ${from}::date AND ${to}::date
            AND i.status NOT IN ('CANCELLED', 'DRAFT')
          GROUP BY cat.id, cat.name
          ORDER BY revenue DESC
        `);
        return res as unknown as ReportRow[];
      }

      case 'sales-by-salesperson': {
        // ✓ tenant_id filtered — ES-05 audit
        const res = await db.execute(sql`
          SELECT
            CONCAT(u.first_name, ' ', u.last_name) AS salesperson,
            COUNT(i.id)::int AS invoice_count,
            SUM(i.grand_total) AS revenue,
            ROUND(AVG(i.grand_total)::numeric, 2) AS avg_invoice_value
          FROM invoices i
          JOIN users u ON u.id = i.created_by AND u.tenant_id = ${tid}
          WHERE i.tenant_id = ${tid}
            AND i.invoice_date BETWEEN ${from}::date AND ${to}::date
            AND i.status NOT IN ('CANCELLED', 'DRAFT')
          GROUP BY u.id, u.first_name, u.last_name
          ORDER BY revenue DESC
        `);
        return res as unknown as ReportRow[];
      }

      case 'outstanding-receivables': {
        const asOf = params.asOfDate ?? new Date().toISOString().slice(0, 10);
        // ✓ tenant_id filtered — ES-05 audit
        const res = await db.execute(sql`
          SELECT
            COALESCE(c.display_name, 'Walk-in') AS customer_name,
            i.invoice_number,
            i.invoice_date::date AS invoice_date,
            i.due_date::date AS due_date,
            i.grand_total,
            COALESCE(i.paid_amount, 0) AS paid_amount,
            i.grand_total - COALESCE(i.paid_amount, 0) AS balance_due,
            CASE
              WHEN (${asOf}::date - i.due_date::date) <= 0 THEN 'Current'
              WHEN (${asOf}::date - i.due_date::date) <= 30 THEN '1-30 days'
              WHEN (${asOf}::date - i.due_date::date) <= 60 THEN '31-60 days'
              WHEN (${asOf}::date - i.due_date::date) <= 90 THEN '61-90 days'
              ELSE '90+ days'
            END AS days_bucket
          FROM invoices i
          LEFT JOIN customers c ON c.id = i.customer_id AND c.tenant_id = ${tid}
          WHERE i.tenant_id = ${tid}
            AND i.invoice_date <= ${asOf}::date
            AND (i.grand_total - COALESCE(i.paid_amount, 0)) > 0
            AND i.status NOT IN ('CANCELLED', 'PAID', 'DRAFT')
            AND (${params.customerId ?? null}::int IS NULL OR i.customer_id = ${params.customerId ?? null}::int)
          ORDER BY days_bucket DESC, balance_due DESC
        `);
        return res as unknown as ReportRow[];
      }

      case 'customer-ledger': {
        // FIXED: payments has no receipt_number (real: payment_number); credit_notes has no
        // issued_date column at all (real: created_at).
        const res = await db.execute(sql`
          SELECT date, type, reference, debit, credit,
            SUM(debit - credit) OVER (ORDER BY date, id) AS balance
          FROM (
            SELECT i.invoice_date AS date, 'Invoice' AS type, i.invoice_number AS reference,
              i.grand_total AS debit, 0 AS credit, i.id
            FROM invoices i
            WHERE i.tenant_id = ${tid} AND i.customer_id = ${params.customerId ?? 0}::int
              AND i.invoice_date BETWEEN ${from}::date AND ${to}::date AND i.status NOT IN ('CANCELLED', 'DRAFT')
            UNION ALL
            SELECT p.payment_date AS date, 'Payment' AS type, p.payment_number AS reference,
              0 AS debit, p.amount AS credit, p.id
            FROM payments p
            WHERE p.tenant_id = ${tid} AND p.customer_id = ${params.customerId ?? 0}::int
              AND p.payment_date BETWEEN ${from}::date AND ${to}::date
            UNION ALL
            SELECT cn.created_at::date AS date, 'Credit Note' AS type, cn.credit_note_number AS reference,
              0 AS debit, cn.amount AS credit, cn.id
            FROM credit_notes cn
            WHERE cn.tenant_id = ${tid} AND cn.customer_id = ${params.customerId ?? 0}::int
              AND cn.created_at::date BETWEEN ${from}::date AND ${to}::date
          ) sub
          ORDER BY date, id
        `);
        return res as unknown as ReportRow[];
      }

      case 'payment-collection-report': {
        // FIXED: payments has no receipt_number/reference_number columns (real:
        // payment_number/transaction_reference) — aliased back to the registry's expected keys.
        const res = await db.execute(sql`
          SELECT
            p.payment_date::date AS payment_date,
            p.payment_number AS receipt_number,
            COALESCE(c.display_name, 'Walk-in') AS customer_name,
            p.payment_mode AS mode,
            p.amount,
            p.transaction_reference AS reference
          FROM payments p
          LEFT JOIN customers c ON c.id = p.customer_id AND c.tenant_id = ${tid}
          WHERE p.tenant_id = ${tid}
            AND p.payment_date BETWEEN ${from}::date AND ${to}::date
            AND (${params.mode ?? null}::text IS NULL OR p.payment_mode = ${params.mode ?? null}::text)
          ORDER BY p.payment_date DESC
        `);
        return res as unknown as ReportRow[];
      }

      case 'credit-note-report': {
        // FIXED: credit_notes has no issued_date column (real: created_at) and no reason
        // column of its own — reason is derived from the linked sale_return when the credit
        // note originated from a return, falling back to the freeform notes field otherwise.
        const res = await db.execute(sql`
          SELECT
            cn.credit_note_number,
            cn.created_at::date AS date,
            COALESCE(c.display_name, 'Walk-in') AS customer_name,
            COALESCE(sr.reason, cn.notes) AS reason,
            cn.amount,
            cn.status
          FROM credit_notes cn
          LEFT JOIN customers c ON c.id = cn.customer_id AND c.tenant_id = ${tid}
          LEFT JOIN sale_returns sr ON sr.id = cn.sale_return_id AND sr.tenant_id = ${tid}
          WHERE cn.tenant_id = ${tid}
            AND cn.created_at::date BETWEEN ${from}::date AND ${to}::date
          ORDER BY cn.created_at DESC
        `);
        return res as unknown as ReportRow[];
      }

      case 'sales-return-report': {
        // FIXED: sale_returns has no total_return_amount column (real: total_amount).
        const res = await db.execute(sql`
          SELECT
            sr.return_number,
            sr.return_date::date AS date,
            i.invoice_number AS original_invoice,
            COALESCE(c.display_name, 'Walk-in') AS customer_name,
            sr.total_amount AS return_amount,
            sr.reason
          FROM sale_returns sr
          LEFT JOIN invoices i ON i.id = sr.invoice_id
          LEFT JOIN customers c ON c.id = sr.customer_id AND c.tenant_id = ${tid}
          WHERE sr.tenant_id = ${tid}
            AND sr.return_date BETWEEN ${from}::date AND ${to}::date
          ORDER BY sr.return_date DESC
        `);
        return res as unknown as ReportRow[];
      }

      case 'delivery-challan-report': {
        // FIXED: delivery_challans has no total_quantity/total_value columns of its own —
        // quantity is summed from delivery_challan_lines, value comes from the header's
        // existing subtotal field.
        const res = await db.execute(sql`
          SELECT
            dc.challan_number,
            dc.challan_date::date AS date,
            COALESCE(c.display_name, 'Walk-in') AS customer_name,
            COALESCE(SUM(dcl.quantity), 0) AS total_qty,
            dc.subtotal AS total_value,
            dc.status,
            i.invoice_number AS converted_invoice
          FROM delivery_challans dc
          LEFT JOIN customers c ON c.id = dc.customer_id AND c.tenant_id = ${tid}
          LEFT JOIN invoices i ON i.id = dc.converted_invoice_id
          LEFT JOIN delivery_challan_lines dcl ON dcl.challan_id = dc.id AND dcl.tenant_id = ${tid}
          WHERE dc.tenant_id = ${tid}
            AND dc.challan_date BETWEEN ${from}::date AND ${to}::date
          GROUP BY dc.id, dc.challan_number, dc.challan_date, c.display_name, dc.subtotal, dc.status, i.invoice_number
          ORDER BY dc.challan_date DESC
        `);
        return res as unknown as ReportRow[];
      }

      case 'quotation-conversion-report': {
        // ✓ tenant_id filtered — ES-05 audit
        const res = await db.execute(sql`
          SELECT
            q.quotation_number,
            q.created_at::date AS date,
            COALESCE(c.display_name, 'Walk-in') AS customer_name,
            q.grand_total AS total_value,
            q.status,
            i.invoice_number AS converted_invoice,
            q.converted_at::date AS converted_date
          FROM quotations q
          LEFT JOIN customers c ON c.id = q.customer_id AND c.tenant_id = ${tid}
          LEFT JOIN invoices i ON i.id = q.converted_invoice_id AND i.tenant_id = ${tid}
          WHERE q.tenant_id = ${tid}
            AND q.created_at::date BETWEEN ${from}::date AND ${to}::date
          ORDER BY q.created_at DESC
        `);
        return res as unknown as ReportRow[];
      }

      case 'pos-summary-report': {
        // FIXED: payments has no invoice_id column — the only link to an invoice is via
        // payment_allocations (paymentId -> invoiceId). Restructured as invoice-level and
        // mode-level pre-aggregations joined on (date, cashier) so an invoice with multiple
        // payment allocations (e.g. split cash+UPI) is never double-counted in total_sales —
        // the previous query's SUM(DISTINCT i.grand_total) attempted the same thing but dedupes
        // by *value*, silently undercounting whenever two different invoices share an amount.
        const res = await db.execute(sql`
          WITH pos_invoices AS (
            SELECT DISTINCT i.id, i.invoice_date, i.created_by, i.grand_total
            FROM invoices i
            WHERE i.tenant_id = ${tid}
              AND i.invoice_date BETWEEN ${from}::date AND ${to}::date
              AND i.status != 'CANCELLED'
              AND (${params.branchId ?? null}::int IS NULL OR i.branch_id = ${params.branchId ?? null}::int)
              AND EXISTS (
                SELECT 1 FROM payment_allocations pa
                JOIN payments p ON p.id = pa.payment_id AND p.tenant_id = ${tid}
                WHERE pa.invoice_id = i.id AND p.pos_session_id IS NOT NULL
              )
          ),
          invoice_totals AS (
            SELECT pi.invoice_date::date AS date, pi.created_by,
              COUNT(*)::int AS total_transactions,
              SUM(pi.grand_total) AS total_sales
            FROM pos_invoices pi
            GROUP BY pi.invoice_date::date, pi.created_by
          ),
          mode_totals AS (
            SELECT pi.invoice_date::date AS date, pi.created_by, p.payment_mode,
              SUM(pa.amount) AS amount
            FROM pos_invoices pi
            JOIN payment_allocations pa ON pa.invoice_id = pi.id
            JOIN payments p ON p.id = pa.payment_id AND p.tenant_id = ${tid} AND p.pos_session_id IS NOT NULL
            GROUP BY pi.invoice_date::date, pi.created_by, p.payment_mode
          )
          SELECT
            it.date,
            CONCAT(u.first_name, ' ', u.last_name) AS cashier,
            it.total_transactions,
            COALESCE(SUM(CASE WHEN mt.payment_mode = 'CASH' THEN mt.amount ELSE 0 END), 0) AS cash_sales,
            COALESCE(SUM(CASE WHEN mt.payment_mode = 'CARD' THEN mt.amount ELSE 0 END), 0) AS card_sales,
            COALESCE(SUM(CASE WHEN mt.payment_mode = 'UPI' THEN mt.amount ELSE 0 END), 0) AS upi_sales,
            it.total_sales
          FROM invoice_totals it
          JOIN users u ON u.id = it.created_by AND u.tenant_id = ${tid}
          LEFT JOIN mode_totals mt ON mt.date = it.date AND mt.created_by = it.created_by
          GROUP BY it.date, it.created_by, u.first_name, u.last_name, it.total_transactions, it.total_sales
          ORDER BY it.date DESC
        `);
        return res as unknown as ReportRow[];
      }

      case 'top-selling-items': {
        const lim = Number(p(params.limit, 20));
        const sortCol = params.sortBy === 'quantity' ? 'quantity_sold' : 'revenue';
        // ✓ tenant_id filtered — ES-05 audit
        const res = await db.execute(sql`
          SELECT
            ROW_NUMBER() OVER (ORDER BY SUM(il.line_total) DESC) AS rank,
            it.name AS item_name,
            cat.name AS category,
            SUM(il.quantity) AS quantity_sold,
            SUM(il.line_total) AS revenue
          FROM invoice_lines il
          JOIN invoices i ON i.id = il.invoice_id AND i.tenant_id = ${tid}
          JOIN items it ON it.id = il.item_id
          LEFT JOIN categories cat ON cat.id = it.category_id
          WHERE i.tenant_id = ${tid}
            AND i.invoice_date BETWEEN ${from}::date AND ${to}::date
            AND i.status NOT IN ('CANCELLED', 'DRAFT')
          GROUP BY it.id, it.name, cat.name
          ORDER BY ${sortCol === 'revenue' ? sql`revenue` : sql`quantity_sold`} DESC
          LIMIT ${lim}
        `);
        return res as unknown as ReportRow[];
      }

      case 'slow-moving-items': {
        const maxQty = Number(p(params.maxSalesQty, 5));
        // FIXED: projection_stock_level has no quantity_on_hand column (real: available_qty).
        // ✓ tenant_id filtered — ES-05 audit
        const res = await db.execute(sql`
          SELECT
            it.item_code,
            it.name AS item_name,
            cat.name AS category,
            COALESCE(sl.available_qty, 0) AS current_stock,
            COALESCE(sales.qty_sold, 0) AS quantity_sold,
            sales.last_sale_date
          FROM items it
          LEFT JOIN categories cat ON cat.id = it.category_id
          LEFT JOIN (
            SELECT item_id, SUM(available_qty) AS available_qty
            FROM projection_stock_level WHERE tenant_id = ${tid} GROUP BY item_id
          ) sl ON sl.item_id = it.id
          LEFT JOIN (
            SELECT il.item_id, SUM(il.quantity) AS qty_sold, MAX(i.invoice_date)::date AS last_sale_date
            FROM invoice_lines il
            JOIN invoices i ON i.id = il.invoice_id AND i.tenant_id = ${tid}
            WHERE i.invoice_date BETWEEN ${from}::date AND ${to}::date AND i.status != 'CANCELLED'
            GROUP BY il.item_id
          ) sales ON sales.item_id = it.id
          WHERE it.tenant_id = ${tid}
            AND COALESCE(sales.qty_sold, 0) <= ${maxQty}
            AND COALESCE(sl.available_qty, 0) > 0
          ORDER BY quantity_sold ASC, current_stock DESC
        `);
        return res as unknown as ReportRow[];
      }

      case 'customer-statement': {
        // FIXED: payments has no receipt_number column (real: payment_number).
        const res = await db.execute(sql`
          SELECT date, description, debit, credit,
            SUM(debit - credit) OVER (ORDER BY date, id) AS balance
          FROM (
            SELECT i.invoice_date AS date, CONCAT('Invoice - ', i.invoice_number) AS description,
              i.grand_total AS debit, 0 AS credit, i.id
            FROM invoices i
            WHERE i.tenant_id = ${tid} AND i.customer_id = ${params.customerId ?? 0}::int
              AND i.invoice_date BETWEEN ${from}::date AND ${to}::date AND i.status NOT IN ('CANCELLED', 'DRAFT')
            UNION ALL
            SELECT p.payment_date AS date, CONCAT('Payment - ', p.payment_number) AS description,
              0 AS debit, p.amount AS credit, p.id
            FROM payments p
            WHERE p.tenant_id = ${tid} AND p.customer_id = ${params.customerId ?? 0}::int
              AND p.payment_date BETWEEN ${from}::date AND ${to}::date
          ) sub
          ORDER BY date, id
        `);
        return res as unknown as ReportRow[];
      }

      case 'loyalty-points-report': {
        // H-8 fix: openingPoints/earned/redeemed were hardcoded to 0 despite a real, populated
        // loyalty_transactions table (points signed: EARN positive, REDEEM/EXPIRE negative —
        // see LoyaltyService.ts) simply never being queried. opening_points is derived as
        // closing minus the period's net change rather than stored directly, since no
        // per-period opening-balance snapshot exists.
        // ✓ tenant_id filtered — ES-05 audit
        const res = await db.execute(sql`
          SELECT
            c.display_name AS customer_name,
            c.phone,
            c.loyalty_points AS closing_points,
            c.loyalty_points - COALESCE(lt.net_change, 0) AS opening_points,
            COALESCE(lt.earned, 0) AS earned,
            COALESCE(lt.redeemed, 0) AS redeemed
          FROM customers c
          LEFT JOIN (
            SELECT
              customer_id,
              SUM(points) AS net_change,
              SUM(CASE WHEN type = 'EARN' THEN points ELSE 0 END) AS earned,
              SUM(CASE WHEN type = 'REDEEM' THEN -points ELSE 0 END) AS redeemed
            FROM loyalty_transactions
            WHERE tenant_id = ${tid}
              AND created_at::date BETWEEN ${from}::date AND ${to}::date
            GROUP BY customer_id
          ) lt ON lt.customer_id = c.id
          WHERE c.tenant_id = ${tid}
            AND c.loyalty_points > 0
          ORDER BY c.loyalty_points DESC
        `);
        return res as unknown as ReportRow[];
      }

      case 'discount-report': {
        // ✓ tenant_id filtered — ES-05 audit
        const res = await db.execute(sql`
          SELECT
            i.invoice_number,
            i.invoice_date::date AS date,
            COALESCE(c.display_name, 'Walk-in') AS customer_name,
            i.subtotal + COALESCE(i.discount_amount, 0) AS gross_amount,
            COALESCE(i.discount_amount, 0) AS discount_amount,
            CASE WHEN (i.subtotal + COALESCE(i.discount_amount, 0)) > 0 THEN
              ROUND((COALESCE(i.discount_amount, 0) / (i.subtotal + COALESCE(i.discount_amount, 0)) * 100)::numeric, 2)
            ELSE 0 END AS discount_percent,
            i.subtotal AS net_amount
          FROM invoices i
          LEFT JOIN customers c ON c.id = i.customer_id AND c.tenant_id = ${tid}
          WHERE i.tenant_id = ${tid}
            AND i.invoice_date BETWEEN ${from}::date AND ${to}::date
            AND i.status NOT IN ('CANCELLED', 'DRAFT')
            AND COALESCE(i.discount_amount, 0) > 0
          ORDER BY i.invoice_date DESC
        `);
        return res as unknown as ReportRow[];
      }

      case 'sales-target-vs-actual': {
        // ✓ tenant_id filtered — ES-05 audit
        const res = await db.execute(sql`
          SELECT
            b.name AS branch,
            0 AS target,
            COALESCE(SUM(i.grand_total), 0) AS actual,
            0 AS achievement,
            COALESCE(SUM(i.grand_total), 0) AS variance
          FROM branches b
          LEFT JOIN invoices i ON i.branch_id = b.id AND i.tenant_id = ${tid}
            AND i.invoice_date BETWEEN ${from}::date AND ${to}::date
            AND i.status != 'CANCELLED'
          WHERE b.tenant_id = ${tid}
          GROUP BY b.id, b.name
          ORDER BY actual DESC
        `);
        return res as unknown as ReportRow[];
      }

      // â”€â”€ PURCHASE REPORTS â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
      case 'purchase-register': {
        // ✓ tenant_id filtered — ES-05 audit
        const res = await db.execute(sql`
          SELECT
            g.grn_number,
            g.grn_date::date AS grn_date,
            s.display_name AS supplier_name,
            g.supplier_invoice_number AS supplier_invoice,
            g.subtotal,
            g.cgst_amount AS cgst,
            g.sgst_amount AS sgst,
            g.igst_amount AS igst,
            g.grand_total,
            g.status
          FROM grns g
          JOIN suppliers s ON s.id = g.supplier_id AND s.tenant_id = ${tid}
          WHERE g.tenant_id = ${tid}
            AND g.grn_date BETWEEN ${from}::date AND ${to}::date
            AND (${params.supplierId ?? null}::int IS NULL OR g.supplier_id = ${params.supplierId ?? null}::int)
          ORDER BY g.grn_date DESC
        `);
        return res as unknown as ReportRow[];
      }

      case 'purchase-by-supplier': {
        // ✓ tenant_id filtered — ES-05 audit
        const res = await db.execute(sql`
          SELECT
            s.display_name AS supplier_name,
            COUNT(g.id)::int AS grn_count,
            SUM(g.grand_total) AS total_purchase,
            COALESCE(SUM(sp.amount), 0) AS total_paid,
            SUM(g.grand_total) - COALESCE(SUM(sp.amount), 0) AS outstanding
          FROM grns g
          JOIN suppliers s ON s.id = g.supplier_id AND s.tenant_id = ${tid}
          LEFT JOIN supplier_payments sp ON sp.supplier_id = g.supplier_id AND sp.tenant_id = ${tid}
            AND sp.payment_date BETWEEN ${from}::date AND ${to}::date
          WHERE g.tenant_id = ${tid}
            AND g.grn_date BETWEEN ${from}::date AND ${to}::date
          GROUP BY s.id, s.display_name
          ORDER BY total_purchase DESC
        `);
        return res as unknown as ReportRow[];
      }

      case 'purchase-by-item': {
        // FIXED: grn_lines has no quantity_received/unit_cost columns (real:
        // received_qty/grn_rate).
        const res = await db.execute(sql`
          SELECT
            it.item_code,
            it.name AS item_name,
            SUM(gl.received_qty) AS quantity_received,
            SUM(gl.received_qty * gl.grn_rate) AS total_cost,
            CASE WHEN SUM(gl.received_qty) > 0 THEN
              ROUND((SUM(gl.received_qty * gl.grn_rate) / SUM(gl.received_qty))::numeric, 4)
            ELSE 0 END AS avg_cost
          FROM grn_lines gl
          JOIN grns g ON g.id = gl.grn_id AND g.tenant_id = ${tid}
          JOIN items it ON it.id = gl.item_id
          WHERE g.tenant_id = ${tid}
            AND g.grn_date BETWEEN ${from}::date AND ${to}::date
          GROUP BY it.id, it.item_code, it.name
          ORDER BY total_cost DESC
        `);
        return res as unknown as ReportRow[];
      }

      case 'outstanding-payables': {
        const asOf = params.asOfDate ?? new Date().toISOString().slice(0, 10);
        // FIXED: grns has no due_date/paid_amount columns at all. due_date is derived from
        // grn_date + the supplier's credit_days (same field suppliers already carry for terms);
        // paid_amount is summed from supplier_payment_allocations, the real GRN-level payment
        // link (supplier_payments itself has no grn_id — it's allocated per-GRN via this table).
        const res = await db.execute(sql`
          SELECT
            s.display_name AS supplier_name,
            g.grn_number,
            g.grn_date::date AS grn_date,
            (g.grn_date::date + (s.credit_days || ' days')::interval)::date AS due_date,
            g.grand_total AS total_amount,
            COALESCE(spa.paid_amount, 0) AS paid_amount,
            g.grand_total - COALESCE(spa.paid_amount, 0) AS balance_due,
            CASE
              WHEN (${asOf}::date - (g.grn_date::date + (s.credit_days || ' days')::interval)::date) <= 0 THEN 'Current'
              WHEN (${asOf}::date - (g.grn_date::date + (s.credit_days || ' days')::interval)::date) <= 30 THEN '1-30 days'
              WHEN (${asOf}::date - (g.grn_date::date + (s.credit_days || ' days')::interval)::date) <= 60 THEN '31-60 days'
              WHEN (${asOf}::date - (g.grn_date::date + (s.credit_days || ' days')::interval)::date) <= 90 THEN '61-90 days'
              ELSE '90+ days'
            END AS days_bucket
          FROM grns g
          JOIN suppliers s ON s.id = g.supplier_id AND s.tenant_id = ${tid}
          LEFT JOIN (
            SELECT grn_id, SUM(amount) AS paid_amount
            FROM supplier_payment_allocations WHERE tenant_id = ${tid} GROUP BY grn_id
          ) spa ON spa.grn_id = g.id
          WHERE g.tenant_id = ${tid}
            AND g.grn_date <= ${asOf}::date
            AND (g.grand_total - COALESCE(spa.paid_amount, 0)) > 0
            AND g.status NOT IN ('CANCELLED')
            AND (${params.supplierId ?? null}::int IS NULL OR g.supplier_id = ${params.supplierId ?? null}::int)
          ORDER BY days_bucket DESC, balance_due DESC
        `);
        return res as unknown as ReportRow[];
      }

      case 'supplier-ledger': {
        // ✓ tenant_id filtered — ES-05 audit
        const res = await db.execute(sql`
          SELECT date, type, reference, debit, credit,
            SUM(credit - debit) OVER (ORDER BY date, id) AS balance
          FROM (
            SELECT g.grn_date AS date, 'GRN' AS type, g.grn_number AS reference,
              0 AS debit, g.grand_total AS credit, g.id
            FROM grns g
            WHERE g.tenant_id = ${tid} AND g.supplier_id = ${params.supplierId ?? 0}::int
              AND g.grn_date BETWEEN ${from}::date AND ${to}::date
            UNION ALL
            SELECT sp.payment_date AS date, 'Payment' AS type, sp.payment_number AS reference,
              sp.amount AS debit, 0 AS credit, sp.id
            FROM supplier_payments sp
            WHERE sp.tenant_id = ${tid} AND sp.supplier_id = ${params.supplierId ?? 0}::int
              AND sp.payment_date BETWEEN ${from}::date AND ${to}::date
          ) sub
          ORDER BY date, id
        `);
        return res as unknown as ReportRow[];
      }

      case 'purchase-order-status': {
        // FIXED: purchase_order_lines has no quantity/received_quantity/po_id columns (real:
        // ordered_qty/received_qty/purchase_order_id).
        const res = await db.execute(sql`
          SELECT
            po.po_number,
            po.po_date::date AS po_date,
            s.display_name AS supplier_name,
            COALESCE(SUM(pol.ordered_qty), 0) AS ordered_qty,
            COALESCE(SUM(pol.received_qty), 0) AS received_qty,
            COALESCE(SUM(pol.ordered_qty - pol.received_qty), 0) AS pending_qty,
            po.grand_total AS total_value,
            po.status
          FROM purchase_orders po
          JOIN suppliers s ON s.id = po.supplier_id AND s.tenant_id = ${tid}
          LEFT JOIN purchase_order_lines pol ON pol.purchase_order_id = po.id
          WHERE po.tenant_id = ${tid}
            AND po.po_date BETWEEN ${from}::date AND ${to}::date
            AND (${params.status ?? null}::text IS NULL OR po.status = ${params.status ?? null}::text)
          GROUP BY po.id, po.po_number, po.po_date, s.display_name, po.grand_total, po.status
          ORDER BY po.po_date DESC
        `);
        return res as unknown as ReportRow[];
      }

      case 'purchase-return-report': {
        // FIXED: purchase_returns has no total_return_amount column (real: grand_total).
        const res = await db.execute(sql`
          SELECT
            pr.return_number,
            pr.return_date::date AS date,
            s.display_name AS supplier_name,
            g.grn_number AS original_grn,
            pr.grand_total AS return_amount,
            pr.status
          FROM purchase_returns pr
          JOIN suppliers s ON s.id = pr.supplier_id AND s.tenant_id = ${tid}
          JOIN grns g ON g.id = pr.grn_id
          WHERE pr.tenant_id = ${tid}
            AND pr.return_date BETWEEN ${from}::date AND ${to}::date
          ORDER BY pr.return_date DESC
        `);
        return res as unknown as ReportRow[];
      }

      case 'grn-report': {
        // FIXED: grn_lines has no quantity_received/unit_cost columns (real:
        // received_qty/grn_rate).
        const res = await db.execute(sql`
          SELECT
            g.grn_number,
            g.grn_date::date AS grn_date,
            s.display_name AS supplier_name,
            w.name AS warehouse_name,
            COUNT(gl.id)::int AS item_count,
            SUM(gl.received_qty) AS total_qty,
            SUM(gl.received_qty * gl.grn_rate) AS total_value,
            g.status
          FROM grns g
          JOIN suppliers s ON s.id = g.supplier_id AND s.tenant_id = ${tid}
          LEFT JOIN warehouses w ON w.id = g.warehouse_id AND w.tenant_id = ${tid}
          LEFT JOIN grn_lines gl ON gl.grn_id = g.id
          WHERE g.tenant_id = ${tid}
            AND g.grn_date BETWEEN ${from}::date AND ${to}::date
            AND (${params.supplierId ?? null}::int IS NULL OR g.supplier_id = ${params.supplierId ?? null}::int)
          GROUP BY g.id, g.grn_number, g.grn_date, s.display_name, w.name, g.status
          ORDER BY g.grn_date DESC
        `);
        return res as unknown as ReportRow[];
      }

      case 'expense-report': {
        // FIXED: expenses has no vendor_name/amount/gst_amount columns (real: total_amount;
        // GST lives per-line on expense_lines, summed here; vendor comes from the optional
        // supplier link, nullable since expenses like RENT have no supplier-master record) and
        // no expense_category column (real: expense_type).
        const res = await db.execute(sql`
          SELECT
            e.expense_date::date AS date,
            e.expense_number,
            COALESCE(s.display_name, 'N/A') AS vendor,
            e.expense_type AS category,
            e.description,
            e.total_amount AS amount,
            COALESCE(el.gst_total, 0) AS gst
          FROM expenses e
          LEFT JOIN suppliers s ON s.id = e.supplier_id AND s.tenant_id = ${tid}
          LEFT JOIN (
            SELECT expense_id, SUM(gst_amount) AS gst_total
            FROM expense_lines WHERE tenant_id = ${tid} GROUP BY expense_id
          ) el ON el.expense_id = e.id
          WHERE e.tenant_id = ${tid}
            AND e.expense_date BETWEEN ${from}::date AND ${to}::date
          ORDER BY e.expense_date DESC
        `);
        return res as unknown as ReportRow[];
      }

      case 'landed-cost-report': {
        // ✓ tenant_id filtered — ES-05 audit
        const res = await db.execute(sql`
          SELECT
            g.grn_number,
            g.grn_date::date AS grn_date,
            s.display_name AS supplier_name,
            lc.cost_type,
            lc.amount,
            lc.allocation_method
          FROM landed_costs lc
          JOIN grns g ON g.id = lc.grn_id AND g.tenant_id = ${tid}
          JOIN suppliers s ON s.id = g.supplier_id
          WHERE lc.tenant_id = ${tid}
            AND g.grn_date BETWEEN ${from}::date AND ${to}::date
          ORDER BY g.grn_date DESC
        `);
        return res as unknown as ReportRow[];
      }

      case 'supplier-payment-report': {
        // FIXED: supplier_payments has no reference_number column (real: transaction_reference).
        const res = await db.execute(sql`
          SELECT
            sp.payment_date::date AS payment_date,
            sp.payment_number,
            s.display_name AS supplier_name,
            sp.payment_mode AS mode,
            sp.amount,
            sp.transaction_reference AS reference
          FROM supplier_payments sp
          JOIN suppliers s ON s.id = sp.supplier_id AND s.tenant_id = ${tid}
          WHERE sp.tenant_id = ${tid}
            AND sp.payment_date BETWEEN ${from}::date AND ${to}::date
            AND (${params.supplierId ?? null}::int IS NULL OR sp.supplier_id = ${params.supplierId ?? null}::int)
          ORDER BY sp.payment_date DESC
        `);
        return res as unknown as ReportRow[];
      }

      case 'price-trend': {
        // FIXED: grn_lines has no quantity_received/unit_cost columns (real:
        // received_qty/grn_rate).
        const res = await db.execute(sql`
          SELECT
            g.grn_date::date AS date,
            g.grn_number,
            s.display_name AS supplier_name,
            gl.received_qty AS quantity,
            gl.grn_rate AS unit_cost
          FROM grn_lines gl
          JOIN grns g ON g.id = gl.grn_id AND g.tenant_id = ${tid}
          JOIN suppliers s ON s.id = g.supplier_id
          WHERE g.tenant_id = ${tid}
            AND gl.item_id = ${params.itemId ?? 0}::int
            AND g.grn_date BETWEEN ${from}::date AND ${to}::date
          ORDER BY g.grn_date
        `);
        return res as unknown as ReportRow[];
      }

      // â”€â”€ INVENTORY REPORTS â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
      case 'stock-summary': {
        // FIXED: previously selected psl.quantity_on_hand/psl.fifo_unit_cost — neither column
        // exists on projection_stock_level (real columns: available_qty, reserved_qty,
        // last_movement_at); every one of these report cases 500'd with a Postgres
        // "column does not exist" error. valuation_cost uses items.wacc_cost (tenant-wide
        // WACC) as the per-unit estimate — there is no single scalar FIFO cost at this
        // granularity (FIFO tracks multiple cost layers), matching the same fallback-to-
        // estimate approach inventory-service's own valuation.routes.ts already uses.
        const res = await db.execute(sql`
          SELECT
            it.item_code,
            it.name AS item_name,
            cat.name AS category,
            w.name AS warehouse,
            psl.available_qty AS quantity_on_hand,
            it.reorder_level,
            it.wacc_cost AS valuation_cost,
            psl.available_qty * COALESCE(it.wacc_cost, 0) AS total_value
          FROM projection_stock_level psl
          JOIN items it ON it.id = psl.item_id AND it.tenant_id = ${tid}
          JOIN warehouses w ON w.id = psl.warehouse_id AND w.tenant_id = ${tid}
          LEFT JOIN categories cat ON cat.id = it.category_id
          WHERE psl.tenant_id = ${tid}
            AND psl.available_qty > 0
            AND (${params.warehouseId ?? null}::int IS NULL OR psl.warehouse_id = ${params.warehouseId ?? null}::int)
            AND (${params.categoryId ?? null}::int IS NULL OR it.category_id = ${params.categoryId ?? null}::int)
          ORDER BY it.name, w.name
        `);
        return res as unknown as ReportRow[];
      }

      case 'stock-movement': {
        // FIXED: inventory_ledger has no transaction_date/transaction_type columns (real:
        // created_at, movement_type — enum STOCK_IN/STOCK_OUT/ADJUSTMENT/TRANSFER_IN/
        // TRANSFER_OUT/OPENING/RESERVATION/RESERVATION_RELEASE, not the PURCHASE_RECEIPT/
        // SALE_ISSUE/etc values this query filtered on). Opening/adjusted qty use the
        // ledger's own quantity_before/quantity_after delta rather than reinterpreting a
        // movement type, which is exact regardless of movement classification.
        const res = await db.execute(sql`
          SELECT
            it.name AS item_name,
            w.name AS warehouse,
            COALESCE(SUM(CASE WHEN il.created_at < ${from}::date
              THEN (il.quantity_after - il.quantity_before) ELSE 0 END), 0) AS opening_qty,
            COALESCE(SUM(CASE WHEN il.created_at BETWEEN ${from}::date AND ${to}::date
              AND il.movement_type IN ('STOCK_IN','TRANSFER_IN') THEN il.quantity ELSE 0 END), 0) AS received_qty,
            COALESCE(SUM(CASE WHEN il.created_at BETWEEN ${from}::date AND ${to}::date
              AND il.movement_type IN ('STOCK_OUT','TRANSFER_OUT') THEN il.quantity ELSE 0 END), 0) AS issued_qty,
            COALESCE(SUM(CASE WHEN il.created_at BETWEEN ${from}::date AND ${to}::date
              AND il.movement_type = 'ADJUSTMENT' THEN (il.quantity_after - il.quantity_before) ELSE 0 END), 0) AS adjusted_qty,
            psl.available_qty AS closing_qty
          FROM inventory_ledger il
          JOIN items it ON it.id = il.item_id AND it.tenant_id = ${tid}
          JOIN warehouses w ON w.id = il.warehouse_id AND w.tenant_id = ${tid}
          LEFT JOIN projection_stock_level psl ON psl.item_id = il.item_id AND psl.warehouse_id = il.warehouse_id AND psl.tenant_id = ${tid} AND psl.variant_id IS NULL
          WHERE il.tenant_id = ${tid}
            AND (${params.itemId ?? null}::int IS NULL OR il.item_id = ${params.itemId ?? null}::int)
            AND (${params.warehouseId ?? null}::int IS NULL OR il.warehouse_id = ${params.warehouseId ?? null}::int)
          GROUP BY it.name, w.name, psl.available_qty
          ORDER BY it.name, w.name
        `);
        return res as unknown as ReportRow[];
      }

      case 'inventory-valuation': {
        // FIXED: same quantity_on_hand/fifo_unit_cost column-drift as stock-summary above.
        const res = await db.execute(sql`
          SELECT
            it.item_code,
            it.name AS item_name,
            cat.name AS category,
            psl.available_qty AS quantity_on_hand,
            it.wacc_cost AS fifo_unit_cost,
            psl.available_qty * COALESCE(it.wacc_cost, 0) AS total_value
          FROM projection_stock_level psl
          JOIN items it ON it.id = psl.item_id AND it.tenant_id = ${tid}
          LEFT JOIN categories cat ON cat.id = it.category_id
          WHERE psl.tenant_id = ${tid}
            AND psl.available_qty > 0
            AND (${params.warehouseId ?? null}::int IS NULL OR psl.warehouse_id = ${params.warehouseId ?? null}::int)
          ORDER BY total_value DESC
        `);
        return res as unknown as ReportRow[];
      }

      case 'reorder-report': {
        // FIXED: same quantity_on_hand drift; items.reorder_quantity doesn't exist (real:
        // reorder_qty); items has no preferred_supplier_id column/relationship anywhere in
        // the schema, so that join is dropped rather than guessed.
        const res = await db.execute(sql`
          SELECT
            it.item_code,
            it.name AS item_name,
            w.name AS warehouse,
            psl.available_qty AS current_stock,
            it.reorder_level,
            GREATEST(it.reorder_qty, 0) AS reorder_qty
          FROM projection_stock_level psl
          JOIN items it ON it.id = psl.item_id AND it.tenant_id = ${tid}
          JOIN warehouses w ON w.id = psl.warehouse_id AND w.tenant_id = ${tid}
          WHERE psl.tenant_id = ${tid}
            AND psl.available_qty <= COALESCE(it.reorder_level, 0)
            AND (${params.warehouseId ?? null}::int IS NULL OR psl.warehouse_id = ${params.warehouseId ?? null}::int)
          ORDER BY (it.reorder_level - psl.available_qty) DESC
        `);
        return res as unknown as ReportRow[];
      }

      case 'stock-ageing': {
        const asOf = params.asOfDate ?? new Date().toISOString().slice(0, 10);
        // FIXED: transaction_date/transaction_type don't exist (real: created_at,
        // movement_type); 'PURCHASE_RECEIPT' isn't a real movement_type value — a GRN
        // receipt is movement_type='STOCK_IN' with reference_type='GRN'.
        const res = await db.execute(sql`
          SELECT
            it.name AS item_name,
            cat.name AS category,
            SUM(CASE WHEN (${asOf}::date - il.created_at::date) <= 30 THEN il.quantity ELSE 0 END) AS qty0to30,
            SUM(CASE WHEN (${asOf}::date - il.created_at::date) BETWEEN 31 AND 60 THEN il.quantity ELSE 0 END) AS qty31to60,
            SUM(CASE WHEN (${asOf}::date - il.created_at::date) BETWEEN 61 AND 90 THEN il.quantity ELSE 0 END) AS qty61to90,
            SUM(CASE WHEN (${asOf}::date - il.created_at::date) > 90 THEN il.quantity ELSE 0 END) AS qty90plus,
            SUM(il.quantity) AS total_qty,
            SUM(il.quantity * COALESCE(il.unit_cost, 0)) AS total_value
          FROM inventory_ledger il
          JOIN items it ON it.id = il.item_id AND it.tenant_id = ${tid}
          LEFT JOIN categories cat ON cat.id = it.category_id
          WHERE il.tenant_id = ${tid}
            AND il.movement_type = 'STOCK_IN'
            AND il.reference_type = 'GRN'
            AND il.created_at <= ${asOf}::date
            AND (${params.warehouseId ?? null}::int IS NULL OR il.warehouse_id = ${params.warehouseId ?? null}::int)
          GROUP BY it.id, it.name, cat.name
          ORDER BY total_value DESC
        `);
        return res as unknown as ReportRow[];
      }

      case 'physical-verification-report': {
        // FIXED: physical_verifications has no verification_date (real: created_at);
        // physical_verification_lines has no pv_id/book_quantity/physical_quantity/
        // variance_quantity (real: verification_id, system_qty, physical_qty, variance).
        const res = await db.execute(sql`
          SELECT
            pv.verification_number,
            pv.created_at::date AS date,
            w.name AS warehouse_name,
            it.name AS item_name,
            pvl.system_qty AS book_qty,
            pvl.physical_qty,
            pvl.variance,
            pvl.variance * COALESCE(it.wacc_cost, 0) AS variance_value
          FROM physical_verifications pv
          JOIN warehouses w ON w.id = pv.warehouse_id AND w.tenant_id = ${tid}
          JOIN physical_verification_lines pvl ON pvl.verification_id = pv.id
          JOIN items it ON it.id = pvl.item_id AND it.tenant_id = ${tid}
          WHERE pv.tenant_id = ${tid}
            AND pv.created_at BETWEEN ${from}::date AND ${to}::date
          ORDER BY pv.created_at DESC
        `);
        return res as unknown as ReportRow[];
      }

      case 'stock-transfer-report': {
        // FIXED: stock_transfers has no transfer_date column (real: created_at).
        const res = await db.execute(sql`
          SELECT
            st.transfer_number,
            st.created_at::date AS transfer_date,
            fw.name AS from_warehouse,
            tw.name AS to_warehouse,
            COUNT(stl.id)::int AS item_count,
            SUM(stl.dispatched_qty) AS total_qty,
            SUM(stl.dispatched_qty * COALESCE(stl.unit_cost, 0)) AS total_value,
            st.status
          FROM stock_transfers st
          JOIN warehouses fw ON fw.id = st.from_warehouse_id AND fw.tenant_id = ${tid}
          JOIN warehouses tw ON tw.id = st.to_warehouse_id AND tw.tenant_id = ${tid}
          LEFT JOIN stock_transfer_lines stl ON stl.transfer_id = st.id
          WHERE st.tenant_id = ${tid}
            AND st.created_at BETWEEN ${from}::date AND ${to}::date
          GROUP BY st.id, st.transfer_number, st.created_at, fw.name, tw.name, st.status
          ORDER BY st.created_at DESC
        `);
        return res as unknown as ReportRow[];
      }

      case 'fabric-roll-report': {
        // FIXED: fabric_rolls has no colour/total_metres/used_metres columns (real:
        // original_meters, remaining_meters; no colour column at all — dropped from the
        // registry below). Aliased to the registry's British "metres" spelling explicitly —
        // the previous American "meters" aliases silently mismatched every column key after
        // snake->camel conversion, so the table rendered with correct row counts but every
        // cell blank.
        const res = await db.execute(sql`
          SELECT
            fr.roll_number,
            it.name AS item_name,
            fr.original_meters AS total_metres,
            fr.original_meters - fr.remaining_meters AS used_metres,
            fr.remaining_meters AS remaining_metres,
            fr.status
          FROM fabric_rolls fr
          JOIN items it ON it.id = fr.item_id AND it.tenant_id = ${tid}
          WHERE fr.tenant_id = ${tid}
            AND fr.created_at BETWEEN ${from}::date AND ${to}::date
            AND (${params.warehouseId ?? null}::int IS NULL OR fr.warehouse_id = ${params.warehouseId ?? null}::int)
          ORDER BY fr.roll_number DESC
        `);
        return res as unknown as ReportRow[];
      }

      case 'warehouse-wise-stock': {
        // FIXED: same quantity_on_hand/fifo_unit_cost drift as stock-summary above.
        const res = await db.execute(sql`
          SELECT
            w.name AS warehouse,
            it.item_code,
            it.name AS item_name,
            psl.available_qty AS quantity_on_hand,
            psl.available_qty * COALESCE(it.wacc_cost, 0) AS total_value
          FROM projection_stock_level psl
          JOIN items it ON it.id = psl.item_id AND it.tenant_id = ${tid}
          JOIN warehouses w ON w.id = psl.warehouse_id AND w.tenant_id = ${tid}
          WHERE psl.tenant_id = ${tid}
            AND psl.available_qty > 0
            AND (${params.warehouseId ?? null}::int IS NULL OR psl.warehouse_id = ${params.warehouseId ?? null}::int)
            AND (${params.categoryId ?? null}::int IS NULL OR it.category_id = ${params.categoryId ?? null}::int)
          ORDER BY w.name, it.name
        `);
        return res as unknown as ReportRow[];
      }

      case 'stock-ledger': {
        // FIXED: transaction_date/transaction_type/reference_number don't exist (real:
        // created_at, movement_type, reference_type + reference_id — no single formatted
        // reference string column). movement_type is explicitly aliased to transaction_type —
        // the registry's key, which the unaliased column's own camelCase (movementType) didn't
        // match, leaving that column blank despite the query itself running fine.
        const res = await db.execute(sql`
          SELECT
            il.created_at::date AS date,
            il.movement_type AS transaction_type,
            (il.reference_type || ' #' || COALESCE(il.reference_id::text, '')) AS reference,
            CASE WHEN il.quantity_after >= il.quantity_before THEN (il.quantity_after - il.quantity_before) ELSE 0 END AS in_qty,
            CASE WHEN il.quantity_after < il.quantity_before THEN (il.quantity_before - il.quantity_after) ELSE 0 END AS out_qty,
            SUM(il.quantity_after - il.quantity_before) OVER (ORDER BY il.created_at, il.id) AS balance,
            il.unit_cost,
            il.quantity * COALESCE(il.unit_cost, 0) AS total_value
          FROM inventory_ledger il
          WHERE il.tenant_id = ${tid}
            AND il.item_id = ${params.itemId ?? 0}::int
            AND il.created_at BETWEEN ${from}::date AND ${to}::date
            AND (${params.warehouseId ?? null}::int IS NULL OR il.warehouse_id = ${params.warehouseId ?? null}::int)
          ORDER BY il.created_at, il.id
        `);
        return res as unknown as ReportRow[];
      }

      case 'dead-stock-report': {
        const days = Number(p(params.daysSinceMovement, 180));
        const asOf = params.asOfDate ?? new Date().toISOString().slice(0, 10);
        // FIXED: same quantity_on_hand/fifo_unit_cost drift, plus inventory_ledger has no
        // transaction_date (real: created_at); projection_stock_level.last_movement_at is
        // maintained on every movement type already, so use it directly instead of
        // re-deriving MAX(created_at) from the ledger.
        const res = await db.execute(sql`
          SELECT
            it.item_code,
            it.name AS item_name,
            cat.name AS category,
            psl.available_qty AS current_stock,
            psl.last_movement_at::date AS last_movement_date,
            (${asOf}::date - psl.last_movement_at::date) AS days_idle,
            psl.available_qty * COALESCE(it.wacc_cost, 0) AS stock_value
          FROM projection_stock_level psl
          JOIN items it ON it.id = psl.item_id AND it.tenant_id = ${tid}
          LEFT JOIN categories cat ON cat.id = it.category_id
          WHERE psl.tenant_id = ${tid}
            AND psl.available_qty > 0
            AND (${asOf}::date - psl.last_movement_at::date >= ${days} OR psl.last_movement_at IS NULL)
          ORDER BY days_idle DESC NULLS LAST
        `);
        return res as unknown as ReportRow[];
      }

      case 'adjustment-report': {
        // FIXED: stock_adjustments has no adjustment_date/reason columns (real: created_at;
        // reason lives per-line on stock_adjustment_lines, not on the header).
        const res = await db.execute(sql`
          SELECT
            sa.adjustment_number,
            sa.created_at::date AS date,
            w.name AS warehouse,
            it.name AS item_name,
            sa.adjustment_type,
            sal.quantity,
            sal.reason,
            sal.quantity * COALESCE(sal.unit_cost, 0) AS value_impact
          FROM stock_adjustments sa
          JOIN warehouses w ON w.id = sa.warehouse_id AND w.tenant_id = ${tid}
          JOIN stock_adjustment_lines sal ON sal.adjustment_id = sa.id
          JOIN items it ON it.id = sal.item_id AND it.tenant_id = ${tid}
          WHERE sa.tenant_id = ${tid}
            AND sa.created_at BETWEEN ${from}::date AND ${to}::date
          ORDER BY sa.created_at DESC
        `);
        return res as unknown as ReportRow[];
      }

      case 'reservation-report': {
        const asOf = params.asOfDate ?? new Date().toISOString().slice(0, 10);
        // FIXED: same quantity_on_hand drift; stock_reservations has no reserved_quantity
        // column (real: quantity).
        const res = await db.execute(sql`
          SELECT
            it.name AS item_name,
            w.name AS warehouse,
            SUM(sr.quantity) AS reserved_qty,
            psl.available_qty - SUM(sr.quantity) AS available_qty,
            psl.available_qty AS total_qty,
            STRING_AGG(DISTINCT sr.reference_type || ' ' || sr.reference_id::text, ', ') AS reserved_for
          FROM stock_reservations sr
          JOIN items it ON it.id = sr.item_id AND it.tenant_id = ${tid}
          JOIN warehouses w ON w.id = sr.warehouse_id AND w.tenant_id = ${tid}
          LEFT JOIN projection_stock_level psl ON psl.item_id = sr.item_id AND psl.warehouse_id = sr.warehouse_id AND psl.tenant_id = ${tid} AND psl.variant_id IS NULL
          WHERE sr.tenant_id = ${tid}
            AND sr.status = 'ACTIVE'
            AND sr.expires_at >= ${asOf}::date
            AND (${params.warehouseId ?? null}::int IS NULL OR sr.warehouse_id = ${params.warehouseId ?? null}::int)
          GROUP BY it.id, it.name, w.id, w.name, psl.available_qty
          ORDER BY reserved_qty DESC
        `);
        return res as unknown as ReportRow[];
      }

      // â”€â”€ FINANCIAL REPORTS â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
      case 'day-book': {
        // FIXED: joined on j.id = fe.journal_id, but journals.id is a bigserial while
        // financial_entries.journal_id is the varchar(26) ULID business identifier stored on
        // journals as journals.journal_id — comparing bigint to varchar is a hard Postgres type
        // error. Also selected j.journal_number, which doesn't exist anywhere on journals —
        // journal_id (the ULID) IS the display identifier (see journal.routes.ts's own lookups).
        const res = await db.execute(sql`
          SELECT
            fe.created_at::time AS time,
            CASE WHEN fe.debit_amount > 0 THEN 'DEBIT' ELSE 'CREDIT' END AS type,
            j.journal_id AS reference,
            fe.description,
            fe.debit_amount AS debit,
            fe.credit_amount AS credit
          FROM financial_entries fe
          JOIN journals j ON j.journal_id = fe.journal_id AND j.tenant_id = ${tid}
          WHERE fe.tenant_id = ${tid}
            AND fe.created_at::date = ${from}::date
          ORDER BY fe.created_at
        `);
        return res as unknown as ReportRow[];
      }

      case 'account-ledger': {
        // FIXED: same journals join type-mismatch (j.id is bigserial, fe.journal_id is the
        // journals.journal_id varchar(26) ULID) and nonexistent journal_number column as
        // day-book above.
        const res = await db.execute(sql`
          SELECT
            fe.created_at::date AS date,
            j.journal_id AS journal_number,
            fe.description,
            fe.debit_amount AS debit,
            fe.credit_amount AS credit,
            SUM(fe.debit_amount - fe.credit_amount)
              OVER (ORDER BY fe.created_at, fe.id) AS balance
          FROM financial_entries fe
          JOIN journals j ON j.journal_id = fe.journal_id AND j.tenant_id = ${tid}
          WHERE fe.tenant_id = ${tid}
            AND fe.account_id = ${params.accountId ?? 0}::int
            AND fe.created_at >= ${from}::date AND fe.created_at < (${to}::date + INTERVAL '1 day')
          ORDER BY fe.created_at, fe.id
        `);
        return res as unknown as ReportRow[];
      }

      case 'trial-balance-report': {
        // Multi-vertical platform audit 2026-08-16, Phase 3 — sourced from the shared
        // ReportsEngine (@erp/sdk) instead of a hand-duplicated query. This fixes a real
        // divergence: this branch used to treat "period" as an arbitrary caller-supplied
        // from/to range with no financial-year awareness, while accounting-service's own
        // Trial Balance page folded pre-FY activity into the opening balance — the two
        // live Trial Balance endpoints could show different totals for the same tenant/date.
        // fromDate/date-range params no longer apply to this report (asOf/FY-boundary only),
        // matching accounting-service's semantics.
        const asOf = params.toDate ?? params.asOfDate ?? to;
        const report = await ReportsEngine.getTrialBalance(
          new TenantScopedDatabase(tid, db),
          tid,
          asOf
        );
        return report.lines
          .map((l): ReportRow => ({
            account_code: l.accountCode,
            account_name: l.accountName,
            opening_debit: l.openingBalanceType === 'DEBIT' ? l.openingBalance : 0,
            opening_credit: l.openingBalanceType === 'CREDIT' ? l.openingBalance : 0,
            period_debit: l.periodDebits,
            period_credit: l.periodCredits,
            closing_debit: l.closingDebit,
            closing_credit: l.closingCredit,
          }))
          .filter(
            (r) =>
              r['opening_debit'] ||
              r['opening_credit'] ||
              r['period_debit'] ||
              r['period_credit'] ||
              r['closing_debit'] ||
              r['closing_credit']
          );
      }

      case 'profit-loss-report': {
        // Multi-vertical platform audit 2026-08-16, Phase 3 — sourced from the shared
        // ReportsEngine (@erp/sdk) instead of a hand-duplicated query, so the OTHER_EXPENSE
        // sub-type-routing fix (previously undercounted real expenses whenever a sub-type was
        // unset) and the CONTRA→CONTRA_REVENUE categorization live in one place, not two
        // independently-maintained copies. Row shape (category/account_code/account_name/
        // amount, one row per real GL account) is unchanged — still no computed subtotals;
        // see the note below, which still applies unchanged by this move.
        const pl = await ReportsEngine.getProfitLoss(
          new TenantScopedDatabase(tid, db),
          tid,
          from,
          to
        );
        const category = (label: string, lines: typeof pl.revenue) =>
          lines.map((l): ReportRow => ({
            category: label,
            account_code: l.accountCode,
            account_name: l.accountName,
            amount: l.amount,
          }));
        const rows = [
          ...category('REVENUE', pl.revenue),
          ...category('OTHER_INCOME', pl.otherIncome),
          ...category('COGS', pl.cogs),
          ...category('CONTRA_REVENUE', pl.contraRevenue),
          ...category('OPERATING_EXPENSE', pl.operatingExpenses),
          ...category('TAX_EXPENSE', pl.financialCharges),
          ...category('OTHER_EXPENSE', pl.otherExpenses),
        ].filter((r) => Number(r['amount']) !== 0);
        rows.sort(
          (a, b) =>
            String(a['category']).localeCompare(String(b['category'])) ||
            String(a['account_code']).localeCompare(String(b['account_code']))
        );
        // NOTE (audit 2026-07-23): this registry endpoint has no computed gross/operating/net
        // profit subtotals (unlike accounting-service's ReportsEngine.getProfitLoss()) — a
        // consumer built directly on the raw rows must re-derive them. An earlier attempt to fix
        // this by appending synthetic "SUBTOTAL" rows into this same flat array was reverted: it
        // broke the "every row is a real GL account" contract every category-based consumer of
        // this endpoint (including the generic Reports Browser table) relies on. A real fix
        // needs a dedicated `summary` field on ReportResult, reviewed against every consumer of
        // this registry (Reports Browser UI, CSV/PDF export) — not a rushed shape change here.
        return rows;
      }

      case 'balance-sheet-report': {
        // Multi-vertical platform audit 2026-08-16, Phase 3 — sourced from the shared
        // ReportsEngine (@erp/sdk) instead of a hand-duplicated query. The "Current Year
        // Earnings" plug (below) now reuses the full OTHER_EXPENSE-aware P&L calculation
        // internally instead of a simplified inline sum that could diverge from it in edge
        // cases (an account with no sub-type, or one outside the enumerated set) — both live
        // Balance Sheet endpoints now compute the plug the exact same way, not just similarly.
        const asOf = params.asOfDate ?? to;
        const bs = await ReportsEngine.getBalanceSheet(
          new TenantScopedDatabase(tid, db),
          tid,
          asOf
        );
        const toRow = (s: (typeof bs.assets)[number], section: string): ReportRow => ({
          section,
          account_code: s.accountCode,
          account_name: s.accountName,
          amount: s.balance,
        });
        return [
          ...bs.assets.map((s) => toRow(s, 'ASSET')),
          ...bs.liabilities.map((s) => toRow(s, 'LIABILITY')),
          ...bs.equity.map((s) => toRow(s, 'EQUITY')),
        ];
      }

      case 'cash-flow-report': {
        // Multi-vertical platform audit 2026-08-16, Phase 3 — sourced from the shared
        // ReportsEngine (@erp/sdk), which this branch's classification logic (LATERAL-join
        // counter-account bucketing into Operating/Investing/Financing) was already hand-copied
        // from — now genuinely one implementation instead of two kept in sync by comment
        // convention, closing the gap that let their opening-cash-balance queries diverge once
        // already (see the engine's own opening-balance comment).
        const cf = await ReportsEngine.getCashFlow(
          new TenantScopedDatabase(tid, db),
          tid,
          from,
          to
        );
        const rows: ReportRow[] = [
          ...cf.operatingActivities.map((a) => ({
            section: 'Operating Activities',
            description: a.label,
            amount: a.amount,
          })),
          {
            section: 'Operating Activities',
            description: 'Net Cash from Operating Activities',
            amount: cf.netOperating,
          },
          ...cf.investingActivities.map((a) => ({
            section: 'Investing Activities',
            description: a.label,
            amount: a.amount,
          })),
          {
            section: 'Investing Activities',
            description: 'Net Cash from Investing Activities',
            amount: cf.netInvesting,
          },
          ...cf.financingActivities.map((a) => ({
            section: 'Financing Activities',
            description: a.label,
            amount: a.amount,
          })),
          {
            section: 'Financing Activities',
            description: 'Net Cash from Financing Activities',
            amount: cf.netFinancing,
          },
          { section: 'Summary', description: 'Net Cash Movement', amount: cf.netCashMovement },
          {
            section: 'Summary',
            description: 'Opening Cash & Bank Balance',
            amount: cf.openingCash,
          },
          {
            section: 'Summary',
            description: 'Closing Cash & Bank Balance',
            amount: cf.closingCash,
          },
        ];
        return rows;
      }

      case 'expense-analysis': {
        // ✓ tenant_id filtered — ES-26 (fixed: real columns are debit_amount/credit_amount/created_at,
        // not amount/debit_credit/entry_date)
        const res = await db.execute(sql`
          WITH totals AS (SELECT SUM(fe.debit_amount) AS total FROM financial_entries fe
            JOIN accounts a ON a.id = fe.account_id AND a.tenant_id = ${tid}
            WHERE fe.tenant_id = ${tid} AND a.account_type = 'EXPENSE'
              AND fe.created_at >= ${from}::date AND fe.created_at < (${to}::date + INTERVAL '1 day'))
          SELECT
            a.name AS category,
            SUM(fe.debit_amount) AS amount,
            ROUND((SUM(fe.debit_amount) / NULLIF((SELECT total FROM totals), 0) * 100)::numeric, 2) AS share
          FROM financial_entries fe
          JOIN accounts a ON a.id = fe.account_id AND a.tenant_id = ${tid}
          WHERE fe.tenant_id = ${tid}
            AND a.account_type = 'EXPENSE'
            AND fe.created_at >= ${from}::date AND fe.created_at < (${to}::date + INTERVAL '1 day')
          GROUP BY a.id, a.name
          ORDER BY amount DESC
        `);
        return res as unknown as ReportRow[];
      }

      case 'bank-book': {
        // FIXED: same journals join type-mismatch and nonexistent journal_number column as
        // day-book/account-ledger above.
        const res = await db.execute(sql`
          SELECT
            fe.created_at::date AS date,
            fe.description,
            j.journal_id AS reference,
            fe.debit_amount AS debit,
            fe.credit_amount AS credit,
            SUM(fe.debit_amount - fe.credit_amount)
              OVER (ORDER BY fe.created_at, fe.id) AS balance
          FROM financial_entries fe
          JOIN journals j ON j.journal_id = fe.journal_id AND j.tenant_id = ${tid}
          JOIN bank_accounts ba ON ba.account_id = fe.account_id AND ba.tenant_id = ${tid}
          WHERE fe.tenant_id = ${tid}
            AND ba.id = ${params.bankAccountId ?? 0}::int
            AND fe.created_at >= ${from}::date AND fe.created_at < (${to}::date + INTERVAL '1 day')
          ORDER BY fe.created_at, fe.id
        `);
        return res as unknown as ReportRow[];
      }

      case 'tds-report': {
        // FIXED: tds_entries has no deductee_type/pan_number/gross_amount/status/entry_date
        // columns at all (real: supplier_id (FK)/taxable_amount/deposit_status/
        // period_month+period_year, no single date column). PAN comes from the linked
        // supplier; deductee type is derived from the 4th character of the PAN, which the
        // Income Tax Department's PAN format standard fixes to the holder's entity type
        // (C=Company, P=Individual, H=HUF, F=Firm, A=AOP, T=Trust, B=BOI, L=Local Authority,
        // J=Artificial Judicial Person, G=Government) — not invented, a real documented rule.
        const res = await db.execute(sql`
          SELECT
            CASE SUBSTRING(s.pan, 4, 1)
              WHEN 'C' THEN 'Company' WHEN 'P' THEN 'Individual' WHEN 'H' THEN 'HUF'
              WHEN 'F' THEN 'Firm' WHEN 'A' THEN 'AOP' WHEN 'T' THEN 'Trust'
              WHEN 'B' THEN 'BOI' WHEN 'L' THEN 'Local Authority'
              WHEN 'J' THEN 'Artificial Judicial Person' WHEN 'G' THEN 'Government'
              ELSE 'Unknown'
            END AS deductee_type,
            s.pan AS pan_number,
            te.tds_section AS section,
            te.taxable_amount AS gross_amount,
            te.tds_rate,
            te.tds_amount,
            te.deposit_status AS status
          FROM tds_entries te
          JOIN suppliers s ON s.id = te.supplier_id AND s.tenant_id = ${tid}
          WHERE te.tenant_id = ${tid}
            AND (te.period_year * 100 + te.period_month)
              BETWEEN (EXTRACT(YEAR FROM ${from}::date)::int * 100 + EXTRACT(MONTH FROM ${from}::date)::int)
              AND (EXTRACT(YEAR FROM ${to}::date)::int * 100 + EXTRACT(MONTH FROM ${to}::date)::int)
          ORDER BY te.period_year DESC, te.period_month DESC
        `);
        return res as unknown as ReportRow[];
      }

      case 'depreciation-schedule': {
        // FIXED: fixed_assets has no asset_name/asset_category columns (real: name/category);
        // asset_depreciation_schedule has no financial_year column at all (real:
        // period_month/period_year) — the "25-26"-style FY string param is parsed in JS
        // (matching NumberSeriesEngine's own FY format) into the April-start/March-end year
        // pair the schedule actually stores.
        const fyRaw = parseInt(String(params.financialYear ?? '').split('-')[0] ?? '', 10);
        const fyStartYear = fyRaw < 100 ? 2000 + fyRaw : fyRaw;
        const fyEndYear = fyStartYear + 1;
        const res = await db.execute(sql`
          SELECT
            fa.name AS asset_name,
            fa.category AS asset_category,
            fa.purchase_date::date AS purchase_date,
            ads.opening_value,
            0 AS additions,
            ads.depreciation_amount AS depreciation,
            ads.closing_value
          FROM fixed_assets fa
          JOIN asset_depreciation_schedule ads ON ads.asset_id = fa.id AND ads.tenant_id = ${tid}
          WHERE fa.tenant_id = ${tid}
            AND (
              (ads.period_year = ${fyStartYear} AND ads.period_month >= 4)
              OR (ads.period_year = ${fyEndYear} AND ads.period_month <= 3)
            )
          ORDER BY fa.name, ads.period_year, ads.period_month
        `);
        return res as unknown as ReportRow[];
      }

      case 'journal-report': {
        // FIXED: journals has no journal_date/journal_number/total_debit/total_credit columns
        // (real: posted_at, journal_id (the ULID business identifier); there is no header-level
        // debit/credit total at all — it's derived here from the journal's financial_entries,
        // which by the DEFERRED validate_journal_balance trigger are always balanced).
        const res = await db.execute(sql`
          SELECT
            j.posted_at::date AS journal_date,
            j.journal_id AS journal_number,
            j.description,
            COALESCE(fe.total_debit, 0) AS total_debit,
            COALESCE(fe.total_credit, 0) AS total_credit
          FROM journals j
          LEFT JOIN (
            SELECT journal_id, SUM(debit_amount) AS total_debit, SUM(credit_amount) AS total_credit
            FROM financial_entries WHERE tenant_id = ${tid} GROUP BY journal_id
          ) fe ON fe.journal_id = j.journal_id
          WHERE j.tenant_id = ${tid}
            AND j.posted_at BETWEEN ${from}::date AND (${to}::date + INTERVAL '1 day')
          ORDER BY j.posted_at DESC
        `);
        return res as unknown as ReportRow[];
      }

      case 'profit-center-report': {
        // FIXED (logic bug, not a schema error): cogs/expenses/margin were hardcoded to 0, and
        // gross_profit/net_profit both just repeated total_sales verbatim — every branch always
        // showed 100% margin with no cost basis at all. cogs is now derived from
        // items.wacc_cost (same fallback used by sales-by-item/dashboard.routes.ts elsewhere in
        // this file), expenses from the expenses table's real per-branch total_amount.
        const res = await db.execute(sql`
          WITH sales AS (
            SELECT i.branch_id, SUM(i.grand_total) AS total_sales
            FROM invoices i
            WHERE i.tenant_id = ${tid} AND i.status != 'CANCELLED'
              AND i.invoice_date BETWEEN ${from}::date AND ${to}::date
            GROUP BY i.branch_id
          ),
          cost_of_goods AS (
            SELECT i.branch_id, SUM(il.quantity * COALESCE(it.wacc_cost, 0)) AS cogs
            FROM invoice_lines il
            JOIN invoices i ON i.id = il.invoice_id AND i.tenant_id = ${tid}
            JOIN items it ON it.id = il.item_id AND it.tenant_id = ${tid}
            WHERE i.tenant_id = ${tid} AND i.status != 'CANCELLED'
              AND i.invoice_date BETWEEN ${from}::date AND ${to}::date
            GROUP BY i.branch_id
          ),
          branch_expenses AS (
            SELECT e.branch_id, SUM(e.total_amount) AS expenses
            FROM expenses e
            WHERE e.tenant_id = ${tid}
              AND e.expense_date BETWEEN ${from}::date AND ${to}::date
            GROUP BY e.branch_id
          )
          SELECT
            b.name AS branch,
            COALESCE(s.total_sales, 0) AS total_sales,
            COALESCE(cg.cogs, 0) AS cogs,
            COALESCE(s.total_sales, 0) - COALESCE(cg.cogs, 0) AS gross_profit,
            COALESCE(be.expenses, 0) AS expenses,
            COALESCE(s.total_sales, 0) - COALESCE(cg.cogs, 0) - COALESCE(be.expenses, 0) AS net_profit,
            CASE WHEN COALESCE(s.total_sales, 0) > 0 THEN
              ROUND(((COALESCE(s.total_sales, 0) - COALESCE(cg.cogs, 0) - COALESCE(be.expenses, 0)) / s.total_sales * 100)::numeric, 2)
            ELSE 0 END AS margin
          FROM branches b
          LEFT JOIN sales s ON s.branch_id = b.id
          LEFT JOIN cost_of_goods cg ON cg.branch_id = b.id
          LEFT JOIN branch_expenses be ON be.branch_id = b.id
          WHERE b.tenant_id = ${tid}
          ORDER BY net_profit DESC
        `);
        return res as unknown as ReportRow[];
      }

      case 'fund-flow': {
        // ✓ tenant_id filtered — ES-26 (fixed: real columns are debit_amount/credit_amount/created_at,
        // not amount/debit_credit/entry_date)
        const res = await db.execute(sql`
          SELECT
            CASE WHEN a.account_type IN ('ASSET') THEN 'Use of Funds'
              ELSE 'Source of Funds' END AS section,
            a.name AS description,
            CASE WHEN a.account_type NOT IN ('ASSET') THEN ABS(SUM(fe.credit_amount - fe.debit_amount)) ELSE 0 END AS source_of_fund,
            CASE WHEN a.account_type IN ('ASSET') THEN ABS(SUM(fe.debit_amount - fe.credit_amount)) ELSE 0 END AS use_of_fund
          FROM financial_entries fe
          JOIN accounts a ON a.id = fe.account_id AND a.tenant_id = ${tid}
          WHERE fe.tenant_id = ${tid}
            AND fe.created_at >= ${from}::date AND fe.created_at < (${to}::date + INTERVAL '1 day')
            AND a.account_type IN ('ASSET', 'LIABILITY', 'EQUITY')
          GROUP BY a.account_type, a.name
          HAVING ABS(SUM(fe.debit_amount - fe.credit_amount)) > 0
          ORDER BY section, description
        `);
        return res as unknown as ReportRow[];
      }

      // â”€â”€ HR REPORTS â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
      case 'payroll-report': {
        const [year, month] = (params.month ?? '2024-01').split('-');
        // ✓ tenant_id filtered — ES-05 audit. Column names corrected 2026-07-20 (this query
        // referenced e.department/ps.total_allowances/pr.pay_period_start — none of which
        // exist on the real schema; every execution failed with a SQL error).
        const res = await db.execute(sql`
          SELECT
            e.employee_code,
            CONCAT(e.first_name, ' ', e.last_name) AS employee_name,
            d.name AS department,
            ps.basic_salary,
            ps.hra_amount,
            ps.da_amount,
            ps.other_allowances,
            ps.piece_rate_amount,
            ps.gross_salary,
            ps.total_deductions AS deductions,
            ps.net_salary
          FROM payroll_slips ps
          JOIN payroll_runs pr ON pr.id = ps.payroll_run_id AND pr.tenant_id = ${tid}
          JOIN employees e ON e.id = ps.employee_id AND e.tenant_id = ${tid}
          LEFT JOIN departments d ON d.id = e.department_id AND d.tenant_id = ${tid}
          WHERE pr.tenant_id = ${tid}
            AND pr.period_year = ${Number(year)}
            AND pr.period_month = ${Number(month)}
          ORDER BY e.employee_code
        `);
        return (res as unknown as Record<string, string | null>[]).map((r) => ({
          employee_code: r['employee_code'],
          employee_name: r['employee_name'],
          department: r['department'],
          basic_salary: decryptAmount(r['basic_salary']),
          allowances:
            decryptAmount(r['hra_amount']) +
            decryptAmount(r['da_amount']) +
            decryptAmount(r['other_allowances']) +
            decryptAmount(r['piece_rate_amount']),
          gross_salary: decryptAmount(r['gross_salary']),
          deductions: decryptAmount(r['deductions']),
          net_salary: decryptAmount(r['net_salary']),
        })) as unknown as ReportRow[];
      }

      case 'attendance-report': {
        // ✓ tenant_id filtered — ES-05 audit
        const res = await db.execute(sql`
          SELECT
            e.employee_code,
            CONCAT(e.first_name, ' ', e.last_name) AS employee_name,
            COUNT(CASE WHEN a.status = 'PRESENT' THEN 1 END)::int AS present_days,
            COUNT(CASE WHEN a.status = 'ABSENT' THEN 1 END)::int AS absent_days,
            COUNT(CASE WHEN a.status = 'HALF_DAY' THEN 1 END)::int AS half_days,
            COUNT(CASE WHEN a.status = 'LEAVE' THEN 1 END)::int AS leave_days,
            COALESCE(SUM(a.overtime_hours), 0) AS overtime_hours
          FROM employees e
          LEFT JOIN attendance a ON a.employee_id = e.id AND a.tenant_id = ${tid}
            AND a.attendance_date BETWEEN ${from}::date AND ${to}::date
          WHERE e.tenant_id = ${tid}
            AND (${params.employeeId ?? null}::int IS NULL OR e.id = ${params.employeeId ?? null}::int)
          GROUP BY e.id, e.employee_code, e.first_name, e.last_name
          ORDER BY e.employee_code
        `);
        return res as unknown as ReportRow[];
      }

      case 'leave-report': {
        // ✓ tenant_id filtered — ES-05 audit. Column names corrected 2026-07-20 (referenced
        // la.leave_type/from_date/to_date/number_of_days — real columns are leave_type_id
        // (FK)/start_date/end_date/days; every execution failed with a SQL error).
        const res = await db.execute(sql`
          SELECT
            CONCAT(e.first_name, ' ', e.last_name) AS employee_name,
            lt.name AS leave_type,
            la.start_date::date AS from_date,
            la.end_date::date AS to_date,
            la.days,
            la.status,
            la.reason
          FROM leave_applications la
          JOIN employees e ON e.id = la.employee_id AND e.tenant_id = ${tid}
          LEFT JOIN leave_types lt ON lt.id = la.leave_type_id AND lt.tenant_id = ${tid}
          WHERE la.tenant_id = ${tid}
            AND la.start_date BETWEEN ${from}::date AND ${to}::date
          ORDER BY la.start_date DESC
        `);
        return res as unknown as ReportRow[];
      }

      case 'employee-master-report': {
        // ✓ tenant_id filtered — ES-05 audit. Column names corrected 2026-07-20 (referenced
        // e.department/designation/date_of_joining/contact_number as plain text columns —
        // real schema has department_id/designation_id FKs, joining_date, phone; every
        // execution failed with a SQL error).
        const res = await db.execute(sql`
          SELECT
            e.employee_code,
            CONCAT(e.first_name, ' ', e.last_name) AS employee_name,
            d.name AS department,
            des.name AS designation,
            e.joining_date::date AS date_of_joining,
            e.status,
            e.phone AS contact_number
          FROM employees e
          LEFT JOIN departments d ON d.id = e.department_id AND d.tenant_id = ${tid}
          LEFT JOIN designations des ON des.id = e.designation_id AND des.tenant_id = ${tid}
          WHERE e.tenant_id = ${tid}
            AND (${params.status ?? null}::text IS NULL OR e.status = ${params.status ?? null}::text)
          ORDER BY e.employee_code
        `);
        return res as unknown as ReportRow[];
      }

      case 'alteration-report': {
        // ✓ tenant_id filtered — ES-05 audit. Column names corrected 2026-07-20 (referenced
        // ao.alteration_number/order_date/total_pieces/assigned_tailor_id/total_charges and a
        // customers join — alteration_orders has no customer_id join needed (customer_name is
        // denormalized on the row) and none of those other columns exist; every execution
        // failed with a SQL error).
        const res = await db.execute(sql`
          SELECT
            ao.order_number AS alteration_number,
            ao.received_date::date AS date,
            COALESCE(ao.customer_name, 'Walk-in') AS customer_name,
            CONCAT(e.first_name, ' ', e.last_name) AS tailor_name,
            (SELECT COALESCE(SUM((item->>'quantity')::numeric), 0)
               FROM jsonb_array_elements(ao.items) AS item) AS total_pieces,
            ao.delivered_at::date AS delivery_date,
            ao.status,
            ao.total_amount AS charges
          FROM alteration_orders ao
          LEFT JOIN employees e ON e.id = ao.assigned_to_id AND e.tenant_id = ${tid}
          WHERE ao.tenant_id = ${tid}
            AND ao.received_date BETWEEN ${from}::date AND ${to}::date
          ORDER BY ao.received_date DESC
        `);
        return res as unknown as ReportRow[];
      }

      case 'tailor-work-log-report': {
        // ✓ tenant_id filtered — ES-05 audit
        const res = await db.execute(sql`
          SELECT
            CONCAT(e.first_name, ' ', e.last_name) AS tailor_name,
            SUM(twl.units) AS work_units,
            COUNT(DISTINCT twl.alteration_order_id)::int AS completed_orders,
            SUM(twl.amount) AS total_earnings
          FROM tailor_work_log twl
          JOIN employees e ON e.id = twl.employee_id AND e.tenant_id = ${tid}
          WHERE twl.tenant_id = ${tid}
            AND twl.work_date BETWEEN ${from}::date AND ${to}::date
            AND (${params.employeeId ?? null}::int IS NULL OR twl.employee_id = ${params.employeeId ?? null}::int)
          GROUP BY e.id, e.first_name, e.last_name
          ORDER BY total_earnings DESC
        `);
        return res as unknown as ReportRow[];
      }

      // 2026-07-20 HR audit: this module's report registry had no Salary Register,
      // Department Summary, Joining, or Exit report at all — added below.
      case 'salary-register': {
        const [year, month] = (params.month ?? '2024-01').split('-');
        const res = await db.execute(sql`
          SELECT
            e.employee_code,
            CONCAT(e.first_name, ' ', e.last_name) AS employee_name,
            d.name AS department,
            e.uan,
            ps.basic_salary,
            ps.gross_salary,
            ps.pf_employee,
            ps.esi_employee,
            ps.professional_tax,
            ps.tds_deduction,
            ps.loan_deduction,
            ps.total_deductions,
            ps.net_salary
          FROM payroll_slips ps
          JOIN payroll_runs pr ON pr.id = ps.payroll_run_id AND pr.tenant_id = ${tid}
          JOIN employees e ON e.id = ps.employee_id AND e.tenant_id = ${tid}
          LEFT JOIN departments d ON d.id = e.department_id AND d.tenant_id = ${tid}
          WHERE pr.tenant_id = ${tid}
            AND pr.period_year = ${Number(year)}
            AND pr.period_month = ${Number(month)}
          ORDER BY e.employee_code
        `);
        return (res as unknown as Record<string, string | null>[]).map((r) => ({
          employee_code: r['employee_code'],
          employee_name: r['employee_name'],
          department: r['department'],
          uan: r['uan'],
          basic_salary: decryptAmount(r['basic_salary']),
          gross_salary: decryptAmount(r['gross_salary']),
          pf_employee: decryptAmount(r['pf_employee']),
          esi_employee: decryptAmount(r['esi_employee']),
          professional_tax: decryptAmount(r['professional_tax']),
          tds_deduction: decryptAmount(r['tds_deduction']),
          loan_deduction: decryptAmount(r['loan_deduction']),
          total_deductions: decryptAmount(r['total_deductions']),
          net_salary: decryptAmount(r['net_salary']),
        })) as unknown as ReportRow[];
      }

      case 'department-summary-report': {
        const [year, month] = (params.month ?? '2024-01').split('-');
        // Headcount is as-of-now (current department assignment); payroll cost is for the
        // selected period — these can drift apart for employees who transferred departments
        // mid-period, which is expected/acceptable for a summary-level report.
        const headcountRes = await db.execute(sql`
          SELECT d.id AS department_id, d.name AS department, COUNT(e.id)::int AS headcount
          FROM departments d
          LEFT JOIN employees e ON e.department_id = d.id AND e.tenant_id = ${tid} AND e.status = 'ACTIVE'
          WHERE d.tenant_id = ${tid}
          GROUP BY d.id, d.name
          ORDER BY d.name
        `);
        const payrollRes = await db.execute(sql`
          SELECT e.department_id, ps.gross_salary, ps.net_salary
          FROM payroll_slips ps
          JOIN payroll_runs pr ON pr.id = ps.payroll_run_id AND pr.tenant_id = ${tid}
          JOIN employees e ON e.id = ps.employee_id AND e.tenant_id = ${tid}
          WHERE pr.tenant_id = ${tid} AND pr.period_year = ${Number(year)} AND pr.period_month = ${Number(month)}
        `);
        const costByDept = new Map<number | null, { gross: number; net: number }>();
        for (const row of payrollRes as unknown as {
          department_id: number | null;
          gross_salary: string;
          net_salary: string;
        }[]) {
          const existing = costByDept.get(row.department_id) ?? { gross: 0, net: 0 };
          existing.gross += decryptAmount(row.gross_salary);
          existing.net += decryptAmount(row.net_salary);
          costByDept.set(row.department_id, existing);
        }
        return (
          headcountRes as unknown as {
            department_id: number;
            department: string;
            headcount: number;
          }[]
        ).map((d) => {
          const cost = costByDept.get(d.department_id) ?? { gross: 0, net: 0 };
          return {
            department: d.department,
            headcount: d.headcount,
            total_gross_salary: Math.round(cost.gross * 100) / 100,
            total_net_salary: Math.round(cost.net * 100) / 100,
          };
        }) as unknown as ReportRow[];
      }

      case 'joining-report': {
        // ✓ tenant_id filtered
        const res = await db.execute(sql`
          SELECT
            e.employee_code,
            CONCAT(e.first_name, ' ', e.last_name) AS employee_name,
            d.name AS department,
            des.name AS designation,
            e.joining_date::date AS joining_date,
            e.employment_type
          FROM employees e
          LEFT JOIN departments d ON d.id = e.department_id AND d.tenant_id = ${tid}
          LEFT JOIN designations des ON des.id = e.designation_id AND des.tenant_id = ${tid}
          WHERE e.tenant_id = ${tid}
            AND e.joining_date BETWEEN ${from}::date AND ${to}::date
          ORDER BY e.joining_date DESC
        `);
        return res as unknown as ReportRow[];
      }

      case 'exit-report': {
        // ✓ tenant_id filtered
        const res = await db.execute(sql`
          SELECT
            e.employee_code,
            CONCAT(e.first_name, ' ', e.last_name) AS employee_name,
            d.name AS department,
            e.joining_date::date AS joining_date,
            e.exit_date::date AS exit_date,
            e.exit_reason,
            (e.exit_date - e.joining_date) AS tenure_days
          FROM employees e
          LEFT JOIN departments d ON d.id = e.department_id AND d.tenant_id = ${tid}
          WHERE e.tenant_id = ${tid}
            AND e.exit_date IS NOT NULL
            AND e.exit_date BETWEEN ${from}::date AND ${to}::date
          ORDER BY e.exit_date DESC
        `);
        return res as unknown as ReportRow[];
      }

      // â”€â”€ GST REPORTS â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
      case 'gst-register': {
        // ✓ tenant_id filtered — ES-05 audit
        const res = await db.execute(sql`
          SELECT date, document_type, document_number, party_name, gstin,
            taxable_value, cgst, sgst, igst, cgst + sgst + igst AS total_gst
          FROM (
            SELECT i.invoice_date AS date, 'Sales Invoice' AS document_type,
              i.invoice_number AS document_number,
              COALESCE(c.display_name,'Walk-in') AS party_name, COALESCE(c.gstin,'') AS gstin,
              i.subtotal AS taxable_value, i.cgst_amount AS cgst, i.sgst_amount AS sgst, i.igst_amount AS igst
            FROM invoices i LEFT JOIN customers c ON c.id = i.customer_id AND c.tenant_id = ${tid}
            WHERE i.tenant_id = ${tid} AND i.invoice_date BETWEEN ${from}::date AND ${to}::date
              AND i.status NOT IN ('CANCELLED', 'DRAFT')
              AND (${params.type ?? null}::text IS NULL OR ${params.type ?? null}::text = 'SALES')
            UNION ALL
            SELECT g.grn_date AS date, 'Purchase GRN' AS document_type,
              g.grn_number AS document_number,
              s.display_name AS party_name, COALESCE(s.gstin,'') AS gstin,
              g.subtotal AS taxable_value, g.cgst_amount AS cgst, g.sgst_amount AS sgst, g.igst_amount AS igst
            FROM grns g JOIN suppliers s ON s.id = g.supplier_id AND s.tenant_id = ${tid}
            WHERE g.tenant_id = ${tid} AND g.grn_date BETWEEN ${from}::date AND ${to}::date
              AND (${params.type ?? null}::text IS NULL OR ${params.type ?? null}::text = 'PURCHASE')
          ) combined
          ORDER BY date DESC
        `);
        return res as unknown as ReportRow[];
      }

      case 'gstr1-report': {
        // FIXED (logic bug, not a missing column): gst_rate was hardcoded to 0 despite
        // invoice_lines carrying a real per-line gst_rate — different items on the same invoice
        // can carry different rates, so this now reports at invoice+rate granularity (summing
        // each rate bucket's own taxable/tax amounts) instead of one blended, rate-less row per
        // invoice, matching how GSTR-1 is actually filed rate-by-rate.
        const res = await db.execute(sql`
          SELECT
            i.invoice_date::date AS invoice_date,
            i.invoice_number,
            COALESCE(c.gstin, 'URP') AS customer_gstin,
            COALESCE(c.display_name, 'Walk-in') AS customer_name,
            SUM(il.taxable_amount) AS taxable_value,
            il.gst_rate,
            SUM(il.cgst_amount) AS cgst,
            SUM(il.sgst_amount) AS sgst,
            SUM(il.igst_amount) AS igst
          FROM invoice_lines il
          JOIN invoices i ON i.id = il.invoice_id AND i.tenant_id = ${tid}
          LEFT JOIN customers c ON c.id = i.customer_id AND c.tenant_id = ${tid}
          WHERE i.tenant_id = ${tid}
            AND i.invoice_date BETWEEN ${from}::date AND ${to}::date
            AND i.status NOT IN ('CANCELLED', 'DRAFT')
          GROUP BY i.id, i.invoice_date, i.invoice_number, c.gstin, c.display_name, il.gst_rate
          ORDER BY i.invoice_date, i.invoice_number, il.gst_rate
        `);
        return res as unknown as ReportRow[];
      }

      case 'gstr3b-report': {
        // ✓ tenant_id filtered — ES-05 audit
        const res = await db.execute(sql`
          SELECT
            'Outward supplies' AS section,
            'Total taxable outward supplies' AS description,
            SUM(i.subtotal) AS taxable_value,
            SUM(i.igst_amount) AS igst,
            SUM(i.cgst_amount) AS cgst,
            SUM(i.sgst_amount) AS sgst
          FROM invoices i
          WHERE i.tenant_id = ${tid}
            AND i.invoice_date BETWEEN ${from}::date AND ${to}::date
            AND i.status NOT IN ('CANCELLED', 'DRAFT')
          UNION ALL
          SELECT
            'Inward supplies (ITC)',
            'Total eligible ITC',
            SUM(g.subtotal),
            SUM(g.igst_amount),
            SUM(g.cgst_amount),
            SUM(g.sgst_amount)
          FROM grns g
          WHERE g.tenant_id = ${tid}
            AND g.grn_date BETWEEN ${from}::date AND ${to}::date
        `);
        return res as unknown as ReportRow[];
      }

      case 'itc-register': {
        // ✓ tenant_id filtered — ES-05 audit
        const res = await db.execute(sql`
          SELECT
            g.grn_date::date AS grn_date,
            g.grn_number,
            s.display_name AS supplier_name,
            COALESCE(s.gstin, '') AS supplier_gstin,
            g.subtotal AS taxable_value,
            g.igst_amount AS igst_credit,
            g.cgst_amount AS cgst_credit,
            g.sgst_amount AS sgst_credit
          FROM grns g
          JOIN suppliers s ON s.id = g.supplier_id AND s.tenant_id = ${tid}
          WHERE g.tenant_id = ${tid}
            AND g.grn_date BETWEEN ${from}::date AND ${to}::date
            AND g.status = 'APPROVED'
          ORDER BY g.grn_date DESC
        `);
        return res as unknown as ReportRow[];
      }

      case 'gst-payable-report': {
        // ✓ tenant_id filtered — ES-05 audit
        // Cached 3 minutes (ES-26 / M7) — report-service has no other Redis-backed cache today.
        const cacheKey = `gst-payable-report:${from}:${to}`;
        const cache = this.redis ? new TenantScopedCache(this.redis, tid) : undefined;
        if (cache) {
          // Cache is best-effort — an unreachable Redis must fall back to Postgres, not 500 the report.
          const cached = await cache.getJson<ReportRow[]>(cacheKey).catch(() => null);
          if (cached) return cached;
        }
        const res = await db.execute(sql`
          SELECT
            'CGST' AS gst_type,
            COALESCE(SUM(i.cgst_amount), 0) AS output_tax,
            COALESCE((SELECT SUM(g.cgst_amount) FROM grns g WHERE g.tenant_id = ${tid}
              AND g.grn_date BETWEEN ${from}::date AND ${to}::date), 0) AS itc_available,
            GREATEST(COALESCE(SUM(i.cgst_amount), 0) - COALESCE((SELECT SUM(g.cgst_amount) FROM grns g WHERE g.tenant_id = ${tid}
              AND g.grn_date BETWEEN ${from}::date AND ${to}::date), 0), 0) AS net_payable
          FROM invoices i WHERE i.tenant_id = ${tid}
            AND i.invoice_date BETWEEN ${from}::date AND ${to}::date AND i.status != 'CANCELLED'
          UNION ALL
          SELECT
            'SGST',
            COALESCE(SUM(i.sgst_amount), 0),
            COALESCE((SELECT SUM(g.sgst_amount) FROM grns g WHERE g.tenant_id = ${tid}
              AND g.grn_date BETWEEN ${from}::date AND ${to}::date), 0),
            GREATEST(COALESCE(SUM(i.sgst_amount), 0) - COALESCE((SELECT SUM(g.sgst_amount) FROM grns g WHERE g.tenant_id = ${tid}
              AND g.grn_date BETWEEN ${from}::date AND ${to}::date), 0), 0)
          FROM invoices i WHERE i.tenant_id = ${tid}
            AND i.invoice_date BETWEEN ${from}::date AND ${to}::date AND i.status != 'CANCELLED'
          UNION ALL
          SELECT
            'IGST',
            COALESCE(SUM(i.igst_amount), 0),
            COALESCE((SELECT SUM(g.igst_amount) FROM grns g WHERE g.tenant_id = ${tid}
              AND g.grn_date BETWEEN ${from}::date AND ${to}::date), 0),
            GREATEST(COALESCE(SUM(i.igst_amount), 0) - COALESCE((SELECT SUM(g.igst_amount) FROM grns g WHERE g.tenant_id = ${tid}
              AND g.grn_date BETWEEN ${from}::date AND ${to}::date), 0), 0)
          FROM invoices i WHERE i.tenant_id = ${tid}
            AND i.invoice_date BETWEEN ${from}::date AND ${to}::date AND i.status != 'CANCELLED'
        `);
        const rows = res as unknown as ReportRow[];
        if (cache)
          await cache.setJson(cacheKey, rows, GST_PAYABLE_CACHE_TTL_SECONDS).catch(() => undefined);
        return rows;
      }

      case 'reverse-charge-report': {
        // ✓ tenant_id filtered — ES-05 audit
        const res = await db.execute(sql`
          SELECT
            g.grn_date::date AS date,
            g.grn_number AS document_number,
            s.display_name AS party_name,
            g.subtotal AS taxable_value,
            g.igst_amount + g.cgst_amount + g.sgst_amount AS rcm_tax,
            'Section 9(3)/9(4)' AS section
          FROM grns g
          JOIN suppliers s ON s.id = g.supplier_id AND s.tenant_id = ${tid}
          WHERE g.tenant_id = ${tid}
            AND (s.gstin IS NULL OR LENGTH(s.gstin) < 15)
            AND g.grn_date BETWEEN ${from}::date AND ${to}::date
          ORDER BY g.grn_date DESC
        `);
        return res as unknown as ReportRow[];
      }

      // ── AR / AP AGING REPORTS ──────────────────────────────────────────────────
      case 'ar-aging': {
        const asOf = params.asOfDate ?? new Date().toISOString().slice(0, 10);
        // M-12 fix: this bucketed by invoice_date ("how old is this invoice") while
        // outstanding-receivables bucketed the exact same concept by due_date ("how overdue is
        // this receivable") — the same tenant got two different answers for "days overdue"
        // depending which report they ran. due_date is the standard AR-ageing convention (a
        // 45-day-old invoice on 60-day terms isn't overdue at all); aligned to match.
        // ✓ tenant_id filtered — ES-05 audit
        const res = await db.execute(sql`
          SELECT
            COALESCE(c.display_name, 'Walk-in') AS customer_name,
            SUM(CASE WHEN (${asOf}::date - i.due_date::date) BETWEEN 0 AND 30
              THEN (i.grand_total - COALESCE(i.paid_amount, 0)) ELSE 0 END) AS days0to30,
            SUM(CASE WHEN (${asOf}::date - i.due_date::date) BETWEEN 31 AND 60
              THEN (i.grand_total - COALESCE(i.paid_amount, 0)) ELSE 0 END) AS days31to60,
            SUM(CASE WHEN (${asOf}::date - i.due_date::date) BETWEEN 61 AND 90
              THEN (i.grand_total - COALESCE(i.paid_amount, 0)) ELSE 0 END) AS days61to90,
            SUM(CASE WHEN (${asOf}::date - i.due_date::date) > 90
              THEN (i.grand_total - COALESCE(i.paid_amount, 0)) ELSE 0 END) AS days90plus,
            SUM(i.grand_total - COALESCE(i.paid_amount, 0)) AS total_outstanding
          FROM invoices i
          LEFT JOIN customers c ON c.id = i.customer_id AND c.tenant_id = ${tid}
          WHERE i.tenant_id = ${tid}
            AND i.invoice_date::date <= ${asOf}::date
            AND i.status NOT IN ('CANCELLED', 'DRAFT')
            AND (i.grand_total - COALESCE(i.paid_amount, 0)) > 0
            AND (${params.branchId ?? null}::int IS NULL OR i.branch_id = ${params.branchId ?? null}::int)
          GROUP BY c.id, c.display_name
          ORDER BY total_outstanding DESC
        `);
        return res as unknown as ReportRow[];
      }

      case 'ap-aging': {
        const asOf = params.asOfDate ?? new Date().toISOString().slice(0, 10);
        // FIXED: grns has no paid_amount column at all — paid amount is summed from
        // supplier_payment_allocations, the real GRN-level payment link, same fix as
        // outstanding-payables above.
        const res = await db.execute(sql`
          SELECT
            s.display_name AS supplier_name,
            SUM(CASE WHEN (${asOf}::date - g.grn_date::date) BETWEEN 0 AND 30
              THEN (g.grand_total - COALESCE(spa.paid_amount, 0)) ELSE 0 END) AS days0to30,
            SUM(CASE WHEN (${asOf}::date - g.grn_date::date) BETWEEN 31 AND 60
              THEN (g.grand_total - COALESCE(spa.paid_amount, 0)) ELSE 0 END) AS days31to60,
            SUM(CASE WHEN (${asOf}::date - g.grn_date::date) BETWEEN 61 AND 90
              THEN (g.grand_total - COALESCE(spa.paid_amount, 0)) ELSE 0 END) AS days61to90,
            SUM(CASE WHEN (${asOf}::date - g.grn_date::date) > 90
              THEN (g.grand_total - COALESCE(spa.paid_amount, 0)) ELSE 0 END) AS days90plus,
            SUM(g.grand_total - COALESCE(spa.paid_amount, 0)) AS total_outstanding
          FROM grns g
          JOIN suppliers s ON s.id = g.supplier_id AND s.tenant_id = ${tid}
          LEFT JOIN (
            SELECT grn_id, SUM(amount) AS paid_amount
            FROM supplier_payment_allocations WHERE tenant_id = ${tid} GROUP BY grn_id
          ) spa ON spa.grn_id = g.id
          WHERE g.tenant_id = ${tid}
            AND g.grn_date::date <= ${asOf}::date
            AND g.status NOT IN ('CANCELLED')
            AND (g.grand_total - COALESCE(spa.paid_amount, 0)) > 0
            AND (${params.supplierId ?? null}::int IS NULL OR g.supplier_id = ${params.supplierId ?? null}::int)
          GROUP BY s.id, s.display_name
          ORDER BY total_outstanding DESC
        `);
        return res as unknown as ReportRow[];
      }

      // ── ANALYTICS REPORTS (ES-17) ───────────────────────────────────────────────
      case 'sales-revenue-trend': {
        const toDate = params.toDate ?? new Date().toISOString().slice(0, 10);
        const fromDate = params.fromDate ?? defaultTrendFromDate();
        // ✓ tenant_id filtered — ES-17
        const res = await db.execute(sql`
          SELECT
            TO_CHAR(DATE_TRUNC('month', i.invoice_date), 'YYYY-MM') AS month,
            COUNT(i.id)::int AS invoice_count,
            SUM(i.grand_total) AS revenue
          FROM invoices i
          WHERE i.tenant_id = ${tid}
            AND i.invoice_date BETWEEN ${fromDate}::date AND ${toDate}::date
            AND i.status != 'CANCELLED'
          GROUP BY DATE_TRUNC('month', i.invoice_date)
          ORDER BY DATE_TRUNC('month', i.invoice_date)
        `);
        return res as unknown as ReportRow[];
      }

      case 'inventory-analytics': {
        const fastThreshold = Number(p(params.fastMoverThreshold, 10));
        // ✓ tenant_id filtered — ES-17
        const res = await db.execute(sql`
          WITH consumption AS (
            SELECT item_id, SUM(quantity) AS qty_30d
            FROM inventory_ledger
            WHERE tenant_id = ${tid} AND movement_type = 'STOCK_OUT'
              AND created_at >= (CURRENT_DATE - INTERVAL '30 days')
            GROUP BY item_id
          ),
          last_sale AS (
            SELECT item_id, MAX(created_at)::date AS last_sale_date
            FROM inventory_ledger
            WHERE tenant_id = ${tid} AND movement_type = 'STOCK_OUT'
            GROUP BY item_id
          ),
          stock AS (
            SELECT item_id, SUM(available_qty) AS qty
            FROM projection_stock_level
            WHERE tenant_id = ${tid}
            GROUP BY item_id
          )
          SELECT
            it.item_code,
            it.name AS item_name,
            cat.name AS category,
            COALESCE(stock.qty, 0) AS current_stock,
            CASE WHEN COALESCE(c.qty_30d, 0) > 0
              THEN ROUND((COALESCE(stock.qty, 0) / (c.qty_30d / 30.0))::numeric, 1)
              ELSE NULL
            END AS days_of_supply,
            ls.last_sale_date,
            CASE
              WHEN COALESCE(stock.qty, 0) <= 0 THEN 'STOCKOUT'
              WHEN COALESCE(c.qty_30d, 0) >= ${fastThreshold} THEN 'FAST'
              ELSE 'SLOW'
            END AS status
          FROM items it
          LEFT JOIN categories cat ON cat.id = it.category_id
          LEFT JOIN stock ON stock.item_id = it.id
          LEFT JOIN consumption c ON c.item_id = it.id
          LEFT JOIN last_sale ls ON ls.item_id = it.id
          WHERE it.tenant_id = ${tid}
          ORDER BY status, item_name
        `);
        return res as unknown as ReportRow[];
      }

      case 'purchase-analytics': {
        const toDate = params.toDate ?? new Date().toISOString().slice(0, 10);
        const fromDate = params.fromDate ?? defaultTrendFromDate();
        // ✓ tenant_id filtered
        const res = await db.execute(sql`
          SELECT
            TO_CHAR(DATE_TRUNC('month', g.grn_date), 'YYYY-MM') AS month,
            COUNT(g.id)::int AS grn_count,
            SUM(g.grand_total) AS spend,
            SUM(CASE WHEN g.has_price_variance THEN 1 ELSE 0 END)::int AS price_variance_count
          FROM grns g
          WHERE g.tenant_id = ${tid}
            AND g.status = 'APPROVED'
            AND g.grn_date BETWEEN ${fromDate}::date AND ${toDate}::date
          GROUP BY DATE_TRUNC('month', g.grn_date)
          ORDER BY DATE_TRUNC('month', g.grn_date)
        `);
        return res as unknown as ReportRow[];
      }

      case 'supplier-performance': {
        const toDate = params.toDate ?? new Date().toISOString().slice(0, 10);
        const fromDate = params.fromDate ?? defaultTrendFromDate();
        // ✓ tenant_id filtered
        const res = await db.execute(sql`
          WITH grn_stats AS (
            SELECT
              g.supplier_id,
              COUNT(g.id)::int AS grn_count,
              SUM(g.grand_total) AS total_purchased,
              SUM(CASE WHEN g.has_price_variance THEN 1 ELSE 0 END)::int AS variance_count,
              SUM(CASE WHEN po.expected_delivery_date IS NOT NULL
                    AND g.grn_date::date <= po.expected_delivery_date::date THEN 1 ELSE 0 END)::int AS on_time_count,
              SUM(CASE WHEN po.expected_delivery_date IS NOT NULL THEN 1 ELSE 0 END)::int AS delivery_tracked_count
            FROM grns g
            LEFT JOIN purchase_orders po ON po.id = g.purchase_order_id AND po.tenant_id = g.tenant_id
            WHERE g.tenant_id = ${tid}
              AND g.status = 'APPROVED'
              AND g.grn_date BETWEEN ${fromDate}::date AND ${toDate}::date
            GROUP BY g.supplier_id
          ),
          return_stats AS (
            SELECT supplier_id, COUNT(id)::int AS return_count
            FROM purchase_returns
            WHERE tenant_id = ${tid} AND status = 'APPROVED'
            GROUP BY supplier_id
          )
          SELECT
            s.display_name AS supplier_name,
            gs.grn_count,
            gs.total_purchased,
            CASE WHEN gs.delivery_tracked_count > 0
              THEN ROUND((gs.on_time_count::numeric / gs.delivery_tracked_count) * 100, 1)
              ELSE NULL
            END AS on_time_delivery_pct,
            CASE WHEN gs.grn_count > 0
              THEN ROUND((gs.variance_count::numeric / gs.grn_count) * 100, 1)
              ELSE 0
            END AS price_variance_pct,
            CASE WHEN gs.grn_count > 0
              THEN ROUND((COALESCE(rs.return_count, 0)::numeric / gs.grn_count) * 100, 1)
              ELSE 0
            END AS return_rate_pct
          FROM grn_stats gs
          JOIN suppliers s ON s.id = gs.supplier_id AND s.tenant_id = ${tid}
          LEFT JOIN return_stats rs ON rs.supplier_id = gs.supplier_id
          ORDER BY gs.total_purchased DESC
        `);
        return res as unknown as ReportRow[];
      }

      case 'hr-headcount-by-department': {
        // ✓ tenant_id filtered — ES-17
        const res = await db.execute(sql`
          SELECT
            COALESCE(d.name, 'Unassigned') AS department,
            COUNT(e.id)::int AS headcount
          FROM employees e
          LEFT JOIN departments d ON d.id = e.department_id AND d.tenant_id = ${tid}
          WHERE e.tenant_id = ${tid}
            AND e.status = 'ACTIVE'
          GROUP BY d.id, d.name
          ORDER BY headcount DESC
        `);
        return res as unknown as ReportRow[];
      }

      case 'hr-salary-cost-trend': {
        const fromYm = params.fromDate ?? from;
        const toYm = params.toDate ?? to;
        // FIXED: basic_salary/hra_amount/da_amount/other_allowances/piece_rate_amount/
        // total_deductions are all AES-256-GCM ciphertext (text) as of migration 0085 — this
        // report predates that migration and still summed them in raw SQL ("text + text"/
        // SUM(text) is invalid Postgres and errors on every run). Fetches raw rows per
        // employee-month instead and aggregates decrypted values in JS, same pattern as
        // payroll-report/salary-register/department-summary-report elsewhere in this file.
        const rows = (await db.execute(sql`
          SELECT
            pr.period_year, pr.period_month, ps.employee_id,
            ps.basic_salary, ps.hra_amount, ps.da_amount, ps.other_allowances, ps.piece_rate_amount,
            ps.total_deductions
          FROM payroll_slips ps
          JOIN payroll_runs pr ON pr.id = ps.payroll_run_id AND pr.tenant_id = ${tid}
          WHERE pr.tenant_id = ${tid}
            AND (pr.period_year * 100 + pr.period_month)
              BETWEEN (EXTRACT(YEAR FROM ${fromYm}::date)::int * 100 + EXTRACT(MONTH FROM ${fromYm}::date)::int)
              AND (EXTRACT(YEAR FROM ${toYm}::date)::int * 100 + EXTRACT(MONTH FROM ${toYm}::date)::int)
        `)) as unknown as Array<{
          period_year: number;
          period_month: number;
          employee_id: number;
          basic_salary: string | null;
          hra_amount: string | null;
          da_amount: string | null;
          other_allowances: string | null;
          piece_rate_amount: string | null;
          total_deductions: string | null;
        }>;

        const byMonth = new Map<
          string,
          { employees: Set<number>; gross: number; deductions: number }
        >();
        for (const r of rows) {
          const month = `${r.period_year}-${String(r.period_month).padStart(2, '0')}`;
          const bucket = byMonth.get(month) ?? {
            employees: new Set<number>(),
            gross: 0,
            deductions: 0,
          };
          bucket.employees.add(r.employee_id);
          bucket.gross +=
            decryptAmount(r.basic_salary) +
            decryptAmount(r.hra_amount) +
            decryptAmount(r.da_amount) +
            decryptAmount(r.other_allowances) +
            decryptAmount(r.piece_rate_amount);
          bucket.deductions += decryptAmount(r.total_deductions);
          byMonth.set(month, bucket);
        }

        return Array.from(byMonth.entries())
          .sort(([a], [b]) => (a < b ? -1 : 1))
          .map(([month, b]) => ({
            month,
            employee_count: b.employees.size,
            gross_salary_cost: Math.round(b.gross * 100) / 100,
            total_deductions: Math.round(b.deductions * 100) / 100,
          })) as unknown as ReportRow[];
      }

      case 'hr-hires-vs-exits': {
        const fromYm = params.fromDate ?? from;
        const toYm = params.toDate ?? to;
        // ✓ tenant_id filtered — ES-17
        const res = await db.execute(sql`
          WITH months AS (
            SELECT generate_series(DATE_TRUNC('month', ${fromYm}::date), DATE_TRUNC('month', ${toYm}::date), INTERVAL '1 month') AS month
          )
          SELECT
            TO_CHAR(m.month, 'YYYY-MM') AS month,
            COUNT(DISTINCT CASE WHEN DATE_TRUNC('month', e.joining_date) = m.month THEN e.id END)::int AS new_hires,
            COUNT(DISTINCT CASE WHEN DATE_TRUNC('month', e.exit_date) = m.month THEN e.id END)::int AS exits
          FROM months m
          LEFT JOIN employees e ON e.tenant_id = ${tid}
            AND (DATE_TRUNC('month', e.joining_date) = m.month OR DATE_TRUNC('month', e.exit_date) = m.month)
          GROUP BY m.month
          ORDER BY m.month
        `);
        return res as unknown as ReportRow[];
      }

      case 'hr-gender-diversity': {
        // ✓ tenant_id filtered — ES-17
        const res = await db.execute(sql`
          SELECT
            COALESCE(e.gender, 'UNSPECIFIED') AS gender,
            COUNT(e.id)::int AS headcount
          FROM employees e
          WHERE e.tenant_id = ${tid}
            AND e.status = 'ACTIVE'
          GROUP BY e.gender
          ORDER BY headcount DESC
        `);
        return res as unknown as ReportRow[];
      }

      default:
        throw new Error(`Unknown report slug: ${slug}`);
    }
  }
}
