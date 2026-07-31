import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import {
  schedulerJobsApi,
  type SchedulerJobStatus,
  type SchedulerJobHistoryRow,
} from '../../../api/endpoints.js';
import { useAuthStore } from '../../../store/auth.store.js';
import { useConfirm } from '../../../context/ConfirmContext.js';
import { PERMISSIONS } from '../../../constants/permissions.js';
import ERPPageHeader from '../../../components/erp/ERPPageHeader.js';
import { ERPCardSkeleton } from '../../../components/erp/ERPSkeleton.js';
import ERPEmptyState from '../../../components/erp/ERPEmptyState.js';
import Button from '../../../components/ui/Button.js';
import Badge from '../../../components/ui/Badge.js';
import { formatDatetime } from '../../../lib/format.js';

const STATUS_VARIANT: Record<string, 'default' | 'warning' | 'success' | 'danger'> = {
  RUNNING: 'default',
  COMPLETED: 'success',
  FAILED: 'danger',
  SKIPPED: 'warning',
};

function formatDurationMs(ms: number | null): string {
  if (ms === null) return '—';
  if (ms < 1000) return `${ms}ms`;
  const seconds = ms / 1000;
  if (seconds < 60) return `${seconds.toFixed(1)}s`;
  return `${Math.floor(seconds / 60)}m ${Math.round(seconds % 60)}s`;
}

