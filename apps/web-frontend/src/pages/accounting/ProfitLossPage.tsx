import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { reportsApi, costCenterApi } from '../../api/endpoints.js';
import { useAuthStore } from '../../store/auth.store.js';
import { PERMISSIONS } from '../../constants/permissions.js';
import ERPPageHeader from '../../components/erp/ERPPageHeader.js';
import { ERPTableSkeleton } from '../../components/erp/ERPSkeleton.js';
import Button from '../../components/ui/Button.js';
import DatePicker from '../../components/ui/DatePicker.js';
import { formatCurrency } from '../../lib/format.js';

interface CostCenterOption {
  id: number;
  code: string;
  name: string;
  isActive: boolean;
}

interface PLByCostCenterLine {
  costCenterId: number | null;
  costCenterCode: string | null;
  costCenterName: string | null;
  revenue: number;
  cogs: number;
  operatingExpenses: number;
  otherExpenses: number;
  netProfit: number;
}

// Matches ReportsEngine.ProfitLossReport (apps/accounting-service/src/domain/ReportsEngine.ts)
// — every field here except netProfit previously had a name that didn't exist on the real
// response (revenue/salesReturns/netRevenue/cogs/opEx/otherIncome/financialCharges), so the
// whole statement rendered formatCurrency(undefined) for everything but the bottom line.
interface PLData {
  from: string;
  to: string;
  totalRevenue: number;
  totalContraRevenue: number;
  totalCogs: number;
  grossProfit: number;
  totalOperatingExpenses: number;
  operatingProfit: number;
  totalOtherIncome: number;
  totalFinancialCharges: number;
  netProfit: number;
}

function PLRow({
  label,
  amount,
  indent = 0,
  bold = false,
  highlight,
}: {
  label: string;
  amount: number;
  indent?: number;
  bold?: boolean;
  highlight?: 'profit' | 'loss';
}) {
  const colorClass =
    highlight === 'profit'
      ? 'text-green-600 dark:text-green-400'
      : highlight === 'loss'
        ? 'text-red-600 dark:text-red-400'
        : 'text-primary';
  return (
    <tr
      className={`border-b border-gray-100 dark:border-gray-700 ${bold ? 'bg-gray-50 dark:bg-gray-900/30' : ''}`}
    >
      <td className="px-4 py-2.5" style={{ paddingLeft: `${16 + indent * 24}px` }}>
        <span className={`text-sm ${bold ? 'font-semibold' : ''} ${colorClass}`}>{label}</span>
      </td>
      <td
        className={`px-4 py-2.5 text-right font-mono text-sm ${bold ? 'font-semibold' : ''} ${colorClass}`}
      >
        {formatCurrency(amount)}
      </td>
    </tr>
  );
}

