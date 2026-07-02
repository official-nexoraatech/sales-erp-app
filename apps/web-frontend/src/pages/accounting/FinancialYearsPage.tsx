import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { financialYearApi } from '../../api/endpoints.js';
import ERPPageHeader from '../../components/erp/ERPPageHeader.js';
import Button from '../../components/ui/Button.js';
import Badge from '../../components/ui/Badge.js';
import { ERPTableSkeleton } from '../../components/erp/ERPSkeleton.js';
import { formatDate } from '../../lib/format.js';

interface FinancialYear {
  id: number;
  yearCode: string;
  startDate: string;
  endDate: string;
  status: string;
  isCurrent: boolean;
}

interface ChecklistItem {
  label: string;
  passed: boolean;
  detail?: string;
}

const STATUS_COLORS: Record<string, 'green' | 'red' | 'yellow' | 'gray'> = {
  OPEN: 'green',
  CLOSED: 'gray',
};

export default function FinancialYearsPage() {
  const qc = useQueryClient();
  const [selectedFY, setSelectedFY] = useState<number | null>(null);
  const [checklist, setChecklist] = useState<ChecklistItem[] | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ['financial-years'],
    queryFn: () => financialYearApi.list(),
  });

  const years: FinancialYear[] = (data as { data?: { content?: FinancialYear[] } })?.data?.content ?? [];

  const closeYearMutation = useMutation({
    mutationFn: (id: number) => financialYearApi.close(id),
    onSuccess: () => {
      toast.success('Financial year closed successfully');
      qc.invalidateQueries({ queryKey: ['financial-years'] });
    },
    onError: (err: unknown) => {
      const msg = err instanceof Error ? err.message : 'Close failed';
      toast.error(msg);
    },
  });

  const runChecklist = async (id: number) => {
    setSelectedFY(id);
    setChecklist(null);
    try {
      const res = await financialYearApi.getCloseChecklist(id) as { data?: { items?: ChecklistItem[] } };
      setChecklist(res.data?.items ?? []);
    } catch {
      toast.error('Failed to run checklist');
    }
  };

  return (
    <div className="space-y-6">
      <ERPPageHeader
        variant="list"
        title="Financial Years"
        subtitle="Manage fiscal periods and year-end close"
      />

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="space-y-3">
          {isLoading ? (
            <ERPTableSkeleton rows={3} />
          ) : years.length === 0 ? (
            <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 flex items-center justify-center py-12 text-secondary text-sm">
              No financial years configured
            </div>
          ) : (
            years.map((fy) => (
              <div key={fy.id} className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-4">
                <div className="flex items-start justify-between">
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="font-semibold text-primary">{fy.yearCode}</span>
                      <Badge label={fy.status} color={STATUS_COLORS[fy.status] ?? 'gray'} />
                      {fy.isCurrent && <Badge label="Current" color="blue" />}
                    </div>
                    <div className="text-secondary text-xs mt-1">{formatDate(fy.startDate)} — {formatDate(fy.endDate)}</div>
                  </div>
                  {fy.status === 'OPEN' && (
                    <div className="flex gap-2">
                      <Button variant="ghost" size="sm" onClick={() => runChecklist(fy.id)}>Run Checklist</Button>
                      <Button
                        variant="danger"
                        size="sm"
                        disabled={closeYearMutation.isPending}
                        onClick={() => {
                          if (window.confirm(`Are you sure you want to close FY ${fy.yearCode}? This cannot be undone.`)) {
                            closeYearMutation.mutate(fy.id);
                          }
                        }}
                      >
                        Close Year
                      </Button>
                    </div>
                  )}
                </div>
              </div>
            ))
          )}
        </div>

        {checklist && (
          <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-4">
            <h3 className="font-semibold text-primary mb-3">Pre-Close Checklist</h3>
            <div className="space-y-2">
              {checklist.map((item, i) => (
                <div key={i} className={`flex items-start gap-2.5 p-2.5 rounded-lg text-sm ${item.passed ? 'bg-green-50 dark:bg-green-900/20' : 'bg-red-50 dark:bg-red-900/20'}`}>
                  <span className={item.passed ? 'text-green-600' : 'text-red-600'}>{item.passed ? '✓' : '✗'}</span>
                  <div>
                    <div className={`font-medium ${item.passed ? 'text-green-800 dark:text-green-300' : 'text-red-800 dark:text-red-300'}`}>{item.label}</div>
                    {item.detail && <div className="text-xs text-secondary mt-0.5">{item.detail}</div>}
                  </div>
                </div>
              ))}
            </div>
            <div className={`mt-4 px-3 py-2 rounded-lg text-sm font-medium text-center ${checklist.every((i) => i.passed) ? 'bg-green-100 dark:bg-green-900/30 text-green-700' : 'bg-red-100 dark:bg-red-900/30 text-red-700'}`}>
              {checklist.every((i) => i.passed) ? '✓ Ready for year-end close' : '✗ Some checks failed — resolve before closing'}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
