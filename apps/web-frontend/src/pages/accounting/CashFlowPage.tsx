import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { reportsApi } from '../../api/endpoints.js';
import ERPPageHeader from '../../components/erp/ERPPageHeader.js';
import { ERPTableSkeleton } from '../../components/erp/ERPSkeleton.js';
import DatePicker from '../../components/ui/DatePicker.js';
import { formatCurrency } from '../../lib/format.js';

// Backend (CashFlowReport, apps/accounting-service/src/domain/ReportsEngine.ts) sends
// { label, amount } — this was "description", so every activity row rendered a blank label.
interface CashActivity {
  label: string;
  amount: number;
}

interface CFData {
  fromDate: string;
  toDate: string;
  openingCash: number;
  operatingActivities: CashActivity[];
  investingActivities: CashActivity[];
  financingActivities: CashActivity[];
  netOperating: number;
  netInvesting: number;
  netFinancing: number;
  closingCash: number;
}

function ActivitySection({
  title,
  activities,
  net,
  color,
}: {
  title: string;
  activities: CashActivity[];
  net: number;
  color: string;
}) {
  return (
    <div className="border border-default rounded-xl overflow-hidden">
      <div className={`px-4 py-3 border-b border-default font-semibold text-sm ${color}`}>
        {title}
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <tbody>
            {activities.map((a, i) => (
              <tr key={i} className="border-b border-default">
                <td className="px-4 py-2 pl-6 text-secondary">{a.label}</td>
                <td
                  className={`px-4 py-2 text-right font-mono ${a.amount < 0 ? 'text-danger' : 'text-success'}`}
                >
                  {formatCurrency(a.amount)}
                </td>
              </tr>
            ))}
            {activities.length === 0 && (
              <tr>
                <td colSpan={2} className="px-4 py-3 text-secondary text-center text-xs">
                  No activities
                </td>
              </tr>
            )}
          </tbody>
          <tfoot className="bg-surface-subtle">
            <tr>
              <td className="px-4 py-2.5 font-semibold text-primary">Net {title.split(' ')[0]}</td>
              <td
                className={`px-4 py-2.5 text-right font-mono font-semibold ${net < 0 ? 'text-danger' : 'text-success'}`}
              >
                {formatCurrency(net)}
              </td>
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  );
}

export default function CashFlowPage() {
  const now = new Date();
  const fyStart = `${now.getFullYear()}-04-01`;
  const today = now.toISOString().substring(0, 10);

  const [fromDate, setFromDate] = useState(fyStart);
  const [toDate, setToDate] = useState(today);

  const { data, isLoading } = useQuery({
    queryKey: ['cash-flow', fromDate, toDate],
    queryFn: () => reportsApi.cashFlow({ fromDate, toDate }),
    enabled: !!fromDate && !!toDate,
  });

  const cf: CFData | undefined = data as CFData;

  return (
    <div className="space-y-6">
      <ERPPageHeader
        variant="list"
        title="Cash Flow Statement"
        subtitle="Direct method — operating, investing, financing"
        actions={
          <div className="flex flex-wrap items-center gap-3">
            <DatePicker value={fromDate} onChange={setFromDate} />
            <span className="text-secondary text-sm">to</span>
            <DatePicker value={toDate} onChange={setToDate} />
          </div>
        }
      />

      {isLoading ? (
        <ERPTableSkeleton rows={8} />
      ) : !cf ? (
        <div className="flex items-center justify-center py-16 bg-surface-card rounded-xl border border-default">
          <p className="text-secondary">Select a date range to view the cash flow statement</p>
        </div>
      ) : (
        <div className="space-y-4">
          <div className="bg-surface-card rounded-xl border border-default px-4 py-3 flex justify-between items-center text-sm">
            <span className="font-semibold text-primary">Opening Cash Balance</span>
            <span className="font-mono font-semibold text-primary">
              {formatCurrency(cf.openingCash)}
            </span>
          </div>

          <ActivitySection
            title="Operating Activities"
            activities={cf.operatingActivities}
            net={cf.netOperating}
            color="text-info"
          />
          <ActivitySection
            title="Investing Activities"
            activities={cf.investingActivities}
            net={cf.netInvesting}
            color="text-accent-purple"
          />
          <ActivitySection
            title="Financing Activities"
            activities={cf.financingActivities}
            net={cf.netFinancing}
            color="text-warning"
          />

          <div className="bg-gray-900 rounded-xl px-4 py-4 flex justify-between items-center">
            <span className="font-semibold text-white">Closing Cash Balance</span>
            <span
              className={`font-mono text-xl font-bold ${cf.closingCash >= 0 ? 'text-green-400' : 'text-red-400'}`}
            >
              {formatCurrency(cf.closingCash)}
            </span>
          </div>
        </div>
      )}
    </div>
  );
}