export default function ProfitLossPage() {
  const now = new Date();
  const fyStart = `${now.getFullYear()}-04-01`;
  const today = now.toISOString().substring(0, 10);

  const [fromDate, setFromDate] = useState(fyStart);
  const [toDate, setToDate] = useState(today);
  const [view, setView] = useState<'standard' | 'byCostCenter'>('standard');

  const { data, isLoading } = useQuery({
    queryKey: ['profit-loss', fromDate, toDate],
    queryFn: () => reportsApi.profitLoss({ fromDate, toDate }),
    enabled: !!fromDate && !!toDate,
  });

  const pl: PLData | undefined = data as PLData;

  // PG-037: tab only appears once the tenant has at least one active cost center —
  // don't show an empty, confusing selector to tenants who never opted in.
  const canViewCostCenters = useAuthStore((s) => s.hasPermission(PERMISSIONS.COST_CENTER_VIEW));
  const { data: costCentersData } = useQuery({
    queryKey: ['cost-centers'],
    queryFn: () => costCenterApi.list(),
    enabled: canViewCostCenters,
  });
  const activeCostCenters = ((costCentersData as CostCenterOption[]) ?? []).filter(
    (cc) => cc.isActive
  );

  const { data: byCcData, isLoading: byCcLoading } = useQuery({
    queryKey: ['profit-loss-by-cost-center', fromDate, toDate],
    queryFn: () => reportsApi.pnlByCostCenter({ fromDate, toDate }),
    enabled: view === 'byCostCenter' && !!fromDate && !!toDate,
  });
  const byCcLines: PLByCostCenterLine[] =
    (byCcData as { lines?: PLByCostCenterLine[] })?.lines ?? [];

  return (
    <div className="space-y-6">
      <ERPPageHeader
        variant="list"
        title="Profit & Loss Statement"
        subtitle="Income and expense summary"
        actions={
          <div className="flex flex-wrap items-center gap-3">
            <DatePicker value={fromDate} onChange={setFromDate} />
            <span className="text-secondary text-sm">to</span>
            <DatePicker value={toDate} onChange={setToDate} />
          </div>
        }
      />

      {activeCostCenters.length > 0 && (
        <div className="flex gap-2">
          <Button
            variant={view === 'standard' ? 'primary' : 'secondary'}
            size="sm"
            onClick={() => setView('standard')}
          >
            Statement
          </Button>
          <Button
            variant={view === 'byCostCenter' ? 'primary' : 'secondary'}
            size="sm"
            onClick={() => setView('byCostCenter')}
          >
            By Cost Center
          </Button>
        </div>
      )}

      <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700">
        {view === 'byCostCenter' ? (
          byCcLoading ? (
            <ERPTableSkeleton rows={6} />
          ) : (
            <table className="w-full">
              <thead className="bg-gray-50 dark:bg-gray-900/40 border-b border-gray-200 dark:border-gray-700">
                <tr>
                  <th className="px-4 py-3 text-left font-medium text-secondary">Cost Center</th>
                  <th className="px-4 py-3 text-right font-medium text-secondary">Revenue</th>
                  <th className="px-4 py-3 text-right font-medium text-secondary">COGS</th>
                  <th className="px-4 py-3 text-right font-medium text-secondary">
                    Operating Exp.
                  </th>
                  <th className="px-4 py-3 text-right font-medium text-secondary">Other Exp.</th>
                  <th className="px-4 py-3 text-right font-medium text-secondary">Net Profit</th>
                </tr>
              </thead>
              <tbody>
                {byCcLines.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="px-4 py-8 text-center text-secondary text-sm">
                      No tagged postings in this date range
                    </td>
                  </tr>
                ) : (
                  byCcLines.map((l) => (
                    <tr
                      key={l.costCenterId ?? 'unassigned'}
                      className="border-b border-gray-100 dark:border-gray-700"
                    >
                      <td className="px-4 py-2.5 text-sm text-primary">
                        {l.costCenterName
                          ? `${l.costCenterCode} — ${l.costCenterName}`
                          : 'Unassigned'}
                      </td>
                      <td className="px-4 py-2.5 text-right font-mono text-sm text-primary">
                        {formatCurrency(l.revenue)}
                      </td>
                      <td className="px-4 py-2.5 text-right font-mono text-sm text-primary">
                        {formatCurrency(l.cogs)}
                      </td>
                      <td className="px-4 py-2.5 text-right font-mono text-sm text-primary">
                        {formatCurrency(l.operatingExpenses)}
                      </td>
                      <td className="px-4 py-2.5 text-right font-mono text-sm text-primary">
                        {formatCurrency(l.otherExpenses)}
                      </td>
                      <td
                        className={`px-4 py-2.5 text-right font-mono text-sm font-semibold ${l.netProfit >= 0 ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'}`}
                      >
                        {formatCurrency(l.netProfit)}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          )
        ) : isLoading ? (
          <ERPTableSkeleton rows={10} />
        ) : !pl ? (
          <div className="flex items-center justify-center py-16">
            <p className="text-secondary">Select a date range to view the P&L</p>
          </div>
        ) : (
          <table className="w-full">
            <thead className="bg-gray-50 dark:bg-gray-900/40 border-b border-gray-200 dark:border-gray-700">
              <tr>
                <th className="px-4 py-3 text-left font-medium text-secondary">Particulars</th>
                <th className="px-4 py-3 text-right font-medium text-secondary">Amount (₹)</th>
              </tr>
            </thead>
            <tbody>
              <PLRow label="Revenue from Operations" amount={pl.totalRevenue} bold />
              <PLRow label="Less: Sales Returns" amount={-pl.totalContraRevenue} indent={1} />
              <PLRow
                label="Net Revenue"
                amount={pl.totalRevenue - pl.totalContraRevenue}
                bold
                highlight={pl.totalRevenue - pl.totalContraRevenue >= 0 ? 'profit' : 'loss'}
              />
              <tr>
                <td colSpan={2} className="h-2" />
              </tr>
              <PLRow label="Cost of Goods Sold (COGS)" amount={pl.totalCogs} bold />
              <PLRow
                label="Gross Profit"
                amount={pl.grossProfit}
                bold
                highlight={pl.grossProfit >= 0 ? 'profit' : 'loss'}
              />
              <tr>
                <td colSpan={2} className="h-2" />
              </tr>
              <PLRow label="Operating Expenses" amount={pl.totalOperatingExpenses} bold />
              <PLRow
                label="Operating Profit (EBIT)"
                amount={pl.operatingProfit}
                bold
                highlight={pl.operatingProfit >= 0 ? 'profit' : 'loss'}
              />
              <tr>
                <td colSpan={2} className="h-2" />
              </tr>
              <PLRow label="Other Income" amount={pl.totalOtherIncome} indent={1} />
              <PLRow label="Financial Charges" amount={-pl.totalFinancialCharges} indent={1} />
              <tr>
                <td colSpan={2} className="h-px bg-gray-200 dark:bg-gray-600" />
              </tr>
              <PLRow
                label="Net Profit / (Loss)"
                amount={pl.netProfit}
                bold
                highlight={pl.netProfit >= 0 ? 'profit' : 'loss'}
              />
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
