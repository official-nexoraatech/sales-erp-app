import { FastifyInstance } from 'fastify';
import { sql } from 'drizzle-orm';
import type { ErpDatabase, ReplicaRouter } from '@erp/db';
import { authenticate } from '../middleware/authenticate.js';
import { requirePermission } from '../middleware/authorize.js';

type DbClient = ErpDatabase;

// PG-005: dashboard reads are latency-tolerant up to projection_dashboard_daily's own
// documented 2-minute staleness tolerance (see event-service's STALE_TOLERANCE_MS), so a
// replica lagging by up to that much is still "fresh enough" — resolve per-request via
// replicaRouter.forRead() (falls back to the primary db when the caller passes none).
export async function dashboardRoutes(fastify: FastifyInstance, db: DbClient, replicaRouter?: ReplicaRouter): Promise<void> {
  // GET /api/v2/dashboard/kpis — Today and month KPIs from CQRS projections
  fastify.get('/api/v2/dashboard/kpis', {
    preHandler: [authenticate, requirePermission('DASHBOARD_VIEW')],
  }, async (req, reply) => {
    const readDb = replicaRouter ? await replicaRouter.forRead() : db;
    const tid = req.auth.tenantId;
    const today = new Date().toISOString().slice(0, 10);
    const monthStart = today.slice(0, 7) + '-01';

    // Sales/collections come from the projection_dashboard_daily CQRS projection
    // (kept up to date by InvoiceService/PaymentService). It has no columns for
    // purchases, expenses, profit or invoice count — those are derived below
    // straight from the source tables since no projection covers them.
    const [dailyKpis] = await readDb.execute(sql`
      SELECT
        COALESCE(SUM(CASE WHEN date = ${today}::date THEN sales_amount END), 0) AS today_sales,
        COALESCE(SUM(CASE WHEN date = ${today}::date THEN collected_amount END), 0) AS today_collection,
        COALESCE(SUM(CASE WHEN date >= ${monthStart}::date THEN sales_amount END), 0) AS month_sales,
        COALESCE(SUM(CASE WHEN date >= ${monthStart}::date THEN collected_amount END), 0) AS month_collection
      FROM projection_dashboard_daily
      WHERE tenant_id = ${tid} AND date >= ${monthStart}::date
    `) as unknown as Record<string, unknown>[];

    const [todayPurchase] = await readDb.execute(sql`
      SELECT COALESCE(SUM(grand_total), 0) AS today_purchase
      FROM grns
      WHERE tenant_id = ${tid} AND grn_date::date = ${today}::date AND status = 'APPROVED'
    `) as unknown as Record<string, unknown>[];

    const [todayExpense] = await readDb.execute(sql`
      SELECT COALESCE(SUM(total_amount), 0) AS today_expense
      FROM expenses
      WHERE tenant_id = ${tid} AND expense_date::date = ${today}::date AND status IN ('APPROVED', 'PAID')
    `) as unknown as Record<string, unknown>[];

    // Gross profit = invoice-line taxable amount less WACC cost of goods sold.
    const [monthProfit] = await readDb.execute(sql`
      SELECT
        COUNT(DISTINCT i.id)::int AS month_invoices,
        COALESCE(SUM(il.taxable_amount) - SUM(il.quantity * it.wacc_cost), 0) AS month_profit
      FROM invoices i
      JOIN invoice_lines il ON il.invoice_id = i.id AND il.tenant_id = ${tid}
      JOIN items it ON it.id = il.item_id AND it.tenant_id = ${tid}
      WHERE i.tenant_id = ${tid} AND i.invoice_date >= ${monthStart}::date AND i.status != 'CANCELLED'
    `) as unknown as Record<string, unknown>[];

    // Outstanding receivables & payables from projections
    const [balances] = await readDb.execute(sql`
      SELECT
        COALESCE(SUM(CASE WHEN type = 'RECEIVABLE' THEN current_balance END), 0) AS total_receivable,
        COALESCE(SUM(CASE WHEN type = 'PAYABLE' THEN current_balance END), 0) AS total_payable
      FROM (
        SELECT 'RECEIVABLE' AS type, SUM(current_balance) AS current_balance
        FROM projection_customer_balance WHERE tenant_id = ${tid} AND current_balance > 0
        UNION ALL
        SELECT 'PAYABLE', SUM(current_balance)
        FROM projection_supplier_balance WHERE tenant_id = ${tid} AND current_balance > 0
      ) t
    `) as unknown as Record<string, unknown>[];

    return reply.code(200).send({
      data: {
        today: {
          ...(dailyKpis ?? {}),
          today_purchase: todayPurchase?.today_purchase ?? 0,
          today_expense: todayExpense?.today_expense ?? 0,
          month_profit: monthProfit?.month_profit ?? 0,
          month_invoices: monthProfit?.month_invoices ?? 0,
        },
        balances: balances ?? {},
      },
    });
  });

  // GET /api/v2/dashboard/charts — Chart data for Owner dashboard
  fastify.get('/api/v2/dashboard/charts', {
    preHandler: [authenticate, requirePermission('DASHBOARD_VIEW')],
  }, async (req, reply) => {
    const readDb = replicaRouter ? await replicaRouter.forRead() : db;
    const tid = req.auth.tenantId;
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const today = new Date().toISOString().slice(0, 10);

    // 1. Daily sales trend (last 30 days) — sales/collections from the projection,
    // gross profit derived from invoice lines (no profit column exists on the projection)
    const salesTrend = await readDb.execute(sql`
      SELECT date::date::text AS date, sales_amount AS total_sales, collected_amount AS total_collections
      FROM projection_dashboard_daily
      WHERE tenant_id = ${tid} AND date BETWEEN ${thirtyDaysAgo}::date AND ${today}::date
      ORDER BY date
    `) as unknown as Record<string, unknown>[];

    const dailyProfit = await readDb.execute(sql`
      SELECT
        i.invoice_date::date::text AS date,
        COALESCE(SUM(il.taxable_amount) - SUM(il.quantity * it.wacc_cost), 0) AS gross_profit
      FROM invoices i
      JOIN invoice_lines il ON il.invoice_id = i.id AND il.tenant_id = ${tid}
      JOIN items it ON it.id = il.item_id AND it.tenant_id = ${tid}
      WHERE i.tenant_id = ${tid} AND i.invoice_date BETWEEN ${thirtyDaysAgo}::date AND ${today}::date
        AND i.status != 'CANCELLED'
      GROUP BY i.invoice_date::date
    `) as unknown as Record<string, unknown>[];
    const profitByDate = new Map(dailyProfit.map((r) => [r.date as string, r.gross_profit]));
    const salesTrendWithProfit = salesTrend.map((row) => ({
      ...row,
      gross_profit: profitByDate.get(row.date as string) ?? 0,
    }));

    // 2. Sales by category (current month)
    const monthStart = today.slice(0, 7) + '-01';
    const salesByCategory = await readDb.execute(sql`
      SELECT cat.name AS category, SUM(il.line_total) AS revenue
      FROM invoice_lines il
      JOIN invoices i ON i.id = il.invoice_id AND i.tenant_id = ${tid}
      JOIN items it ON it.id = il.item_id
      LEFT JOIN categories cat ON cat.id = it.category_id
      WHERE i.tenant_id = ${tid}
        AND i.invoice_date >= ${monthStart}::date
        AND i.status != 'CANCELLED'
      GROUP BY cat.id, cat.name
      ORDER BY revenue DESC
      LIMIT 8
    `) as unknown as Record<string, unknown>[];

    // 3. Payment mode breakdown (current month)
    const paymentModes = await readDb.execute(sql`
      SELECT payment_mode AS mode, SUM(amount) AS total
      FROM payments
      WHERE tenant_id = ${tid} AND payment_date >= ${monthStart}::date
      GROUP BY payment_mode
      ORDER BY total DESC
    `) as unknown as Record<string, unknown>[];

    // 4. Stock value by category — items table carries its own live qty/WACC cost
    const stockByCategory = await readDb.execute(sql`
      SELECT cat.name AS category, SUM(it.available_qty * it.wacc_cost) AS value
      FROM items it
      LEFT JOIN categories cat ON cat.id = it.category_id
      WHERE it.tenant_id = ${tid}
      GROUP BY cat.id, cat.name
      ORDER BY value DESC
      LIMIT 8
    `) as unknown as Record<string, unknown>[];

    // 5. Monthly comparison (current vs prev month)
    const prevMonthStart = new Date(new Date(monthStart).setMonth(new Date(monthStart).getMonth() - 1))
      .toISOString().slice(0, 10);
    const prevMonthEnd = new Date(new Date(monthStart).setDate(0)).toISOString().slice(0, 10);

    const [monthlySales] = await readDb.execute(sql`
      SELECT
        SUM(CASE WHEN date >= ${monthStart}::date THEN sales_amount ELSE 0 END) AS current_sales,
        SUM(CASE WHEN date >= ${prevMonthStart}::date AND date <= ${prevMonthEnd}::date THEN sales_amount ELSE 0 END) AS prev_sales
      FROM projection_dashboard_daily
      WHERE tenant_id = ${tid} AND date >= ${prevMonthStart}::date
    `) as unknown as Record<string, unknown>[];

    const [monthlyProfit] = await readDb.execute(sql`
      SELECT
        COALESCE(SUM(CASE WHEN i.invoice_date >= ${monthStart}::date THEN il.taxable_amount - il.quantity * it.wacc_cost ELSE 0 END), 0) AS current_profit,
        COALESCE(SUM(CASE WHEN i.invoice_date >= ${prevMonthStart}::date AND i.invoice_date <= ${prevMonthEnd}::date THEN il.taxable_amount - il.quantity * it.wacc_cost ELSE 0 END), 0) AS prev_profit
      FROM invoices i
      JOIN invoice_lines il ON il.invoice_id = i.id AND il.tenant_id = ${tid}
      JOIN items it ON it.id = il.item_id AND it.tenant_id = ${tid}
      WHERE i.tenant_id = ${tid} AND i.invoice_date >= ${prevMonthStart}::date AND i.status != 'CANCELLED'
    `) as unknown as Record<string, unknown>[];

    const monthlyComparison = { ...(monthlySales ?? {}), ...(monthlyProfit ?? {}) };

    // 6. Top 5 customers by sales (current month)
    const topCustomers = await readDb.execute(sql`
      SELECT
        COALESCE(c.display_name, 'Walk-in') AS name,
        SUM(i.grand_total) AS revenue
      FROM invoices i
      LEFT JOIN customers c ON c.id = i.customer_id AND c.tenant_id = ${tid}
      WHERE i.tenant_id = ${tid}
        AND i.invoice_date >= ${monthStart}::date
        AND i.status != 'CANCELLED'
      GROUP BY c.id, c.display_name
      ORDER BY revenue DESC
      LIMIT 5
    `) as unknown as Record<string, unknown>[];

    // 7. Receivables ageing
    const receivablesAgeing = await readDb.execute(sql`
      SELECT
        CASE
          WHEN (${today}::date - i.due_date::date) <= 0 THEN 'Current'
          WHEN (${today}::date - i.due_date::date) <= 30 THEN '1-30d'
          WHEN (${today}::date - i.due_date::date) <= 60 THEN '31-60d'
          WHEN (${today}::date - i.due_date::date) <= 90 THEN '61-90d'
          ELSE '90d+'
        END AS bucket,
        SUM(i.grand_total - COALESCE(i.paid_amount, 0)) AS amount
      FROM invoices i
      WHERE i.tenant_id = ${tid}
        AND (i.grand_total - COALESCE(i.paid_amount, 0)) > 0
        AND i.status NOT IN ('CANCELLED', 'PAID')
      GROUP BY bucket
      ORDER BY MIN(CASE
        WHEN (${today}::date - i.due_date::date) <= 0 THEN 1
        WHEN (${today}::date - i.due_date::date) <= 30 THEN 2
        WHEN (${today}::date - i.due_date::date) <= 60 THEN 3
        WHEN (${today}::date - i.due_date::date) <= 90 THEN 4
        ELSE 5
      END)
    `) as unknown as Record<string, unknown>[];

    // 8. Purchase trend (last 30 days) — derived from approved GRNs
    const purchaseTrend = await readDb.execute(sql`
      SELECT grn_date::date::text AS date, SUM(grand_total) AS total_purchases
      FROM grns
      WHERE tenant_id = ${tid} AND grn_date BETWEEN ${thirtyDaysAgo}::date AND ${today}::date
        AND status = 'APPROVED'
      GROUP BY grn_date::date
      ORDER BY date
    `) as unknown as Record<string, unknown>[];

    return reply.code(200).send({
      data: {
        salesTrend: salesTrendWithProfit,
        salesByCategory,
        paymentModes,
        stockByCategory,
        monthlyComparison,
        topCustomers,
        receivablesAgeing,
        purchaseTrend,
      },
    });
  });

  // GET /api/v2/dashboard/alerts — Alert widgets (low stock, overdue invoices, pending POs)
  fastify.get('/api/v2/dashboard/alerts', {
    preHandler: [authenticate, requirePermission('DASHBOARD_VIEW')],
  }, async (req, reply) => {
    const readDb = replicaRouter ? await replicaRouter.forRead() : db;
    const tid = req.auth.tenantId;
    const today = new Date().toISOString().slice(0, 10);

    const [lowStockCount] = await readDb.execute(sql`
      SELECT COUNT(*)::int AS count
      FROM items it
      WHERE it.tenant_id = ${tid}
        AND it.available_qty <= it.reorder_level
        AND it.reorder_level > 0
    `) as unknown as Record<string, unknown>[];

    const [overdueInvoices] = await readDb.execute(sql`
      SELECT COUNT(*)::int AS count, COALESCE(SUM(grand_total - COALESCE(paid_amount, 0)), 0) AS total_amount
      FROM invoices
      WHERE tenant_id = ${tid}
        AND due_date < ${today}::date
        AND (grand_total - COALESCE(paid_amount, 0)) > 0
        AND status NOT IN ('CANCELLED', 'PAID')
    `) as unknown as Record<string, unknown>[];

    const [pendingPOs] = await readDb.execute(sql`
      SELECT COUNT(*)::int AS count
      FROM purchase_orders
      WHERE tenant_id = ${tid}
        AND status IN ('APPROVED', 'PARTIALLY_RECEIVED')
    `) as unknown as Record<string, unknown>[];

    const [pendingGRNs] = await readDb.execute(sql`
      SELECT COUNT(*)::int AS count
      FROM grns
      WHERE tenant_id = ${tid}
        AND status = 'PENDING_APPROVAL'
    `) as unknown as Record<string, unknown>[];

    // Supplier payables have no due-date tracking on grns — the projection's
    // overdue_amount (maintained from supplier payment terms) is the real source.
    const [pendingPayments] = await readDb.execute(sql`
      SELECT COUNT(*)::int AS count, COALESCE(SUM(overdue_amount), 0) AS total_amount
      FROM projection_supplier_balance
      WHERE tenant_id = ${tid} AND overdue_amount > 0
    `) as unknown as Record<string, unknown>[];

    return reply.code(200).send({
      data: {
        lowStock: lowStockCount ?? { count: 0 },
        overdueReceivables: overdueInvoices ?? { count: 0, total_amount: 0 },
        pendingPurchaseOrders: pendingPOs ?? { count: 0 },
        pendingGRNs: pendingGRNs ?? { count: 0 },
        overduePayables: pendingPayments ?? { count: 0, total_amount: 0 },
      },
    });
  });

  // GET /api/v2/pos-analytics — Real-time POS analytics sidebar data
  fastify.get('/api/v2/pos-analytics', {
    preHandler: [authenticate, requirePermission('POS_MANAGE')],
  }, async (req, reply) => {
    const readDb = replicaRouter ? await replicaRouter.forRead() : db;
    const tid = req.auth.tenantId;
    const today = new Date().toISOString().slice(0, 10);

    // "POS transaction" = an invoice with at least one payment allocation coming
    // from a POS session (payments has pos_session_id; payment_allocations links
    // payments to invoices — payments has no invoice_id column of its own).
    const [todaySummary] = await readDb.execute(sql`
      SELECT
        COUNT(*)::int AS total_transactions,
        COALESCE(SUM(grand_total), 0) AS total_sales,
        COALESCE(AVG(grand_total), 0) AS avg_transaction_value
      FROM invoices
      WHERE tenant_id = ${tid}
        AND invoice_date::date = ${today}::date
        AND status != 'CANCELLED'
        AND EXISTS (
          SELECT 1 FROM payment_allocations pa
          JOIN payments px ON px.id = pa.payment_id
          WHERE pa.invoice_id = invoices.id AND px.pos_session_id IS NOT NULL
        )
    `) as unknown as Record<string, unknown>[];

    const hourlyData = await readDb.execute(sql`
      SELECT
        EXTRACT(HOUR FROM created_at)::int AS hour,
        COUNT(*)::int AS count,
        COALESCE(SUM(grand_total), 0) AS revenue
      FROM invoices
      WHERE tenant_id = ${tid}
        AND invoice_date::date = ${today}::date
        AND status != 'CANCELLED'
        AND EXISTS (
          SELECT 1 FROM payment_allocations pa
          JOIN payments px ON px.id = pa.payment_id
          WHERE pa.invoice_id = invoices.id AND px.pos_session_id IS NOT NULL
        )
      GROUP BY EXTRACT(HOUR FROM created_at)
      ORDER BY hour
    `) as unknown as Record<string, unknown>[];

    const lastFiveInvoices = await readDb.execute(sql`
      SELECT
        i.invoice_number,
        i.grand_total,
        i.created_at,
        COALESCE(c.display_name, 'Walk-in') AS customer_name
      FROM invoices i
      LEFT JOIN customers c ON c.id = i.customer_id AND c.tenant_id = ${tid}
      WHERE i.tenant_id = ${tid}
        AND i.invoice_date::date = ${today}::date
        AND i.status != 'CANCELLED'
        AND EXISTS (
          SELECT 1 FROM payment_allocations pa
          JOIN payments px ON px.id = pa.payment_id
          WHERE pa.invoice_id = i.id AND px.pos_session_id IS NOT NULL
        )
      ORDER BY i.created_at DESC
      LIMIT 5
    `) as unknown as Record<string, unknown>[];

    return reply.code(200).send({
      data: {
        today: todaySummary ?? { total_transactions: 0, total_sales: 0, avg_transaction_value: 0 },
        hourly: hourlyData,
        lastFiveInvoices,
      },
    });
  });
}