export default function SchedulerJobsPage() {
  const qc = useQueryClient();
  const confirm = useConfirm();
  const hasPermission = useAuthStore((s) => s.hasPermission);
  const [selectedJob, setSelectedJob] = useState<string | null>(null);

  const { data: listData, isLoading: jobsLoading } = useQuery({
    queryKey: ['scheduler-jobs'],
    queryFn: () => schedulerJobsApi.list(),
    refetchInterval: 30_000,
  });
  const jobs: SchedulerJobStatus[] = listData?.content ?? [];

  const { data: historyData, isLoading: historyLoading } = useQuery({
    queryKey: ['scheduler-job-history', selectedJob],
    queryFn: () => schedulerJobsApi.history(selectedJob!),
    enabled: !!selectedJob,
  });
  const history: SchedulerJobHistoryRow[] = historyData?.content ?? [];

  const failingCount = jobs.filter((j) => j.lastRun?.status === 'FAILED').length;
  const pausedCount = jobs.filter((j) => j.isPaused).length;

  const triggerMutation = useMutation({
    mutationFn: (jobName: string) => schedulerJobsApi.trigger(jobName),
    onSuccess: (_data, jobName) => {
      toast.success(`${jobName} queued for immediate execution`);
      void qc.invalidateQueries({ queryKey: ['scheduler-jobs'] });
      void qc.invalidateQueries({ queryKey: ['scheduler-job-history', jobName] });
    },
    onError: () => toast.error('Failed to trigger job'),
  });

  const pauseMutation = useMutation({
    mutationFn: (jobName: string) => schedulerJobsApi.pause(jobName),
    onSuccess: () => {
      toast.success('Job paused');
      void qc.invalidateQueries({ queryKey: ['scheduler-jobs'] });
    },
    onError: () => toast.error('Failed to pause job'),
  });

  const resumeMutation = useMutation({
    mutationFn: (jobName: string) => schedulerJobsApi.resume(jobName),
    onSuccess: () => {
      toast.success('Job resumed');
      void qc.invalidateQueries({ queryKey: ['scheduler-jobs'] });
    },
    onError: () => toast.error('Failed to resume job'),
  });

  const canTrigger = hasPermission(PERMISSIONS.JOB_TRIGGER);
  const canPause = hasPermission(PERMISSIONS.JOB_PAUSE);

  return (
    <div className="space-y-6">
      <ERPPageHeader
        variant="list"
        title="Scheduler Jobs"
        subtitle="Monitor, trigger, pause, and inspect the history of every scheduled background job"
      />

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="card p-4">
          <p className="text-xs text-secondary mb-1">TOTAL JOBS</p>
          <p className="text-2xl font-bold text-primary">{jobs.length}</p>
        </div>
        <div className="card p-4">
          <p className="text-xs text-secondary mb-1">LAST RUN FAILED</p>
          <p className="text-2xl font-bold text-danger">{failingCount}</p>
        </div>
        <div className="card p-4">
          <p className="text-xs text-secondary mb-1">PAUSED</p>
          <p className="text-2xl font-bold text-warning">{pausedCount}</p>
        </div>
        <div className="card p-4">
          <p className="text-xs text-secondary mb-1">ACTIVE NOW</p>
          <p className="text-2xl font-bold text-primary">
            {jobs.reduce((acc, j) => acc + j.active, 0)}
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Job list */}
        <div className="card p-4 lg:col-span-2">
          <h3 className="text-sm font-semibold text-primary mb-3">Registered Jobs</h3>
          {jobsLoading ? (
            <ERPCardSkeleton lines={6} />
          ) : jobs.length === 0 ? (
            <ERPEmptyState
              type="no-data"
              title="No jobs found"
              description="Scheduled jobs registered in scheduler-service will appear here."
            />
          ) : (
            <div className="space-y-2">
              {jobs.map((job) => (
                <div
                  key={job.name}
                  className={`px-3 py-3 rounded-lg border border-default transition-colors cursor-pointer ${
                    selectedJob === job.name ? 'bg-surface-hover' : 'hover:bg-surface-hover'
                  }`}
                  onClick={() => setSelectedJob(job.name)}
                >
                  <div className="flex items-center justify-between gap-2 mb-1">
                    <span className="text-sm font-medium text-primary font-mono truncate">
                      {job.name}
                    </span>
                    <div className="flex items-center gap-2 shrink-0">
                      {job.isPaused && <Badge variant="warning">PAUSED</Badge>}
                      {job.lastRun && (
                        <Badge variant={STATUS_VARIANT[job.lastRun.status] ?? 'default'}>
                          {job.lastRun.status}
                        </Badge>
                      )}
                    </div>
                  </div>
                  <p className="text-xs text-secondary mb-2">{job.description}</p>
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-mono text-secondary">{job.cron}</span>
                    <div className="flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
                      {canTrigger && (
                        <Button
                          size="sm"
                          variant="secondary"
                          loading={
                            triggerMutation.isPending && triggerMutation.variables === job.name
                          }
                          onClick={() => triggerMutation.mutate(job.name)}
                        >
                          Trigger Now
                        </Button>
                      )}
                      {canPause &&
                        (job.isPaused ? (
                          <Button
                            size="sm"
                            variant="primary"
                            loading={
                              resumeMutation.isPending && resumeMutation.variables === job.name
                            }
                            onClick={() => resumeMutation.mutate(job.name)}
                          >
                            Resume
                          </Button>
                        ) : (
                          <Button
                            size="sm"
                            variant="secondary"
                            loading={
                              pauseMutation.isPending && pauseMutation.variables === job.name
                            }
                            onClick={async () => {
                              const ok = await confirm({
                                title: 'Pause this job?',
                                message: `"${job.name}" will stop running on its ${job.cron} schedule until resumed.`,
                                confirmLabel: 'Pause',
                                variant: 'primary',
                              });
                              if (ok) pauseMutation.mutate(job.name);
                            }}
                          >
                            Pause
                          </Button>
                        ))}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* History panel */}
        <div className="card p-4">
          <h3 className="text-sm font-semibold text-primary mb-3">
            {selectedJob ? `History — ${selectedJob}` : 'History'}
          </h3>
          {!selectedJob ? (
            <p className="text-sm text-secondary">Select a job to view its last 30 runs</p>
          ) : historyLoading ? (
            <ERPCardSkeleton lines={5} />
          ) : history.length === 0 ? (
            <ERPEmptyState
              type="no-results"
              title="No run history yet"
              description="This job has not run since history recording was added."
            />
          ) : (
            <div className="space-y-2 max-h-[32rem] overflow-y-auto">
              {history.map((run) => (
                <div key={run.id} className="px-3 py-2 rounded-lg border border-default">
                  <div className="flex items-center justify-between mb-1">
                    <Badge variant={STATUS_VARIANT[run.status] ?? 'default'}>{run.status}</Badge>
                    <span className="text-xs text-secondary">{run.triggeredBy}</span>
                  </div>
                  <p className="text-xs text-secondary">{formatDatetime(run.startedAt)}</p>
                  <div className="flex items-center justify-between mt-1 text-xs text-secondary">
                    <span>Duration: {formatDurationMs(run.durationMs)}</span>
                  </div>
                  {run.errorMessage && (
                    <p className="text-xs text-danger mt-1 truncate" title={run.errorMessage}>
                      {run.errorMessage}
                    </p>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
