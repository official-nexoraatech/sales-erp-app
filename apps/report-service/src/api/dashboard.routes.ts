import { FastifyInstance } from 'fastify';
import { sql } from 'drizzle-orm';
import type { ErpDatabase } from '@erp/db';
import { authenticate } from '../middleware/authenticate.js';
import { requirePermission } from '../middleware/authorize.js';

type DbClient = ErpDatabase;

export async function dashboardRoutes(fastify: FastifyInstance, db: DbClient): Promise<void> {
  // GET /api/v2/dashboard/kpis â€” Today and month KPIs from CQRS projections
  fastify.get('/api/v2/dashboard/kpis', {
    preHandler: [authenticate, requirePermission('DASHBOARD_VIEW')],
  }, async (req, reply) => {
    const tid = req.auth.tenantId;
    const today = new Date().toISOString().slice(0, 10);
    const monthStart = today.slice(0, 7) + '-01';

    const [todayKpis] = await db.execute(sql`
      SELECT
        COALESCE(SUM(CASE WHEN date = ${today}::date THEN total_sales END), 0) AS today_sales,
        COALESCE(SUM(CASE WHEN date = ${today}::date THEN total_collections END), 0) AS today_collection,
        COALESCE(SUM(CASE WHEN date = ${today}::date THEN total_purchases END), 0) AS today_purchase,
        COALESCE(SUM(CASE WHEN date = ${today}::date THEN total_expenses END), 0) AS today_expense,
        COALESCE(SUM(CASE WHEN date >= ${monthStart}::date THEN total_sales END), 0) AS month_sales,
        COALESCE(SUM(CASE WHEN date >= ${monthStart}::date THEN total_collections END), 0) AS month_collection,
        COALESCE(SUM(CASE WHEN date >= ${monthStart}::date THEN gross_profit END), 0) AS month_profit,
        COALESCE(SUM(CASE WHEN date >= ${monthStart}::date THEN invoice_count END), 0) AS month_invoices
      FROM projection_dashboard_daily
      WHERE tenant_id = ${tid}
        AND date >= ${monthStart}::date
    `) as unknown as Record<string, unknown>[];

    // Outstanding receivables & payables from projections
    const [balances] = await db.execute(sql`
      SELECT
        COALESCE(SUM(CASE WHEN type = 'RECEIVABLE' THEN balance END), 0) AS total_receivable,
        COALESCE(SUM(CASE WHEN type = 'PAYABLE' THEN balance END), 0) AS total_payable
      FROM (
        SELECT 'RECEIVABLE' AS type, SUM(balance) AS balance
        FROM projection_customer_balance WHERE tenant_id = ${tid} AND balance > 0
        UNION ALL
        SELECT 'PAYABLE', SUM(balance)
        FROM projection_supplier_balance WHERE tenant_id = ${tid} AND balance > 0
      ) t
    `) as unknown as Record<string, unknown>[];

    return reply.code(200).send({
      data: {
        today: todayKpis ?? {},
        balances: balances ?? {},
      },
    });
  });

  // GET /api/v2/dashboard/charts â€” Chart data for Owner dashboard
  fastify.get('/api/v2/dashboard/charts', {
    preHandler: [authenticate, requirePermission('DASHBOARD_VIEW')],
  }, async (req, reply) => {
    const tid = req.auth.tenantId;
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const today = new Date().toISOString().slice(0, 10);

    // 1. Daily sales trend (last 30 days)
    const salesTrend = await db.execute(sql`
      SELECT date, total_sales, total_collections, gross_profit
      FROM projection_dashboard_daily
      WHERE tenant_id = ${tid} AND date BETWEEN ${thirtyDaysAgo}::date AND ${today}::date
      ORDER BY date
    `) as unknown as Record<string, unknown>[];

    // 2. Sales by category (current month)
    const monthStart = today.slice(0, 7) + '-01';
    const salesByCategory = await db.execute(sql`
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
    const paymentModes = await db.execute(sql`
      SELECT payment_mode AS mode, SUM(amount) AS total
      FROM payments
      WHERE tenant_id = ${tid} AND payment_date >= ${monthStart}::date
      GROUP BY payment_mode
      ORDER BY total DESC
    `) as unknown as Record<string, unknown>[];

    // 4. Stock value by category
    const stockByCategory = await db.execute(sql`
      SELECT cat.name AS category, SUM(psl.quantity_on_hand * COALESCE(psl.fifo_unit_cost, 0)) AS value
      FROM projection_stock_level psl
      JOIN items it ON it.id = psl.item_id AND it.tenant_id = ${tid}
      LEFT JOIN categories cat ON cat.id = it.category_id
      WHERE psl.tenant_id = ${tid}
      GROUP BY cat.id, cat.name
      ORDER BY value DESC
      LIMIT 8
    `) as unknown as Record<string, unknown>[];

    // 5. Monthly comparison (current vs prev month)
    const prevMonthStart = new Date(new Date(monthStart).setMonth(new Date(monthStart).getMonth() - 1))
      .toISOString().slice(0, 10);
    const prevMonthEnd = new Date(new Date(monthStart).setDate(0)).toISOString().slice(0, 10);

    const monthlyComparisonRows = await db.execute(sql`
      SELECT
        SUM(CASE WHEN date >= ${monthStart}::date THEN total_sales ELSE 0 END) AS current_sales,
        SUM(CASE WHEN date >= ${prevMonthStart}::date AND date <= ${prevMonthEnd}::date THEN total_sales ELSE 0 END) AS prev_sales,
        SUM(CASE WHEN date >= ${monthStart}::date THEN gross_profit ELSE 0 END) AS current_profit,
        SUM(CASE WHEN date >= ${prevMonthStart}::date AND date <= ${prevMonthEnd}::date THEN gross_profit ELSE 0 END) AS prev_profit
      FROM projection_dashboard_daily
      WHERE tenant_id = ${tid}
        AND date >= ${prevMonthStart}::date
    `) as unknown as Record<string, unknown>[];
    const monthlyComparison = monthlyComparisonRows[0];

    // 6. Top 5 customers by sales (current month)
    const topCustomers = await db.execute(sql`
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
    const receivablesAgeing = await db.execute(sql`
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
      ORDER BY
        CASE bucket WHEN 'Current' THEN 1 WHEN '1-30d' THEN 2 WHEN '31-60d' THEN 3 WHEN '61-90d' THEN 4 ELSE 5 END
    `) as unknown as Record<string, unknown>[];

    // 8. Purchase trend (last 30 days)
    const purchaseTrend = await db.execute(sql`
      SELECT date, total_purchases
      FROM projection_dashboard_daily
      WHERE tenant_id = ${tid} AND date BETWEEN ${thirtyDaysAgo}::date AND ${today}::date
      ORDER BY date
    `) as unknown as Record<string, unknown>[];

    return reply.code(200).send({
      data: {
        salesTrend,
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

  // GET /api/v2/dashboard/alerts â€” Alert widgets (low stock, overdue invoices, pending POs)
  fastify.get('/api/v2/dashboard/alerts', {
    preHandler: [authenticate, requirePermission('DASHBOARD_VIEW')],
  }, async (req, reply) => {
    const tid = req.auth.tenantId;
    const today = new Date().toISOString().slice(0, 10);

    const [lowStockCount] = await db.execute(sql`
      SELECT COUNT(*)::int AS count
      FROM projection_stock_level psl
      JOIN items it ON it.id = psl.item_id AND it.tenant_id = ${tid}
      WHERE psl.tenant_id = ${tid}
        AND psl.quantity_on_hand <= COALESCE(it.reorder_level, 0)
        AND it.reorder_level > 0
    `) as unknown as Record<string, unknown>[];

    const [overdueInvoices] = await db.execute(sql`
      SELECT COUNT(*)::int AS count, COALESCE(SUM(grand_total - COALESCE(paid_amount, 0)), 0) AS total_amount
      FROM invoices
      WHERE tenant_id = ${tid}
        AND due_date < ${today}::date
        AND (grand_total - COALESCE(paid_amount, 0)) > 0
        AND status NOT IN ('CANCELLED', 'PAID')
    `) as unknown as Record<string, unknown>[];

    const [pendingPOs] = await db.execute(sql`
      SELECT COUNT(*)::int AS count
      FROM purchase_orders
      WHERE tenant_id = ${tid}
        AND status IN ('APPROVED', 'PARTIAL')
    `) as unknown as Record<string, unknown>[];

    const [pendingGRNs] = await db.execute(sql`
      SELECT COUNT(*)::int AS count
      FROM grns
      WHERE tenant_id = ${tid}
        AND status = 'PENDING'
    `) as unknown as Record<string, unknown>[];

    const [pendingPayments] = await db.execute(sql`
      SELECT COUNT(*)::int AS count, COALESCE(SUM(grand_total - COALESCE(paid_amount, 0)), 0) AS total_amount
      FROM grns
      WHERE tenant_id = ${tid}
        AND due_date < ${today}::date
        AND (grand_total - COALESCE(paid_amount, 0)) > 0
        AND status != 'CANCELLED'
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

  // GET /api/v2/pos-analytics â€” Real-time POS analytics sidebar data
  fastify.get('/api/v2/pos-analytics', {
    preHandler: [authenticate, requirePermission('POS_MANAGE')],
  }, async (req, reply) => {
    const tid = req.auth.tenantId;
    const today = new Date().toISOString().slice(0, 10);

    const [todaySummary] = await db.execute(sql`
      SELECT
        COUNT(*)::int AS total_transactions,
        COALESCE(SUM(grand_total), 0) AS total_sales,
        COALESCE(AVG(grand_total), 0) AS avg_transaction_value
      FROM invoices
      WHERE tenant_id = ${tid}
        AND invoice_date::date = ${today}::date
        AND status != 'CANCELLED'
        AND EXISTS (SELECT 1 FROM payments px WHERE px.invoice_id = invoices.id AND px.pos_session_id IS NOT NULL)
    `) as unknown as Record<string, unknown>[];

    const hourlyData = await db.execute(sql`
      SELECT
        EXTRACT(HOUR FROM created_at)::int AS hour,
        COUNT(*)::int AS count,
        COALESCE(SUM(grand_total), 0) AS revenue
      FROM invoices
      WHERE tenant_id = ${tid}
        AND invoice_date::date = ${today}::date
        AND status != 'CANCELLED'
        AND EXISTS (SELECT 1 FROM payments px WHERE px.invoice_id = invoices.id AND px.pos_session_id IS NOT NULL)
      GROUP BY EXTRACT(HOUR FROM created_at)
      ORDER BY hour
    `) as unknown as Record<string, unknown>[];

    const lastFiveInvoices = await db.execute(sql`
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
        AND EXISTS (SELECT 1 FROM payments px WHERE px.invoice_id = i.id AND px.pos_session_id IS NOT NULL)
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

