import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus, Trash2, Clock, Mail } from 'lucide-react';
import { reportSchedulesApi, reportsEngineApi } from '../../api/endpoints.js';

interface Schedule {
  id: number;
  reportSlug: string;
  format: string;
  cronExpression: string;
  recipients: string[];
  active: number;
  createdAt: string;
}

interface ReportDef {
  slug: string;
  name: string;
}

const CRON_PRESETS = [
  { label: 'Daily at 7 AM', value: '0 7 * * *' },
  { label: 'Weekly Monday 7 AM', value: '0 7 * * 1' },
  { label: 'Monthly 1st at 7 AM', value: '0 7 1 * *' },
  { label: 'Every 6 hours', value: '0 */6 * * *' },
];

export default function SchedulesPage() {
  const qc = useQueryClient();
  const [showForm, setShowForm] = useState(false);
  const [reportSlug, setReportSlug] = useState('');
  const [format, setFormat] = useState<'PDF' | 'EXCEL' | 'CSV'>('EXCEL');
  const [cronExpression, setCronExpression] = useState('0 7 * * *');
  const [recipients, setRecipients] = useState('');

  const { data: schedules, isLoading } = useQuery({
    queryKey: ['report-schedules'],
    queryFn: reportSchedulesApi.list,
  });

  const { data: reportsData } = useQuery({
    queryKey: ['report-list'],
    queryFn: reportsEngineApi.list,
  });

  const allReports: ReportDef[] = reportsData
    ? Object.values(reportsData.grouped).flat() as ReportDef[]
    : [];

  const createMutation = useMutation({
    mutationFn: reportSchedulesApi.create,
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['report-schedules'] });
      setShowForm(false);
      setReportSlug('');
      setRecipients('');
    },
  });

  const deleteMutation = useMutation({
    mutationFn: reportSchedulesApi.delete,
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['report-schedules'] }),
  });

  function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!reportSlug || !cronExpression || !recipients.trim()) return;
    createMutation.mutate({
      reportSlug,
      format,
      cronExpression,
      recipients: recipients.split(',').map((r) => r.trim()).filter(Boolean),
    });
  }

  const schedulesArr = (schedules as Schedule[] | undefined) ?? [];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-primary flex items-center gap-2">
            <Clock size={22} className="text-brand" /> Report Schedules
          </h1>
          <p className="text-sm text-secondary mt-0.5">Automate report delivery via email</p>
        </div>
        <button
          onClick={() => setShowForm((v) => !v)}
          className="flex items-center gap-2 px-4 py-2 bg-primary text-white text-sm font-medium rounded-lg hover:bg-primary/90 transition-colors"
        >
          <Plus size={15} /> New Schedule
        </button>
      </div>

      {/* Create form */}
      {showForm && (
        <form onSubmit={handleCreate} className="bg-surface-card border border-default rounded-xl p-5 space-y-4">
          <h3 className="text-sm font-semibold text-primary">New Schedule</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-secondary mb-1">Report <span className="text-error">*</span></label>
              <select
                required
                value={reportSlug}
                onChange={(e) => setReportSlug(e.target.value)}
                className="w-full text-sm border border-default rounded-lg px-3 py-2 bg-surface-card text-primary focus:outline-none focus:ring-2 focus:ring-primary/30"
              >
                <option value="">Select a report</option>
                {allReports.map((r) => (
                  <option key={r.slug} value={r.slug}>{r.name}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-secondary mb-1">Format</label>
              <select
                value={format}
                onChange={(e) => setFormat(e.target.value as 'PDF' | 'EXCEL' | 'CSV')}
                className="w-full text-sm border border-default rounded-lg px-3 py-2 bg-surface-card text-primary focus:outline-none focus:ring-2 focus:ring-primary/30"
              >
                <option value="EXCEL">Excel (.xlsx)</option>
                <option value="CSV">CSV</option>
                <option value="PDF">PDF</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-secondary mb-1">Schedule (Cron)</label>
              <div className="flex gap-2">
                <input
                  required
                  value={cronExpression}
                  onChange={(e) => setCronExpression(e.target.value)}
                  placeholder="0 7 * * *"
                  className="flex-1 text-sm border border-default rounded-lg px-3 py-2 bg-surface-card text-primary font-mono focus:outline-none focus:ring-2 focus:ring-primary/30"
                />
              </div>
              <div className="flex flex-wrap gap-1 mt-1">
                {CRON_PRESETS.map((preset) => (
                  <button
                    key={preset.value}
                    type="button"
                    onClick={() => setCronExpression(preset.value)}
                    className="text-xs px-2 py-0.5 rounded bg-surface-raised text-secondary hover:text-primary transition-colors"
                  >
                    {preset.label}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <label className="block text-xs font-medium text-secondary mb-1">Recipients (comma-separated) <span className="text-error">*</span></label>
              <input
                required
                type="text"
                value={recipients}
                onChange={(e) => setRecipients(e.target.value)}
                placeholder="user@company.com, manager@company.com"
                className="w-full text-sm border border-default rounded-lg px-3 py-2 bg-surface-card text-primary focus:outline-none focus:ring-2 focus:ring-primary/30"
              />
            </div>
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={() => setShowForm(false)}
              className="px-4 py-2 text-sm text-secondary hover:text-primary border border-default rounded-lg transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={createMutation.isPending}
              className="px-4 py-2 text-sm font-medium bg-primary text-white rounded-lg hover:bg-primary/90 disabled:opacity-60 transition-colors"
            >
              {createMutation.isPending ? 'Creating...' : 'Create Schedule'}
            </button>
          </div>
          {createMutation.isError && (
            <p className="text-error text-sm">{(createMutation.error as Error).message}</p>
          )}
        </form>
      )}

      {/* Schedules list */}
      {isLoading && <p className="text-secondary text-sm">Loading schedules...</p>}

      {!isLoading && schedulesArr.length === 0 && (
        <div className="text-center py-16 text-secondary">
          <Clock size={28} className="mx-auto mb-3 opacity-30" />
          <p className="text-sm">No schedules yet. Create one to auto-dispatch reports by email.</p>
        </div>
      )}

      <div className="space-y-3">
        {schedulesArr.map((schedule) => {
          const def = allReports.find((r) => r.slug === schedule.reportSlug);
          const recipientsArr = schedule.recipients as unknown as string[];
          return (
            <div key={schedule.id} className="bg-surface-card border border-default rounded-xl p-4 flex items-start justify-between gap-4">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-1">
                  <span className={`w-2 h-2 rounded-full shrink-0 ${schedule.active ? 'bg-success' : 'bg-surface-raised'}`} />
                  <p className="text-sm font-semibold text-primary">{def?.name ?? schedule.reportSlug}</p>
                  <span className="text-xs px-1.5 py-0.5 rounded bg-surface-raised text-secondary">{schedule.format}</span>
                </div>
                <div className="flex items-center gap-4 text-xs text-secondary">
                  <span className="flex items-center gap-1"><Clock size={11} /> <code className="font-mono">{schedule.cronExpression}</code></span>
                  <span className="flex items-center gap-1">
                    <Mail size={11} /> {recipientsArr.join(', ')}
                  </span>
                </div>
              </div>
              <button
                onClick={() => deleteMutation.mutate(schedule.id)}
                disabled={deleteMutation.isPending}
                className="p-1.5 rounded-lg text-error hover:bg-error-bg transition-colors disabled:opacity-40 shrink-0"
                title="Delete schedule"
              >
                <Trash2 size={14} />
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}
