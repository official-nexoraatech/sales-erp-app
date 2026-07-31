import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { dapApi, type TourEventType, type TourProgressRecord } from '../../api/endpoints.js';

const PROGRESS_QUERY_KEY = ['dap-tour-progress'] as const;

export function useTourProgress() {
  return useQuery({
    queryKey: PROGRESS_QUERY_KEY,
    queryFn: () => dapApi.getProgress(),
    staleTime: 60_000,
  });
}

export function useUpsertTourProgress() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (vars: {
      tourId: string;
      tourVersion: number;
      status: 'in_progress' | 'completed' | 'skipped';
      currentStepId?: string;
    }) => dapApi.upsertProgress(vars.tourId, vars),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: PROGRESS_QUERY_KEY });
    },
  });
}

export function useRecordTourEvent() {
  return useMutation({
    mutationFn: (vars: {
      tourId: string;
      tourVersion: number;
      stepId?: string;
      eventType: TourEventType;
      metadata?: Record<string, unknown>;
    }) => dapApi.recordEvent(vars),
  });
}

export function findProgress(
  records: TourProgressRecord[] | undefined,
  tourId: string
): TourProgressRecord | undefined {
  return records?.find((r) => r.tourId === tourId);
}
