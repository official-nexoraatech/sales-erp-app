import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery, useMutation } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { ArrowLeft, Download, RefreshCw, ChevronDown } from 'lucide-react';
import { reportsEngineApi, type ReportRunPending } from '../../api/endpoints.js';
import { ERPDetailSkeleton } from '../../components/erp/ERPSkeleton.js';
import ERPEmptyState from '../../components/erp/ERPEmptyState.js';

interface ParamDef {
  key: string;
  label: string;
  type: string;
  required: boolean;
  options?: { value: string; label: string }[];
  default?: string;
}

interface ColumnDef {
  key: string;
  label: string;
  type: string;
  align?: string;
}

interface ReportDefinition {
  slug: string;
  name: string;
  category: string;
  description: string;
  params: ParamDef[];
  columns: ColumnDef[];
  permission: string;
}

interface ReportResult {
  rows: Record<string, string | number | null>[];
  totalRows: number;
  generatedAt: string;
  totals: Record<string, number>;
  durationMs: number;
  definition: ReportDefinition;
}

function formatCell(value: string | number | null, type: string): string {
  if (value === null || value === undefined) return '–';
  if (type === 'currency') {
    const n = parseFloat(String(value));
    return isNaN(n)
      ? '–'
      : `₹${n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  }
  if (type === 'percent') {
    const n = parseFloat(String(value));
    return isNaN(n) ? '–' : `${n.toFixed(2)}%`;
  }
  if (type === 'number') {
    const n = parseFloat(String(value));
    return isNaN(n) ? '–' : n.toLocaleString('en-IN');
  }
  if (type === 'date') {
    const d = new Date(String(value));
    return isNaN(d.getTime()) ? String(value) : d.toLocaleDateString('en-IN');
  }
  return String(value);
}

export default function ReportViewerPage() {
  const { slug } = useParams<{ slug: string }>();
  const navigate = useNavigate();

  const { data: definitionRaw, isLoading: isDefinitionLoading } = useQuery({
    queryKey: ['report-def', slug],
    queryFn: () => reportsEngineApi.getDefinition(slug!),
    enabled: !!slug,
  });

  const definition = definitionRaw as ReportDefinition | undefined;

  const today = new Date().toISOString().slice(0, 10);
  const monthStart = today.slice(0, 7) + '-01';

  const [paramValues, setParamValues] = useState<Record<string, string>>(() => {
    const defaults: Record<string, string> = {};
    if (definition?.params) {
      for (const p of definition.params) {
        if (p.key === 'fromDate') defaults[p.key] = monthStart;
        else if (p.key === 'toDate' || p.key === 'asOfDate' || p.key === 'date')
          defaults[p.key] = today;
        else if (p.default) defaults[p.key] = p.default;
      }
    }
    return defaults;
  });

  const [result, setResult] = useState<ReportResult | null>(null);
  const [page, setPage] = useState(0);
  const [pendingRunId, setPendingRunId] = useState<number | null>(null);
  const PAGE_SIZE = 100;

  const runMutation = useMutation({
    mutationFn: () => reportsEngineApi.run(slug!, paramValues, 'JSON'),
    onSuccess: (data) => {
      // Reports flagged supportsAsync on the backend always queue the job and return
      // {runId, status: PENDING} instead of the report rows, regardless of the async
      // param sent — poll run-history until the job finishes to get the real result.
      if (
        data &&
        typeof data === 'object' &&
        'status' in data &&
        (data as ReportRunPending).status === 'PENDING'
      ) {
        setResult(null);
        setPendingRunId((data as ReportRunPending).runId);
      } else {
        setResult(data as ReportResult);
        setPage(0);
      }
    },
  });

  const { data: runStatus } = useQuery({
    queryKey: ['report-run-status', pendingRunId],
    queryFn: () => reportsEngineApi.runStatus(pendingRunId!),
    enabled: pendingRunId !== null,
    refetchInterval: (query) => {
      const status = query.state.data?.status;
      return status === 'COMPLETED' || status === 'FAILED' ? false : 1500;
    },
  });

  useEffect(() => {
    if (!runStatus || pendingRunId === null) return;
    if (runStatus.status === 'COMPLETED' && runStatus.resultData) {
      setResult({
        rows: runStatus.resultData.rows,
        totalRows: runStatus.resultData.totalRows,
        generatedAt: runStatus.resultData.generatedAt,
        totals: runStatus.resultData.totals,
        durationMs: runStatus.durationMs ?? 0,
        definition: definition!,
      });
      setPage(0);
      setPendingRunId(null);
    } else if (runStatus.status === 'FAILED') {
      toast.error(runStatus.errorMessage ?? 'Report generation failed');
      setPendingRunId(null);
    }
  }, [runStatus, pendingRunId, definition]);

  const downloadMutation = useMutation({
    mutationFn: async (fmt: 'CSV' | 'EXCEL') => {
      const baseUrl = import.meta.env.VITE_REPORT_URL ?? 'http://localhost:3015';
      const token = localStorage.getItem('accessToken') ?? '';
      const res = await fetch(`${baseUrl}/api/v2/reports/${slug}/run`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ params: paramValues, format: fmt }),
      });
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${slug}-${today}.${fmt === 'EXCEL' ? 'xlsx' : 'csv'}`;
      a.click();
      URL.revokeObjectURL(url);
    },
    onSuccess: (_data, fmt) => toast.success(`${fmt} file downloaded`),
    onError: (err: Error) => toast.error(err.message ?? 'Download failed'),
  });

  const isRunning = runMutation.isPending || pendingRunId !== null;
  const pageRows = result?.rows?.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE) ?? [];
  const totalPages = result ? Math.ceil(result.totalRows / PAGE_SIZE) : 0;

  if (isDefinitionLoading || !definition) {
    return <ERPDetailSkeleton />;
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex items-center gap-3">
          <button
            onClick={() => navigate('/reports')}
            className="p-1.5 rounded-lg hover:bg-surface-raised text-secondary transition-colors"
          >
            <ArrowLeft size={18} />
          </button>
          <div>
            <h1 className="text-xl font-bold text-primary">{definition.name}</h1>
            <p className="text-xs text-secondary">{definition.description}</p>
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <button
            onClick={() => downloadMutation.mutate('CSV')}
            disabled={downloadMutation.isPending}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium border border-default rounded-lg text-secondary hover:text-primary hover:bg-surface-raised transition-colors"
          >
            <Download size={13} /> CSV
          </button>
          <button
            onClick={() => downloadMutation.mutate('EXCEL')}
            disabled={downloadMutation.isPending}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium border border-default rounded-lg text-secondary hover:text-primary hover:bg-surface-raised transition-colors"
          >
            <Download size={13} /> Excel
          </button>
          <button
            onClick={() => runMutation.mutate()}
            disabled={isRunning}
            className="flex items-center gap-1.5 px-4 py-1.5 text-sm font-medium bg-primary text-white rounded-lg hover:bg-primary/90 transition-colors disabled:opacity-60"
          >
            <RefreshCw size={13} className={isRunning ? 'animate-spin' : ''} />
            {isRunning ? 'Running...' : 'Run Report'}
          </button>
        </div>
      </div>

      {/* Parameters */}
      {definition.params.length > 0 && (
        <div className="bg-surface-card border border-default rounded-xl p-4">
          <h3 className="text-xs font-semibold text-secondary uppercase tracking-wide mb-3">
            Parameters
          </h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
            {definition.params.map((param) => (
              <div key={param.key}>
                <label className="block text-xs font-medium text-secondary mb-1">
                  {param.label}
                  {param.required && <span className="text-error ml-1">*</span>}
                </label>
                {param.type === 'select' && param.options ? (
                  <div className="relative">
                    <select
                      value={paramValues[param.key] ?? ''}
                      onChange={(e) =>
                        setParamValues((p) => ({ ...p, [param.key]: e.target.value }))
                      }
                      className="w-full appearance-none text-sm border border-default rounded-lg px-3 py-1.5 bg-surface-card text-primary focus:outline-none focus:ring-2 focus:ring-primary/30 pr-8"
                    >
                      <option value="">All</option>
                      {param.options.map((o) => (
                        <option key={o.value} value={o.value}>
                          {o.label}
                        </option>
                      ))}
                    </select>
                    <ChevronDown
                      size={12}
                      className="absolute right-2 top-1/2 -translate-y-1/2 text-secondary pointer-events-none"
                    />
                  </div>
                ) : (
                  <input
                    type={
                      param.type === 'date' ? 'date' : param.type === 'number' ? 'number' : 'text'
                    }
                    value={paramValues[param.key] ?? param.default ?? ''}
                    onChange={(e) => setParamValues((p) => ({ ...p, [param.key]: e.target.value }))}
                    placeholder={param.label}
                    className="w-full text-sm border border-default rounded-lg px-3 py-1.5 bg-surface-card text-primary focus:outline-none focus:ring-2 focus:ring-primary/30"
                  />
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Error */}
      {runMutation.isError && (
        <div className="bg-error-bg border border-error/30 text-error text-sm rounded-lg px-4 py-3">
          {(runMutation.error as Error).message}
        </div>
      )}

      {/* Results */}
      {result && (
        <div className="bg-surface-card border border-default rounded-xl">
          <div className="flex items-center justify-between px-4 py-3 border-b border-default">
            <div className="text-xs text-secondary">
              <span className="font-medium text-primary">
                {result.totalRows.toLocaleString('en-IN')}
              </span>{' '}
              rows · generated in {result.durationMs}ms ·{' '}
              {new Date(result.generatedAt).toLocaleTimeString('en-IN')}
            </div>
            {totalPages > 1 && (
              <div className="flex items-center gap-2 text-xs text-secondary">
                <button
                  disabled={page === 0}
                  onClick={() => setPage((p) => p - 1)}
                  className="px-2 py-1 rounded border border-default hover:bg-surface-raised disabled:opacity-40"
                >
                  Prev
                </button>
                <span>
                  Page {page + 1} / {totalPages}
                </span>
                <button
                  disabled={page >= totalPages - 1}
                  onClick={() => setPage((p) => p + 1)}
                  className="px-2 py-1 rounded border border-default hover:bg-surface-raised disabled:opacity-40"
                >
                  Next
                </button>
              </div>
            )}
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-default bg-surface-raised">
                  {definition.columns.map((col) => (
                    <th
                      key={col.key}
                      className={`px-3 py-2 text-xs font-semibold text-secondary whitespace-nowrap ${col.align === 'right' ? 'text-right' : 'text-left'}`}
                    >
                      {col.label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {pageRows.map((row, ri) => (
                  <tr
                    key={ri}
                    className="border-b border-default last:border-0 hover:bg-surface-raised/50 transition-colors"
                  >
                    {definition.columns.map((col) => (
                      <td
                        key={col.key}
                        className={`px-3 py-2 text-xs whitespace-nowrap ${
                          col.align === 'right' ? 'text-right font-mono' : 'text-primary'
                        } ${col.type === 'currency' && parseFloat(String(row[col.key] ?? 0)) < 0 ? 'text-error' : ''}`}
                      >
                        {formatCell(row[col.key] as string | number | null, col.type)}
                      </td>
                    ))}
                  </tr>
                ))}
                {pageRows.length === 0 && (
                  <tr>
                    <td colSpan={definition.columns.length}>
                      <ERPEmptyState
                        type="no-results"
                        title="No data found"
                        description="Try adjusting the parameters and running the report again."
                      />
                    </td>
                  </tr>
                )}
              </tbody>
              {/* Totals row */}
              {result.totals && Object.keys(result.totals).length > 0 && (
                <tfoot>
                  <tr className="border-t-2 border-default bg-surface-raised">
                    {definition.columns.map((col, ci) => (
                      <td
                        key={col.key}
                        className={`px-3 py-2 text-xs font-bold whitespace-nowrap ${col.align === 'right' ? 'text-right font-mono' : 'text-primary'}`}
                      >
                        {ci === 0
                          ? 'TOTAL'
                          : result.totals[col.key] !== undefined
                            ? formatCell(result.totals[col.key]!, col.type)
                            : ''}
                      </td>
                    ))}
                  </tr>
                </tfoot>
              )}
            </table>
          </div>
        </div>
      )}

      {!result && pendingRunId !== null && (
        <div className="text-center py-16 text-secondary">
          <RefreshCw size={28} className="mx-auto mb-3 opacity-30 animate-spin" />
          <p className="text-sm">This report runs in the background — generating your data...</p>
        </div>
      )}

      {!result && !isRunning && (
        <div className="text-center py-16 text-secondary">
          <RefreshCw size={28} className="mx-auto mb-3 opacity-30" />
          <p className="text-sm">
            Set parameters and click <strong>Run Report</strong> to see results
          </p>
        </div>
      )}
    </div>
  );
}
