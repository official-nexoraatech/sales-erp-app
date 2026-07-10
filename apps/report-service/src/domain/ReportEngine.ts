import { sql } from 'drizzle-orm';
import type { ErpDatabase, ReplicaRouter } from '@erp/db';
import type Redis from 'ioredis';
import { TenantScopedCache } from '@erp/sdk';

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

  async generate(slug: string, tenantId: number, params: ReportParams): Promise<ReportResult> {
    const rawRows = await this.runQuery(slug, tenantId, params);
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

  private async runQuery(slug: string, tenantId: number, params: ReportParams): Promise<ReportRow[]> {
    const db = this.replicaRouter ? await this.replicaRouter.forRead() : this.db;
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
            AND i.status != 'CANCELLED'
            AND (${params.branchId ?? null}::int IS NULL OR i.branch_id = ${params.branchId ?? null}::int)
          GROUP BY c.id, c.display_name, c.phone
          ORDER BY total_sales DESC
        `);
        return res as unknown as ReportRow[];
      }

      case 'sales-by-item': {
        // ✓ tenant_id filtered — ES-05 audit
        const res = await db.execute(sql`
          SELECT
            it.item_code,
            it.name AS item_name,
            cat.name AS category,
            SUM(il.quantity) AS quantity_sold,
            u.symbol AS unit,
            SUM(il.line_total) AS revenue,
            SUM(il.quantity * COALESCE(il.cost_price, 0)) AS cogs,
            SUM(il.line_total) - SUM(il.quantity * COALESCE(il.cost_price, 0)) AS gross_profit,
            CASE WHEN SUM(il.line_total) > 0 THEN
              ROUND(((SUM(il.line_total) - SUM(il.quantity * COALESCE(il.cost_price, 0))) / SUM(il.line_total) * 100)::numeric, 2)
            ELSE 0 END AS gross_margin
          FROM invoice_lines il
          JOIN invoices i ON i.id = il.invoice_id AND i.tenant_id = ${tid}
          JOIN items it ON it.id = il.item_id AND it.tenant_id = ${tid}
          LEFT JOIN categories cat ON cat.id = it.category_id
          LEFT JOIN units u ON u.id = it.unit_id
          WHERE i.tenant_id = ${tid}
            AND i.invoice_date BETWEEN ${from}::date AND ${to}::date
            AND i.status != 'CANCELLED'
            AND (${params.categoryId ?? null}::int IS NULL OR it.category_id = ${params.categoryId ?? null}::int)
            AND (${params.branchId ?? null}::int IS NULL OR i.branch_id = ${params.branchId ?? null}::int)
          GROUP BY it.id, it.item_code, it.name, cat.name, u.symbol
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
              AND i.status != 'CANCELLED'
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
            AND i.status != 'CANCELLED'
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
            AND i.status != 'CANCELLED'
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
            AND i.status NOT IN ('CANCELLED', 'PAID')
            AND (${params.customerId ?? null}::int IS NULL OR i.customer_id = ${params.customerId ?? null}::int)
          ORDER BY days_bucket DESC, balance_due DESC
        `);
        return res as unknown as ReportRow[];
      }

      case 'customer-ledger': {
        // ✓ tenant_id filtered — ES-05 audit
        const res = await db.execute(sql`
          SELECT date, type, reference, debit, credit,
            SUM(debit - credit) OVER (ORDER BY date, id) AS balance
          FROM (
            SELECT i.invoice_date AS date, 'Invoice' AS type, i.invoice_number AS reference,
              i.grand_total AS debit, 0 AS credit, i.id
            FROM invoices i
            WHERE i.tenant_id = ${tid} AND i.customer_id = ${params.customerId ?? 0}::int
              AND i.invoice_date BETWEEN ${from}::date AND ${to}::date AND i.status != 'CANCELLED'
            UNION ALL
            SELECT p.payment_date AS date, 'Payment' AS type, p.receipt_number AS reference,
              0 AS debit, p.amount AS credit, p.id
            FROM payments p
            WHERE p.tenant_id = ${tid} AND p.customer_id = ${params.customerId ?? 0}::int
              AND p.payment_date BETWEEN ${from}::date AND ${to}::date
            UNION ALL
            SELECT cn.issued_date AS date, 'Credit Note' AS type, cn.credit_note_number AS reference,
              0 AS debit, cn.amount AS credit, cn.id
            FROM credit_notes cn
            WHERE cn.tenant_id = ${tid} AND cn.customer_id = ${params.customerId ?? 0}::int
              AND cn.issued_date BETWEEN ${from}::date AND ${to}::date
          ) sub
          ORDER BY date, id
        `);
        return res as unknown as ReportRow[];
      }

      case 'payment-collection-report': {
        // ✓ tenant_id filtered — ES-05 audit
        const res = await db.execute(sql`
          SELECT
            p.payment_date::date AS payment_date,
            p.receipt_number,
            COALESCE(c.display_name, 'Walk-in') AS customer_name,
            p.payment_mode AS mode,
            p.amount,
            p.reference_number AS reference
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
        // ✓ tenant_id filtered — ES-05 audit
        const res = await db.execute(sql`
          SELECT
            cn.credit_note_number,
            cn.issued_date::date AS date,
            COALESCE(c.display_name, 'Walk-in') AS customer_name,
            cn.reason,
            cn.amount,
            cn.status
          FROM credit_notes cn
          LEFT JOIN customers c ON c.id = cn.customer_id AND c.tenant_id = ${tid}
          WHERE cn.tenant_id = ${tid}
            AND cn.issued_date BETWEEN ${from}::date AND ${to}::date
          ORDER BY cn.issued_date DESC
        `);
        return res as unknown as ReportRow[];
      }

      case 'sales-return-report': {
        // ✓ tenant_id filtered — ES-05 audit
        const res = await db.execute(sql`
          SELECT
            sr.return_number,
            sr.return_date::date AS date,
            i.invoice_number AS original_invoice,
            COALESCE(c.display_name, 'Walk-in') AS customer_name,
            sr.total_return_amount AS return_amount,
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
        // ✓ tenant_id filtered — ES-05 audit
        const res = await db.execute(sql`
          SELECT
            dc.challan_number,
            dc.challan_date::date AS date,
            COALESCE(c.display_name, 'Walk-in') AS customer_name,
            dc.total_quantity AS total_qty,
            dc.total_value,
            dc.status,
            i.invoice_number AS converted_invoice
          FROM delivery_challans dc
          LEFT JOIN customers c ON c.id = dc.customer_id AND c.tenant_id = ${tid}
          LEFT JOIN invoices i ON i.id = dc.converted_invoice_id
          WHERE dc.tenant_id = ${tid}
            AND dc.challan_date BETWEEN ${from}::date AND ${to}::date
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
        // ✓ tenant_id filtered — ES-05 audit
        const res = await db.execute(sql`
          SELECT
            i.invoice_date::date AS date,
            CONCAT(u.first_name, ' ', u.last_name) AS cashier,
            COUNT(DISTINCT i.id)::int AS total_transactions,
            SUM(CASE WHEN p.payment_mode = 'CASH' THEN p.amount ELSE 0 END) AS cash_sales,
            SUM(CASE WHEN p.payment_mode = 'CARD' THEN p.amount ELSE 0 END) AS card_sales,
            SUM(CASE WHEN p.payment_mode = 'UPI' THEN p.amount ELSE 0 END) AS upi_sales,
            SUM(DISTINCT i.grand_total) AS total_sales
          FROM invoices i
          JOIN users u ON u.id = i.created_by AND u.tenant_id = ${tid}
          JOIN payments p ON p.invoice_id = i.id AND p.tenant_id = ${tid}
          WHERE i.tenant_id = ${tid}
            AND i.invoice_date BETWEEN ${from}::date AND ${to}::date
            AND p.pos_session_id IS NOT NULL
            AND i.status != 'CANCELLED'
            AND (${params.branchId ?? null}::int IS NULL OR i.branch_id = ${params.branchId ?? null}::int)
          GROUP BY i.invoice_date::date, u.id, u.first_name, u.last_name
          ORDER BY i.invoice_date::date DESC
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
            AND i.status != 'CANCELLED'
          GROUP BY it.id, it.name, cat.name
          ORDER BY ${sortCol === 'revenue' ? sql`revenue` : sql`quantity_sold`} DESC
          LIMIT ${lim}
        `);
        return res as unknown as ReportRow[];
      }

      case 'slow-moving-items': {
        const maxQty = Number(p(params.maxSalesQty, 5));
        // ✓ tenant_id filtered — ES-05 audit
        const res = await db.execute(sql`
          SELECT
            it.item_code,
            it.name AS item_name,
            cat.name AS category,
            COALESCE(sl.quantity_on_hand, 0) AS current_stock,
            COALESCE(sales.qty_sold, 0) AS quantity_sold,
            sales.last_sale_date
          FROM items it
          LEFT JOIN categories cat ON cat.id = it.category_id
          LEFT JOIN (
            SELECT item_id, SUM(quantity_on_hand) AS quantity_on_hand
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
            AND COALESCE(sl.quantity_on_hand, 0) > 0
          ORDER BY quantity_sold ASC, current_stock DESC
        `);
        return res as unknown as ReportRow[];
      }

      case 'customer-statement': {
        // ✓ tenant_id filtered — ES-05 audit
        const res = await db.execute(sql`
          SELECT date, description, debit, credit,
            SUM(debit - credit) OVER (ORDER BY date, id) AS balance
          FROM (
            SELECT i.invoice_date AS date, CONCAT('Invoice - ', i.invoice_number) AS description,
              i.grand_total AS debit, 0 AS credit, i.id
            FROM invoices i
            WHERE i.tenant_id = ${tid} AND i.customer_id = ${params.customerId ?? 0}::int
              AND i.invoice_date BETWEEN ${from}::date AND ${to}::date AND i.status != 'CANCELLED'
            UNION ALL
            SELECT p.payment_date AS date, CONCAT('Payment - ', p.receipt_number) AS description,
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
        // ✓ tenant_id filtered — ES-05 audit
        const res = await db.execute(sql`
          SELECT
            c.display_name AS customer_name,
            c.phone,
            c.loyalty_points AS closing_points,
            0 AS opening_points,
            0 AS earned,
            0 AS redeemed
          FROM customers c
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
            AND i.status != 'CANCELLED'
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
        // ✓ tenant_id filtered — ES-05 audit
        const res = await db.execute(sql`
          SELECT
            it.item_code,
            it.name AS item_name,
            SUM(gl.quantity_received) AS quantity_received,
            SUM(gl.quantity_received * gl.unit_cost) AS total_cost,
            CASE WHEN SUM(gl.quantity_received) > 0 THEN
              ROUND((SUM(gl.quantity_received * gl.unit_cost) / SUM(gl.quantity_received))::numeric, 4)
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
        // ✓ tenant_id filtered — ES-05 audit
        const res = await db.execute(sql`
          SELECT
            s.display_name AS supplier_name,
            g.grn_number,
            g.grn_date::date AS grn_date,
            g.due_date::date AS due_date,
            g.grand_total AS total_amount,
            COALESCE(g.paid_amount, 0) AS paid_amount,
            g.grand_total - COALESCE(g.paid_amount, 0) AS balance_due,
            CASE
              WHEN (${asOf}::date - g.due_date::date) <= 0 THEN 'Current'
              WHEN (${asOf}::date - g.due_date::date) <= 30 THEN '1-30 days'
              WHEN (${asOf}::date - g.due_date::date) <= 60 THEN '31-60 days'
              WHEN (${asOf}::date - g.due_date::date) <= 90 THEN '61-90 days'
              ELSE '90+ days'
            END AS days_bucket
          FROM grns g
          JOIN suppliers s ON s.id = g.supplier_id AND s.tenant_id = ${tid}
          WHERE g.tenant_id = ${tid}
            AND g.grn_date <= ${asOf}::date
            AND (g.grand_total - COALESCE(g.paid_amount, 0)) > 0
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
        // ✓ tenant_id filtered — ES-05 audit
        const res = await db.execute(sql`
          SELECT
            po.po_number,
            po.po_date::date AS po_date,
            s.display_name AS supplier_name,
            COALESCE(SUM(pol.quantity), 0) AS ordered_qty,
            COALESCE(SUM(pol.received_quantity), 0) AS received_qty,
            COALESCE(SUM(pol.quantity - pol.received_quantity), 0) AS pending_qty,
            po.grand_total AS total_value,
            po.status
          FROM purchase_orders po
          JOIN suppliers s ON s.id = po.supplier_id AND s.tenant_id = ${tid}
          LEFT JOIN purchase_order_lines pol ON pol.po_id = po.id
          WHERE po.tenant_id = ${tid}
            AND po.po_date BETWEEN ${from}::date AND ${to}::date
            AND (${params.status ?? null}::text IS NULL OR po.status = ${params.status ?? null}::text)
          GROUP BY po.id, po.po_number, po.po_date, s.display_name, po.grand_total, po.status
          ORDER BY po.po_date DESC
        `);
        return res as unknown as ReportRow[];
      }

      case 'purchase-return-report': {
        // ✓ tenant_id filtered — ES-05 audit
        const res = await db.execute(sql`
          SELECT
            pr.return_number,
            pr.return_date::date AS date,
            s.display_name AS supplier_name,
            g.grn_number AS original_grn,
            pr.total_return_amount AS return_amount,
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
        // ✓ tenant_id filtered — ES-05 audit
        const res = await db.execute(sql`
          SELECT
            g.grn_number,
            g.grn_date::date AS grn_date,
            s.display_name AS supplier_name,
            w.name AS warehouse_name,
            COUNT(gl.id)::int AS item_count,
            SUM(gl.quantity_received) AS total_qty,
            SUM(gl.quantity_received * gl.unit_cost) AS total_value,
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
        // ✓ tenant_id filtered — ES-05 audit
        const res = await db.execute(sql`
          SELECT
            e.expense_date::date AS date,
            e.expense_number,
            e.vendor_name AS vendor,
            e.expense_category AS category,
            e.description,
            e.amount,
            e.gst_amount AS gst
          FROM expenses e
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
        // ✓ tenant_id filtered — ES-05 audit
        const res = await db.execute(sql`
          SELECT
            sp.payment_date::date AS payment_date,
            sp.payment_number,
            s.display_name AS supplier_name,
            sp.payment_mode AS mode,
            sp.amount,
            sp.reference_number AS reference
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
        // ✓ tenant_id filtered — ES-05 audit
        const res = await db.execute(sql`
          SELECT
            g.grn_date::date AS date,
            g.grn_number,
            s.display_name AS supplier_name,
            gl.quantity_received AS quantity,
            gl.unit_cost
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
        // ✓ tenant_id filtered — ES-05 audit
        const res = await db.execute(sql`
          SELECT
            it.item_code,
            it.name AS item_name,
            cat.name AS category,
            w.name AS warehouse,
            psl.quantity_on_hand,
            it.reorder_level,
            psl.fifo_unit_cost AS valuation_cost,
            psl.quantity_on_hand * COALESCE(psl.fifo_unit_cost, 0) AS total_value
          FROM projection_stock_level psl
          JOIN items it ON it.id = psl.item_id AND it.tenant_id = ${tid}
          JOIN warehouses w ON w.id = psl.warehouse_id AND w.tenant_id = ${tid}
          LEFT JOIN categories cat ON cat.id = it.category_id
          WHERE psl.tenant_id = ${tid}
            AND psl.quantity_on_hand > 0
            AND (${params.warehouseId ?? null}::int IS NULL OR psl.warehouse_id = ${params.warehouseId ?? null}::int)
            AND (${params.categoryId ?? null}::int IS NULL OR it.category_id = ${params.categoryId ?? null}::int)
          ORDER BY it.name, w.name
        `);
        return res as unknown as ReportRow[];
      }

      case 'stock-movement': {
        // ✓ tenant_id filtered — ES-05 audit
        const res = await db.execute(sql`
          SELECT
            it.name AS item_name,
            w.name AS warehouse,
            COALESCE(SUM(CASE WHEN il.transaction_date < ${from}::date THEN
              CASE WHEN il.transaction_type IN ('PURCHASE_RECEIPT','TRANSFER_IN','ADJUSTMENT_IN','OPENING') THEN il.quantity ELSE -il.quantity END
            ELSE 0 END), 0) AS opening_qty,
            COALESCE(SUM(CASE WHEN il.transaction_date BETWEEN ${from}::date AND ${to}::date
              AND il.transaction_type IN ('PURCHASE_RECEIPT','TRANSFER_IN') THEN il.quantity ELSE 0 END), 0) AS received_qty,
            COALESCE(SUM(CASE WHEN il.transaction_date BETWEEN ${from}::date AND ${to}::date
              AND il.transaction_type IN ('SALE_ISSUE','TRANSFER_OUT') THEN il.quantity ELSE 0 END), 0) AS issued_qty,
            COALESCE(SUM(CASE WHEN il.transaction_date BETWEEN ${from}::date AND ${to}::date
              AND il.transaction_type IN ('ADJUSTMENT_IN','ADJUSTMENT_OUT') THEN
              CASE WHEN il.transaction_type = 'ADJUSTMENT_IN' THEN il.quantity ELSE -il.quantity END
            ELSE 0 END), 0) AS adjusted_qty,
            psl.quantity_on_hand AS closing_qty
          FROM inventory_ledger il
          JOIN items it ON it.id = il.item_id AND it.tenant_id = ${tid}
          JOIN warehouses w ON w.id = il.warehouse_id AND w.tenant_id = ${tid}
          LEFT JOIN projection_stock_level psl ON psl.item_id = il.item_id AND psl.warehouse_id = il.warehouse_id AND psl.tenant_id = ${tid}
          WHERE il.tenant_id = ${tid}
            AND (${params.itemId ?? null}::int IS NULL OR il.item_id = ${params.itemId ?? null}::int)
            AND (${params.warehouseId ?? null}::int IS NULL OR il.warehouse_id = ${params.warehouseId ?? null}::int)
          GROUP BY it.name, w.name, psl.quantity_on_hand
          ORDER BY it.name, w.name
        `);
        return res as unknown as ReportRow[];
      }

      case 'inventory-valuation': {
        const asOf = params.asOfDate ?? new Date().toISOString().slice(0, 10);
        // ✓ tenant_id filtered — ES-05 audit
        const res = await db.execute(sql`
          SELECT
            it.item_code,
            it.name AS item_name,
            cat.name AS category,
            psl.quantity_on_hand,
            psl.fifo_unit_cost,
            psl.quantity_on_hand * COALESCE(psl.fifo_unit_cost, 0) AS total_value
          FROM projection_stock_level psl
          JOIN items it ON it.id = psl.item_id AND it.tenant_id = ${tid}
          LEFT JOIN categories cat ON cat.id = it.category_id
          WHERE psl.tenant_id = ${tid}
            AND psl.quantity_on_hand > 0
            AND (${params.warehouseId ?? null}::int IS NULL OR psl.warehouse_id = ${params.warehouseId ?? null}::int)
          ORDER BY total_value DESC
        `);
        return res as unknown as ReportRow[];
      }

      case 'reorder-report': {
        // ✓ tenant_id filtered — ES-05 audit
        const res = await db.execute(sql`
          SELECT
            it.item_code,
            it.name AS item_name,
            w.name AS warehouse,
            psl.quantity_on_hand AS current_stock,
            it.reorder_level,
            GREATEST(it.reorder_quantity, 0) AS reorder_qty,
            s.display_name AS preferred_supplier
          FROM projection_stock_level psl
          JOIN items it ON it.id = psl.item_id AND it.tenant_id = ${tid}
          JOIN warehouses w ON w.id = psl.warehouse_id AND w.tenant_id = ${tid}
          LEFT JOIN suppliers s ON s.id = it.preferred_supplier_id
          WHERE psl.tenant_id = ${tid}
            AND psl.quantity_on_hand <= COALESCE(it.reorder_level, 0)
            AND (${params.warehouseId ?? null}::int IS NULL OR psl.warehouse_id = ${params.warehouseId ?? null}::int)
          ORDER BY (it.reorder_level - psl.quantity_on_hand) DESC
        `);
        return res as unknown as ReportRow[];
      }

      case 'stock-ageing': {
        const asOf = params.asOfDate ?? new Date().toISOString().slice(0, 10);
        // ✓ tenant_id filtered — ES-05 audit
        const res = await db.execute(sql`
          SELECT
            it.name AS item_name,
            cat.name AS category,
            SUM(CASE WHEN (${asOf}::date - il.transaction_date) <= 30 THEN il.quantity ELSE 0 END) AS qty0to30,
            SUM(CASE WHEN (${asOf}::date - il.transaction_date) BETWEEN 31 AND 60 THEN il.quantity ELSE 0 END) AS qty31to60,
            SUM(CASE WHEN (${asOf}::date - il.transaction_date) BETWEEN 61 AND 90 THEN il.quantity ELSE 0 END) AS qty61to90,
            SUM(CASE WHEN (${asOf}::date - il.transaction_date) > 90 THEN il.quantity ELSE 0 END) AS qty90plus,
            SUM(il.quantity) AS total_qty,
            SUM(il.quantity * COALESCE(il.unit_cost, 0)) AS total_value
          FROM inventory_ledger il
          JOIN items it ON it.id = il.item_id AND it.tenant_id = ${tid}
          LEFT JOIN categories cat ON cat.id = it.category_id
          WHERE il.tenant_id = ${tid}
            AND il.transaction_type IN ('PURCHASE_RECEIPT')
            AND il.transaction_date <= ${asOf}::date
            AND (${params.warehouseId ?? null}::int IS NULL OR il.warehouse_id = ${params.warehouseId ?? null}::int)
          GROUP BY it.id, it.name, cat.name
          ORDER BY total_value DESC
        `);
        return res as unknown as ReportRow[];
      }

      case 'physical-verification-report': {
        // ✓ tenant_id filtered — ES-05 audit
        const res = await db.execute(sql`
          SELECT
            pv.verification_number,
            pv.verification_date::date AS date,
            w.name AS warehouse_name,
            it.name AS item_name,
            pvl.book_quantity AS book_qty,
            pvl.physical_quantity AS physical_qty,
            pvl.variance_quantity AS variance,
            pvl.variance_quantity * COALESCE(psl.fifo_unit_cost, 0) AS variance_value
          FROM physical_verifications pv
          JOIN warehouses w ON w.id = pv.warehouse_id AND w.tenant_id = ${tid}
          JOIN physical_verification_lines pvl ON pvl.pv_id = pv.id
          JOIN items it ON it.id = pvl.item_id
          LEFT JOIN projection_stock_level psl ON psl.item_id = pvl.item_id AND psl.warehouse_id = pv.warehouse_id AND psl.tenant_id = ${tid}
          WHERE pv.tenant_id = ${tid}
            AND pv.verification_date BETWEEN ${from}::date AND ${to}::date
          ORDER BY pv.verification_date DESC
        `);
        return res as unknown as ReportRow[];
      }

      case 'stock-transfer-report': {
        // ✓ tenant_id filtered — ES-05 audit
        const res = await db.execute(sql`
          SELECT
            st.transfer_number,
            st.transfer_date::date AS transfer_date,
            fw.name AS from_warehouse,
            tw.name AS to_warehouse,
            COUNT(stl.id)::int AS item_count,
            SUM(stl.quantity) AS total_qty,
            SUM(stl.quantity * COALESCE(stl.unit_cost, 0)) AS total_value,
            st.status
          FROM stock_transfers st
          JOIN warehouses fw ON fw.id = st.from_warehouse_id AND fw.tenant_id = ${tid}
          JOIN warehouses tw ON tw.id = st.to_warehouse_id AND tw.tenant_id = ${tid}
          LEFT JOIN stock_transfer_lines stl ON stl.transfer_id = st.id
          WHERE st.tenant_id = ${tid}
            AND st.transfer_date BETWEEN ${from}::date AND ${to}::date
          GROUP BY st.id, st.transfer_number, st.transfer_date, fw.name, tw.name, st.status
          ORDER BY st.transfer_date DESC
        `);
        return res as unknown as ReportRow[];
      }

      case 'fabric-roll-report': {
        // ✓ tenant_id filtered — ES-05 audit
        const res = await db.execute(sql`
          SELECT
            fr.roll_number,
            it.name AS item_name,
            fr.colour,
            fr.total_metres,
            fr.used_metres,
            fr.total_metres - fr.used_metres AS remaining_metres,
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
        // ✓ tenant_id filtered — ES-05 audit
        const res = await db.execute(sql`
          SELECT
            w.name AS warehouse,
            it.item_code,
            it.name AS item_name,
            psl.quantity_on_hand,
            psl.quantity_on_hand * COALESCE(psl.fifo_unit_cost, 0) AS total_value
          FROM projection_stock_level psl
          JOIN items it ON it.id = psl.item_id AND it.tenant_id = ${tid}
          JOIN warehouses w ON w.id = psl.warehouse_id AND w.tenant_id = ${tid}
          WHERE psl.tenant_id = ${tid}
            AND psl.quantity_on_hand > 0
            AND (${params.warehouseId ?? null}::int IS NULL OR psl.warehouse_id = ${params.warehouseId ?? null}::int)
            AND (${params.categoryId ?? null}::int IS NULL OR it.category_id = ${params.categoryId ?? null}::int)
          ORDER BY w.name, it.name
        `);
        return res as unknown as ReportRow[];
      }

      case 'stock-ledger': {
        // ✓ tenant_id filtered — ES-05 audit
        const res = await db.execute(sql`
          SELECT
            il.transaction_date::date AS date,
            il.transaction_type,
            il.reference_number AS reference,
            CASE WHEN il.transaction_type IN ('PURCHASE_RECEIPT','TRANSFER_IN','ADJUSTMENT_IN','OPENING','RETURN_IN')
              THEN il.quantity ELSE 0 END AS in_qty,
            CASE WHEN il.transaction_type IN ('SALE_ISSUE','TRANSFER_OUT','ADJUSTMENT_OUT','RETURN_OUT')
              THEN il.quantity ELSE 0 END AS out_qty,
            SUM(CASE WHEN il.transaction_type IN ('PURCHASE_RECEIPT','TRANSFER_IN','ADJUSTMENT_IN','OPENING','RETURN_IN')
              THEN il.quantity ELSE -il.quantity END)
              OVER (ORDER BY il.transaction_date, il.id) AS balance,
            il.unit_cost,
            il.quantity * il.unit_cost AS total_value
          FROM inventory_ledger il
          WHERE il.tenant_id = ${tid}
            AND il.item_id = ${params.itemId ?? 0}::int
            AND il.transaction_date BETWEEN ${from}::date AND ${to}::date
            AND (${params.warehouseId ?? null}::int IS NULL OR il.warehouse_id = ${params.warehouseId ?? null}::int)
          ORDER BY il.transaction_date, il.id
        `);
        return res as unknown as ReportRow[];
      }

      case 'dead-stock-report': {
        const days = Number(p(params.daysSinceMovement, 180));
        const asOf = params.asOfDate ?? new Date().toISOString().slice(0, 10);
        // ✓ tenant_id filtered — ES-05 audit
        const res = await db.execute(sql`
          SELECT
            it.item_code,
            it.name AS item_name,
            cat.name AS category,
            psl.quantity_on_hand AS current_stock,
            MAX(il.transaction_date)::date AS last_movement_date,
            (${asOf}::date - MAX(il.transaction_date)::date) AS days_idle,
            psl.quantity_on_hand * COALESCE(psl.fifo_unit_cost, 0) AS stock_value
          FROM projection_stock_level psl
          JOIN items it ON it.id = psl.item_id AND it.tenant_id = ${tid}
          LEFT JOIN categories cat ON cat.id = it.category_id
          LEFT JOIN inventory_ledger il ON il.item_id = psl.item_id AND il.tenant_id = ${tid}
          WHERE psl.tenant_id = ${tid}
            AND psl.quantity_on_hand > 0
          GROUP BY it.id, it.item_code, it.name, cat.name, psl.quantity_on_hand, psl.fifo_unit_cost
          HAVING (${asOf}::date - MAX(il.transaction_date)::date) >= ${days}
            OR MAX(il.transaction_date) IS NULL
          ORDER BY days_idle DESC NULLS LAST
        `);
        return res as unknown as ReportRow[];
      }

      case 'adjustment-report': {
        // ✓ tenant_id filtered — ES-05 audit
        const res = await db.execute(sql`
          SELECT
            sa.adjustment_number,
            sa.adjustment_date::date AS date,
            w.name AS warehouse,
            it.name AS item_name,
            sa.adjustment_type,
            sal.quantity,
            sa.reason,
            sal.quantity * COALESCE(sal.unit_cost, 0) AS value_impact
          FROM stock_adjustments sa
          JOIN warehouses w ON w.id = sa.warehouse_id AND w.tenant_id = ${tid}
          JOIN stock_adjustment_lines sal ON sal.adjustment_id = sa.id
          JOIN items it ON it.id = sal.item_id
          WHERE sa.tenant_id = ${tid}
            AND sa.adjustment_date BETWEEN ${from}::date AND ${to}::date
          ORDER BY sa.adjustment_date DESC
        `);
        return res as unknown as ReportRow[];
      }

      case 'reservation-report': {
        const asOf = params.asOfDate ?? new Date().toISOString().slice(0, 10);
        // ✓ tenant_id filtered — ES-05 audit
        const res = await db.execute(sql`
          SELECT
            it.name AS item_name,
            w.name AS warehouse,
            SUM(sr.reserved_quantity) AS reserved_qty,
            psl.quantity_on_hand - SUM(sr.reserved_quantity) AS available_qty,
            psl.quantity_on_hand AS total_qty,
            STRING_AGG(DISTINCT sr.reference_type || ' ' || sr.reference_id::text, ', ') AS reserved_for
          FROM stock_reservations sr
          JOIN items it ON it.id = sr.item_id AND it.tenant_id = ${tid}
          JOIN warehouses w ON w.id = sr.warehouse_id AND w.tenant_id = ${tid}
          LEFT JOIN projection_stock_level psl ON psl.item_id = sr.item_id AND psl.warehouse_id = sr.warehouse_id AND psl.tenant_id = ${tid}
          WHERE sr.tenant_id = ${tid}
            AND sr.expires_at >= ${asOf}::date
            AND (${params.warehouseId ?? null}::int IS NULL OR sr.warehouse_id = ${params.warehouseId ?? null}::int)
          GROUP BY it.id, it.name, w.id, w.name, psl.quantity_on_hand
          ORDER BY reserved_qty DESC
        `);
        return res as unknown as ReportRow[];
      }

      // â”€â”€ FINANCIAL REPORTS â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
      case 'day-book': {
        // ✓ tenant_id filtered — ES-26 (fixed: real columns are debit_amount/credit_amount/created_at;
        // there is no entry_type/debit_credit/amount/entry_date column on financial_entries)
        const res = await db.execute(sql`
          SELECT
            fe.created_at::time AS time,
            CASE WHEN fe.debit_amount > 0 THEN 'DEBIT' ELSE 'CREDIT' END AS type,
            j.journal_number AS reference,
            fe.description,
            fe.debit_amount AS debit,
            fe.credit_amount AS credit
          FROM financial_entries fe
          JOIN journals j ON j.id = fe.journal_id AND j.tenant_id = ${tid}
          WHERE fe.tenant_id = ${tid}
            AND fe.created_at::date = ${from}::date
          ORDER BY fe.created_at
        `);
        return res as unknown as ReportRow[];
      }

      case 'account-ledger': {
        // ✓ tenant_id filtered — ES-26 (fixed: real columns are debit_amount/credit_amount/created_at,
        // not amount/debit_credit/entry_date)
        const res = await db.execute(sql`
          SELECT
            fe.created_at::date AS date,
            j.journal_number,
            fe.description,
            fe.debit_amount AS debit,
            fe.credit_amount AS credit,
            SUM(fe.debit_amount - fe.credit_amount)
              OVER (ORDER BY fe.created_at, fe.id) AS balance
          FROM financial_entries fe
          JOIN journals j ON j.id = fe.journal_id AND j.tenant_id = ${tid}
          WHERE fe.tenant_id = ${tid}
            AND fe.account_id = ${params.accountId ?? 0}::int
            AND fe.created_at >= ${from}::date AND fe.created_at < (${to}::date + INTERVAL '1 day')
          ORDER BY fe.created_at, fe.id
        `);
        return res as unknown as ReportRow[];
      }

      case 'trial-balance-report': {
        const asOf = params.toDate ?? params.asOfDate ?? to;
        // ✓ tenant_id filtered — ES-17 (fixed: real columns are debit_amount/credit_amount/created_at,
        // not amount/debit_credit/entry_date; opening balance now comes from accounts.opening_balance)
        const rows = (await db.execute(sql`
          SELECT
            a.account_code,
            a.name AS account_name,
            a.opening_balance,
            a.opening_balance_type,
            COALESCE(SUM(CASE WHEN fe.created_at < ${from}::date THEN fe.debit_amount ELSE 0 END), 0) AS pre_debit,
            COALESCE(SUM(CASE WHEN fe.created_at < ${from}::date THEN fe.credit_amount ELSE 0 END), 0) AS pre_credit,
            COALESCE(SUM(CASE WHEN fe.created_at >= ${from}::date AND fe.created_at < (${asOf}::date + INTERVAL '1 day') THEN fe.debit_amount ELSE 0 END), 0) AS period_debit,
            COALESCE(SUM(CASE WHEN fe.created_at >= ${from}::date AND fe.created_at < (${asOf}::date + INTERVAL '1 day') THEN fe.credit_amount ELSE 0 END), 0) AS period_credit
          FROM accounts a
          LEFT JOIN financial_entries fe ON fe.account_id = a.id AND fe.tenant_id = ${tid}
          WHERE a.tenant_id = ${tid}
            AND a.deleted_at IS NULL
            AND a.is_active = true
          GROUP BY a.id, a.account_code, a.name, a.opening_balance, a.opening_balance_type
          ORDER BY a.account_code
        `)) as unknown as Array<{
          account_code: string;
          account_name: string;
          opening_balance: string;
          opening_balance_type: string;
          pre_debit: string;
          pre_credit: string;
          period_debit: string;
          period_credit: string;
        }>;

        return rows
          .map((r): ReportRow => {
            const openingBalance = Number(r.opening_balance);
            const openingDr = (r.opening_balance_type === 'DEBIT' ? openingBalance : 0) + Number(r.pre_debit);
            const openingCr = (r.opening_balance_type === 'CREDIT' ? openingBalance : 0) + Number(r.pre_credit);
            const periodDebit = Number(r.period_debit);
            const periodCredit = Number(r.period_credit);
            const closingDr = openingDr + periodDebit;
            const closingCr = openingCr + periodCredit;
            return {
              account_code: r.account_code,
              account_name: r.account_name,
              opening_debit: openingDr > openingCr ? openingDr - openingCr : 0,
              opening_credit: openingCr > openingDr ? openingCr - openingDr : 0,
              period_debit: periodDebit,
              period_credit: periodCredit,
              closing_debit: closingDr > closingCr ? closingDr - closingCr : 0,
              closing_credit: closingCr > closingDr ? closingCr - closingDr : 0,
            };
          })
          .filter((r) =>
            r['opening_debit'] || r['opening_credit'] || r['period_debit'] || r['period_credit'] || r['closing_debit'] || r['closing_credit']
          );
      }

      case 'profit-loss-report': {
        // ✓ tenant_id filtered — ES-17 (fixed: account_type is INCOME/EXPENSE/CONTRA, not REVENUE/COGS;
        // real columns are debit_amount/credit_amount/created_at)
        const res = await db.execute(sql`
          SELECT
            CASE
              WHEN a.account_type = 'INCOME' AND a.account_sub_type = 'SALES_REVENUE' THEN 'REVENUE'
              WHEN a.account_type = 'INCOME' THEN 'OTHER_INCOME'
              WHEN a.account_sub_type = 'COST_OF_GOODS' THEN 'COGS'
              WHEN a.account_type = 'CONTRA' THEN 'CONTRA_REVENUE'
              WHEN a.account_sub_type = 'OPERATING_EXPENSE' THEN 'OPERATING_EXPENSE'
              WHEN a.account_sub_type = 'TAX_EXPENSE' THEN 'TAX_EXPENSE'
              WHEN a.account_type = 'EXPENSE' THEN 'OTHER_EXPENSE'
              ELSE 'OTHER'
            END AS category,
            a.account_code,
            a.name AS account_name,
            CASE WHEN a.account_type = 'INCOME'
              THEN SUM(fe.credit_amount) - SUM(fe.debit_amount)
              ELSE SUM(fe.debit_amount) - SUM(fe.credit_amount)
            END AS amount
          FROM accounts a
          JOIN financial_entries fe ON fe.account_id = a.id AND fe.tenant_id = ${tid}
            AND fe.created_at >= ${from}::date AND fe.created_at < (${to}::date + INTERVAL '1 day')
          WHERE a.tenant_id = ${tid}
            AND a.account_type IN ('INCOME', 'EXPENSE', 'CONTRA')
            AND a.deleted_at IS NULL
          GROUP BY a.id, a.account_code, a.name, a.account_type, a.account_sub_type
          HAVING SUM(fe.debit_amount) <> 0 OR SUM(fe.credit_amount) <> 0
          ORDER BY category, a.account_code
        `);
        return res as unknown as ReportRow[];
      }

      case 'balance-sheet-report': {
        const asOf = params.asOfDate ?? to;
        // ✓ tenant_id filtered — ES-17 (fixed: account_type is ASSET/LIABILITY/EQUITY with normal_balance
        // + opening_balance driving the sign, not a naive debit_credit sum)
        const res = await db.execute(sql`
          SELECT
            a.account_type AS section,
            a.account_code,
            a.name AS account_name,
            CASE WHEN a.normal_balance = 'DEBIT' THEN
              (CASE WHEN a.opening_balance_type = 'DEBIT' THEN a.opening_balance ELSE -a.opening_balance END
                + COALESCE(SUM(fe.debit_amount), 0) - COALESCE(SUM(fe.credit_amount), 0))
            ELSE
              (CASE WHEN a.opening_balance_type = 'CREDIT' THEN a.opening_balance ELSE -a.opening_balance END
                + COALESCE(SUM(fe.credit_amount), 0) - COALESCE(SUM(fe.debit_amount), 0))
            END AS amount
          FROM accounts a
          LEFT JOIN financial_entries fe ON fe.account_id = a.id AND fe.tenant_id = ${tid}
            AND fe.created_at < (${asOf}::date + INTERVAL '1 day')
          WHERE a.tenant_id = ${tid}
            AND a.account_type IN ('ASSET', 'LIABILITY', 'EQUITY')
            AND a.deleted_at IS NULL
            AND a.is_active = true
          GROUP BY a.id, a.account_code, a.name, a.account_type, a.normal_balance, a.opening_balance, a.opening_balance_type
          ORDER BY a.account_type, a.account_code
        `);
        return res as unknown as ReportRow[];
      }

      case 'cash-flow-report': {
        // ✓ tenant_id filtered — ES-17 (fixed: derives cash movement from CASH_AND_BANK accounts using
        // real debit_amount/credit_amount/created_at columns, not the nonexistent amount/entry_date)
        const cashRows = (await db.execute(sql`
          SELECT
            COALESCE(SUM(fe.debit_amount), 0) AS total_in,
            COALESCE(SUM(fe.credit_amount), 0) AS total_out
          FROM accounts a
          JOIN financial_entries fe ON fe.account_id = a.id AND fe.tenant_id = ${tid}
            AND fe.created_at >= ${from}::date AND fe.created_at < (${to}::date + INTERVAL '1 day')
          WHERE a.tenant_id = ${tid}
            AND a.account_sub_type = 'CASH_AND_BANK'
            AND a.deleted_at IS NULL
        `)) as unknown as Array<{ total_in: string; total_out: string }>;

        const openingRows = (await db.execute(sql`
          WITH per_account AS (
            SELECT
              a.id,
              CASE WHEN a.opening_balance_type = 'DEBIT' THEN a.opening_balance ELSE -a.opening_balance END AS ob_signed,
              COALESCE(SUM(fe.debit_amount), 0) - COALESCE(SUM(fe.credit_amount), 0) AS pre_movement
            FROM accounts a
            LEFT JOIN financial_entries fe ON fe.account_id = a.id AND fe.tenant_id = ${tid}
              AND fe.created_at < ${from}::date
            WHERE a.tenant_id = ${tid}
              AND a.account_sub_type = 'CASH_AND_BANK'
              AND a.deleted_at IS NULL
            GROUP BY a.id, a.opening_balance, a.opening_balance_type
          )
          SELECT COALESCE(SUM(ob_signed + pre_movement), 0) AS balance FROM per_account
        `)) as unknown as Array<{ balance: string }>;

        const totalIn = Number(cashRows[0]?.total_in ?? 0);
        const totalOut = Number(cashRows[0]?.total_out ?? 0);
        const openingCash = Number(openingRows[0]?.balance ?? 0);
        const netMovement = totalIn - totalOut;
        const closingCash = openingCash + netMovement;

        const rows: ReportRow[] = [
          { section: 'Operating Activities', description: 'Cash received from customers & others', amount: totalIn },
          { section: 'Operating Activities', description: 'Cash paid to suppliers & expenses', amount: -totalOut },
          { section: 'Summary', description: 'Net Cash Movement', amount: netMovement },
          { section: 'Summary', description: 'Opening Cash & Bank Balance', amount: openingCash },
          { section: 'Summary', description: 'Closing Cash & Bank Balance', amount: closingCash },
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
        // ✓ tenant_id filtered — ES-26 (fixed: real columns are debit_amount/credit_amount/created_at,
        // not amount/debit_credit/entry_date)
        const res = await db.execute(sql`
          SELECT
            fe.created_at::date AS date,
            fe.description,
            j.journal_number AS reference,
            fe.debit_amount AS debit,
            fe.credit_amount AS credit,
            SUM(fe.debit_amount - fe.credit_amount)
              OVER (ORDER BY fe.created_at, fe.id) AS balance
          FROM financial_entries fe
          JOIN journals j ON j.id = fe.journal_id AND j.tenant_id = ${tid}
          JOIN bank_accounts ba ON ba.account_id = fe.account_id AND ba.tenant_id = ${tid}
          WHERE fe.tenant_id = ${tid}
            AND ba.id = ${params.bankAccountId ?? 0}::int
            AND fe.created_at >= ${from}::date AND fe.created_at < (${to}::date + INTERVAL '1 day')
          ORDER BY fe.created_at, fe.id
        `);
        return res as unknown as ReportRow[];
      }

      case 'tds-report': {
        // ✓ tenant_id filtered — ES-05 audit
        const res = await db.execute(sql`
          SELECT
            te.deductee_type,
            te.pan_number,
            te.tds_section AS section,
            te.gross_amount,
            te.tds_rate,
            te.tds_amount,
            te.status
          FROM tds_entries te
          WHERE te.tenant_id = ${tid}
            AND te.entry_date BETWEEN ${from}::date AND ${to}::date
          ORDER BY te.entry_date DESC
        `);
        return res as unknown as ReportRow[];
      }

      case 'depreciation-schedule': {
        // ✓ tenant_id filtered — ES-05 audit
        const res = await db.execute(sql`
          SELECT
            fa.asset_name,
            fa.asset_category,
            fa.purchase_date::date AS purchase_date,
            ads.opening_value,
            0 AS additions,
            ads.depreciation_amount AS depreciation,
            ads.closing_value
          FROM fixed_assets fa
          JOIN asset_depreciation_schedule ads ON ads.asset_id = fa.id AND ads.tenant_id = ${tid}
          WHERE fa.tenant_id = ${tid}
            AND ads.financial_year = ${params.financialYear ?? ''}::text
          ORDER BY fa.asset_name
        `);
        return res as unknown as ReportRow[];
      }

      case 'journal-report': {
        // ✓ tenant_id filtered — ES-05 audit
        const res = await db.execute(sql`
          SELECT
            j.journal_date::date AS journal_date,
            j.journal_number,
            j.description,
            j.total_debit,
            j.total_credit
          FROM journals j
          WHERE j.tenant_id = ${tid}
            AND j.journal_date BETWEEN ${from}::date AND ${to}::date
          ORDER BY j.journal_date DESC
        `);
        return res as unknown as ReportRow[];
      }

      case 'profit-center-report': {
        // ✓ tenant_id filtered — ES-05 audit
        const res = await db.execute(sql`
          SELECT
            b.name AS branch,
            COALESCE(SUM(CASE WHEN i.status != 'CANCELLED' THEN i.grand_total END), 0) AS total_sales,
            0 AS cogs,
            COALESCE(SUM(CASE WHEN i.status != 'CANCELLED' THEN i.grand_total END), 0) AS gross_profit,
            0 AS expenses,
            COALESCE(SUM(CASE WHEN i.status != 'CANCELLED' THEN i.grand_total END), 0) AS net_profit,
            0 AS margin
          FROM branches b
          LEFT JOIN invoices i ON i.branch_id = b.id AND i.tenant_id = ${tid}
            AND i.invoice_date BETWEEN ${from}::date AND ${to}::date
          WHERE b.tenant_id = ${tid}
          GROUP BY b.id, b.name
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
        // ✓ tenant_id filtered — ES-05 audit
        const res = await db.execute(sql`
          SELECT
            e.employee_code,
            CONCAT(e.first_name, ' ', e.last_name) AS employee_name,
            e.department,
            ps.basic_salary,
            ps.total_allowances AS allowances,
            ps.gross_salary,
            ps.total_deductions AS deductions,
            ps.net_salary
          FROM payroll_slips ps
          JOIN payroll_runs pr ON pr.id = ps.payroll_run_id AND pr.tenant_id = ${tid}
          JOIN employees e ON e.id = ps.employee_id AND e.tenant_id = ${tid}
          WHERE pr.tenant_id = ${tid}
            AND EXTRACT(YEAR FROM pr.pay_period_start) = ${Number(year)}
            AND EXTRACT(MONTH FROM pr.pay_period_start) = ${Number(month)}
          ORDER BY e.employee_code
        `);
        return res as unknown as ReportRow[];
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
        // ✓ tenant_id filtered — ES-05 audit
        const res = await db.execute(sql`
          SELECT
            CONCAT(e.first_name, ' ', e.last_name) AS employee_name,
            la.leave_type,
            la.from_date::date AS from_date,
            la.to_date::date AS to_date,
            la.number_of_days AS days,
            la.status,
            la.reason
          FROM leave_applications la
          JOIN employees e ON e.id = la.employee_id AND e.tenant_id = ${tid}
          WHERE la.tenant_id = ${tid}
            AND la.from_date BETWEEN ${from}::date AND ${to}::date
          ORDER BY la.from_date DESC
        `);
        return res as unknown as ReportRow[];
      }

      case 'employee-master-report': {
        // ✓ tenant_id filtered — ES-05 audit
        const res = await db.execute(sql`
          SELECT
            e.employee_code,
            CONCAT(e.first_name, ' ', e.last_name) AS employee_name,
            e.department,
            e.designation,
            e.date_of_joining::date AS date_of_joining,
            e.status,
            e.contact_number
          FROM employees e
          WHERE e.tenant_id = ${tid}
            AND (${params.status ?? null}::text IS NULL OR e.status = ${params.status ?? null}::text)
          ORDER BY e.employee_code
        `);
        return res as unknown as ReportRow[];
      }

      case 'alteration-report': {
        // ✓ tenant_id filtered — ES-05 audit
        const res = await db.execute(sql`
          SELECT
            ao.alteration_number,
            ao.order_date::date AS date,
            COALESCE(c.display_name, 'Walk-in') AS customer_name,
            CONCAT(e.first_name, ' ', e.last_name) AS tailor_name,
            ao.total_pieces,
            ao.delivery_date::date AS delivery_date,
            ao.status,
            ao.total_charges AS charges
          FROM alteration_orders ao
          LEFT JOIN customers c ON c.id = ao.customer_id AND c.tenant_id = ${tid}
          LEFT JOIN employees e ON e.id = ao.assigned_tailor_id AND e.tenant_id = ${tid}
          WHERE ao.tenant_id = ${tid}
            AND ao.order_date BETWEEN ${from}::date AND ${to}::date
          ORDER BY ao.order_date DESC
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
              AND i.status != 'CANCELLED'
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
        // ✓ tenant_id filtered — ES-05 audit
        const res = await db.execute(sql`
          SELECT
            i.invoice_date::date AS invoice_date,
            i.invoice_number,
            COALESCE(c.gstin, 'URP') AS customer_gstin,
            COALESCE(c.display_name, 'Walk-in') AS customer_name,
            i.subtotal AS taxable_value,
            0 AS gst_rate,
            i.cgst_amount AS cgst,
            i.sgst_amount AS sgst,
            i.igst_amount AS igst
          FROM invoices i
          LEFT JOIN customers c ON c.id = i.customer_id AND c.tenant_id = ${tid}
          WHERE i.tenant_id = ${tid}
            AND i.invoice_date BETWEEN ${from}::date AND ${to}::date
            AND i.status NOT IN ('CANCELLED', 'DRAFT')
          ORDER BY i.invoice_date
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
        if (cache) await cache.setJson(cacheKey, rows, GST_PAYABLE_CACHE_TTL_SECONDS).catch(() => undefined);
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
        // ✓ tenant_id filtered — ES-05 audit
        const res = await db.execute(sql`
          SELECT
            COALESCE(c.display_name, 'Walk-in') AS customer_name,
            SUM(CASE WHEN (${asOf}::date - i.invoice_date::date) BETWEEN 0 AND 30
              THEN (i.grand_total - COALESCE(i.paid_amount, 0)) ELSE 0 END) AS days0to30,
            SUM(CASE WHEN (${asOf}::date - i.invoice_date::date) BETWEEN 31 AND 60
              THEN (i.grand_total - COALESCE(i.paid_amount, 0)) ELSE 0 END) AS days31to60,
            SUM(CASE WHEN (${asOf}::date - i.invoice_date::date) BETWEEN 61 AND 90
              THEN (i.grand_total - COALESCE(i.paid_amount, 0)) ELSE 0 END) AS days61to90,
            SUM(CASE WHEN (${asOf}::date - i.invoice_date::date) > 90
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
        // ✓ tenant_id filtered — ES-05 audit
        const res = await db.execute(sql`
          SELECT
            s.display_name AS supplier_name,
            SUM(CASE WHEN (${asOf}::date - g.grn_date::date) BETWEEN 0 AND 30
              THEN (g.grand_total - COALESCE(g.paid_amount, 0)) ELSE 0 END) AS days0to30,
            SUM(CASE WHEN (${asOf}::date - g.grn_date::date) BETWEEN 31 AND 60
              THEN (g.grand_total - COALESCE(g.paid_amount, 0)) ELSE 0 END) AS days31to60,
            SUM(CASE WHEN (${asOf}::date - g.grn_date::date) BETWEEN 61 AND 90
              THEN (g.grand_total - COALESCE(g.paid_amount, 0)) ELSE 0 END) AS days61to90,
            SUM(CASE WHEN (${asOf}::date - g.grn_date::date) > 90
              THEN (g.grand_total - COALESCE(g.paid_amount, 0)) ELSE 0 END) AS days90plus,
            SUM(g.grand_total - COALESCE(g.paid_amount, 0)) AS total_outstanding
          FROM grns g
          JOIN suppliers s ON s.id = g.supplier_id AND s.tenant_id = ${tid}
          WHERE g.tenant_id = ${tid}
            AND g.grn_date::date <= ${asOf}::date
            AND g.status NOT IN ('CANCELLED')
            AND (g.grand_total - COALESCE(g.paid_amount, 0)) > 0
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
        // ✓ tenant_id filtered — ES-17 (sums plaintext salary components — grossSalary/netSalary are
        // AES-256-GCM encrypted and must not be summed in SQL)
        const res = await db.execute(sql`
          SELECT
            pr.period_year::text || '-' || LPAD(pr.period_month::text, 2, '0') AS month,
            COUNT(DISTINCT ps.employee_id)::int AS employee_count,
            SUM(ps.basic_salary + ps.hra_amount + ps.da_amount + ps.other_allowances + ps.piece_rate_amount) AS gross_salary_cost,
            SUM(ps.total_deductions) AS total_deductions
          FROM payroll_slips ps
          JOIN payroll_runs pr ON pr.id = ps.payroll_run_id AND pr.tenant_id = ${tid}
          WHERE pr.tenant_id = ${tid}
            AND (pr.period_year * 100 + pr.period_month)
              BETWEEN (EXTRACT(YEAR FROM ${fromYm}::date)::int * 100 + EXTRACT(MONTH FROM ${fromYm}::date)::int)
              AND (EXTRACT(YEAR FROM ${toYm}::date)::int * 100 + EXTRACT(MONTH FROM ${toYm}::date)::int)
          GROUP BY pr.period_year, pr.period_month
          ORDER BY pr.period_year, pr.period_month
        `);
        return res as unknown as ReportRow[];
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

