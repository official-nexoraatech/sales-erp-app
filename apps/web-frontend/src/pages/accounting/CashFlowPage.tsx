import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { reportsApi } from '../../api/endpoints.js';
import ERPPageHeader from '../../components/erp/ERPPageHeader.js';
import { ERPTableSkeleton } from '../../components/erp/ERPSkeleton.js';
import { formatCurrency } from '../../lib/format.js';

interface CashActivity {
  description: string;
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

function ActivitySection({ title, activities, net, color }: { title: string; activities: CashActivity[]; net: number; color: string }) {
  return (
    <div className="border border-gray-200 dark:border-gray-700 rounded-xl overflow-hidden">
      <div className={`px-4 py-3 border-b border-gray-200 dark:border-gray-700 font-semibold text-sm ${color}`}>{title}</div>
      <table className="w-full text-sm">
        <tbody>
          {activities.map((a, i) => (
            <tr key={i} className="border-b border-gray-100 dark:border-gray-700">
              <td className="px-4 py-2 pl-6 text-secondary">{a.description}</td>
              <td className={`px-4 py-2 text-right font-mono ${a.amount < 0 ? 'text-red-500' : 'text-green-600'}`}>{formatCurrency(a.amount)}</td>
            </tr>
          ))}
          {activities.length === 0 && (
            <tr><td colSpan={2} className="px-4 py-3 text-secondary text-center text-xs">No activities</td></tr>
          )}
        </tbody>
        <tfoot className="bg-gray-50 dark:bg-gray-900/30">
          <tr>
            <td className="px-4 py-2.5 font-semibold text-primary">Net {title.split(' ')[0]}</td>
            <td className={`px-4 py-2.5 text-right font-mono font-semibold ${net < 0 ? 'text-red-500' : 'text-green-600 dark:text-green-400'}`}>{formatCurrency(net)}</td>
          </tr>
        </tfoot>
      </table>
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

  const cf: CFData | undefined = (data as { data?: CFData })?.data;

  return (
    <div className="space-y-6">
      <ERPPageHeader
        variant="list"
        title="Cash Flow Statement"
        subtitle="Direct method — operating, investing, financing"
        actions={
          <div className="flex flex-wrap items-center gap-3">
            <input type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)} className="border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-1.5 text-sm bg-white dark:bg-gray-800 text-primary" />
            <span className="text-secondary text-sm">to</span>
            <input type="date" value={toDate} onChange={(e) => setToDate(e.target.value)} className="border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-1.5 text-sm bg-white dark:bg-gray-800 text-primary" />
          </div>
        }
      />

      {isLoading ? (
        <ERPTableSkeleton rows={8} />
      ) : !cf ? (
        <div className="flex items-center justify-center py-16 bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700">
          <p className="text-secondary">Select a date range to view the cash flow statement</p>
        </div>
      ) : (
        <div className="space-y-4">
          <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 px-4 py-3 flex justify-between items-center text-sm">
            <span className="font-semibold text-primary">Opening Cash Balance</span>
            <span className="font-mono font-semibold text-primary">{formatCurrency(cf.openingCash)}</span>
          </div>

          <ActivitySection
            title="Operating Activities"
            activities={cf.operatingActivities}
            net={cf.netOperating}
            color="text-blue-700 dark:text-blue-400"
          />
          <ActivitySection
            title="Investing Activities"
            activities={cf.investingActivities}
            net={cf.netInvesting}
            color="text-purple-700 dark:text-purple-400"
          />
          <ActivitySection
            title="Financing Activities"
            activities={cf.financingActivities}
            net={cf.netFinancing}
            color="text-orange-700 dark:text-orange-400"
          />

          <div className="bg-gray-900 dark:bg-gray-950 rounded-xl px-4 py-4 flex justify-between items-center">
            <span className="font-semibold text-white">Closing Cash Balance</span>
            <span className={`font-mono text-xl font-bold ${cf.closingCash >= 0 ? 'text-green-400' : 'text-red-400'}`}>{formatCurrency(cf.closingCash)}</span>
          </div>
        </div>
      )}
    </div>
  );
}
