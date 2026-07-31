import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useAuthStore } from '../../store/auth.store.js';
import { getTourById } from '../content/registry.js';
import type { TourDefinition, TourStep } from '../content/schema.js';
import type { TourEventType } from '../../api/endpoints.js';
import { TourContext, type TourContextValue } from './useTour.js';
import { useUpsertTourProgress, useRecordTourEvent } from '../api/useTourProgress.js';
import { routeHasDynamicSegment } from './routeMatch.js';

const LOCAL_KEY = 'erp_dap_progress';
// Stable module-level reference — the Zustand selector below must never construct a new
// array (e.g. `s.user?.permissions ?? []`) inline, or useSyncExternalStore sees a "changed"
// snapshot on every render (a fresh [] !== the previous fresh []) and loops forever.
const NO_PERMISSIONS: string[] = [];

interface LocalProgress {
  tourVersion: number;
  status: 'in_progress' | 'completed' | 'skipped';
  currentStepId: string | null;
}

function readLocalProgress(): Record<string, LocalProgress> {
  try {
    const raw = localStorage.getItem(LOCAL_KEY);
    return raw ? (JSON.parse(raw) as Record<string, LocalProgress>) : {};
  } catch {
    return {};
  }
}

function writeLocalProgress(tourId: string, progress: LocalProgress): void {
  try {
    const all = readLocalProgress();
    all[tourId] = progress;
    localStorage.setItem(LOCAL_KEY, JSON.stringify(all));
  } catch {
    // localStorage unavailable (private browsing, quota) — the backend PUT is still attempted
  }
}

// Root of the DAP engine — mounted once near the app shell (see Layout.tsx). Owns active-tour
// state, RBAC step filtering (ADR-2: permissions only, never role names), dual-write
// progress/analytics persistence (ADR-3), and reload resume. See
// ERP-PLANNING/DAP-Planning/01_ARCHITECTURE.md §3.
export function TourProvider({ children }: { children: ReactNode }) {
  const navigate = useNavigate();
  const location = useLocation();
  const permissions = useAuthStore((s) => s.user?.permissions) ?? NO_PERMISSIONS;
  const upsertProgress = useUpsertTourProgress();
  const recordEvent = useRecordTourEvent();

  const [activeTourId, setActiveTourId] = useState<string | null>(null);
  const [stepIndex, setStepIndex] = useState(0);
  const hasResumedRef = useRef(false);

  const hasPermission = useCallback(
    (permission?: string) => !permission || permissions.includes(permission),
    [permissions]
  );

  const isTourAvailable = useCallback(
    (tour: TourDefinition) =>
      !tour.requiredPermissions?.length ||
      tour.requiredPermissions.some((p) => permissions.includes(p)),
    [permissions]
  );

  const activeTour = activeTourId ? (getTourById(activeTourId) ?? null) : null;
  const visibleSteps = useMemo(
    () => (activeTour ? activeTour.steps.filter((s) => hasPermission(s.requiredPermission)) : []),
    [activeTour, hasPermission]
  );
  const activeStep: TourStep | null = visibleSteps[stepIndex] ?? null;

  const emit = useCallback(
    (tour: TourDefinition, eventType: TourEventType, step?: TourStep) => {
      recordEvent.mutate({
        tourId: tour.id,
        tourVersion: tour.version,
        ...(step ? { stepId: step.id } : {}),
        eventType,
      });
    },
    [recordEvent]
  );

  const persist = useCallback(
    (tour: TourDefinition, status: LocalProgress['status'], currentStepId: string | null) => {
      writeLocalProgress(tour.id, { tourVersion: tour.version, status, currentStepId });
      upsertProgress.mutate({
        tourId: tour.id,
        tourVersion: tour.version,
        status,
        ...(currentStepId ? { currentStepId } : {}),
      });
    },
    [upsertProgress]
  );

  const navigateToStep = useCallback(
    (step: TourStep) => {
      // A dynamic route (e.g. `sales/invoices/:id`) has no real ID to navigate *to* — these
      // steps only ever make sense while already viewing a specific record (a detail-page
      // tour is only offered by Help Panel when the current URL already matches its pattern;
      // see HelpPanel.tsx's pageTours filter). So: stay put if the current path already
      // satisfies the pattern, and do nothing (rather than navigate somewhere wrong) if it
      // doesn't — the same graceful-degradation the spotlight already applies when a target
      // selector isn't found.
      if (routeHasDynamicSegment(step.route)) {
        return;
      }
      const targetPath = `/${step.route}`;
      if (location.pathname !== targetPath) navigate(targetPath);
    },
    [location.pathname, navigate]
  );

  const startTour = useCallback(
    (tourId: string, options?: { resumeAtStepId?: string }) => {
      const tour = getTourById(tourId);
      if (!tour || !isTourAvailable(tour)) return;
      const steps = tour.steps.filter((s) => hasPermission(s.requiredPermission));
      if (steps.length === 0) return;
      const resumeIndex = options?.resumeAtStepId
        ? Math.max(
            steps.findIndex((s) => s.id === options.resumeAtStepId),
            0
          )
        : 0;
      const step = steps[resumeIndex]!;
      setActiveTourId(tourId);
      setStepIndex(resumeIndex);
      navigateToStep(step);
      if (resumeIndex === 0) emit(tour, 'tour_started');
      emit(tour, 'step_viewed', step);
      persist(tour, 'in_progress', step.id);
    },
    [emit, hasPermission, isTourAvailable, navigateToStep, persist]
  );

  const next = useCallback(() => {
    if (!activeTour || !activeStep) return;
    emit(activeTour, 'step_completed', activeStep);
    const nextIndex = stepIndex + 1;
    if (nextIndex >= visibleSteps.length) {
      persist(activeTour, 'completed', null);
      emit(activeTour, 'tour_completed');
      setActiveTourId(null);
      setStepIndex(0);
      return;
    }
    const nextStep = visibleSteps[nextIndex]!;
    setStepIndex(nextIndex);
    navigateToStep(nextStep);
    emit(activeTour, 'step_viewed', nextStep);
    persist(activeTour, 'in_progress', nextStep.id);
  }, [activeStep, activeTour, emit, navigateToStep, persist, stepIndex, visibleSteps]);

  const prev = useCallback(() => {
    if (!activeTour) return;
    const prevIndex = stepIndex - 1;
    if (prevIndex < 0) return;
    const prevStep = visibleSteps[prevIndex]!;
    setStepIndex(prevIndex);
    navigateToStep(prevStep);
    emit(activeTour, 'step_viewed', prevStep);
    persist(activeTour, 'in_progress', prevStep.id);
  }, [activeTour, emit, navigateToStep, persist, stepIndex, visibleSteps]);

  const skip = useCallback(() => {
    if (!activeTour) return;
    emit(activeTour, 'tour_skipped', activeStep ?? undefined);
    persist(activeTour, 'skipped', activeStep?.id ?? null);
    setActiveTourId(null);
    setStepIndex(0);
  }, [activeStep, activeTour, emit, persist]);

  const finish = useCallback(() => {
    if (!activeTour) return;
    persist(activeTour, 'completed', null);
    emit(activeTour, 'tour_completed');
    setActiveTourId(null);
    setStepIndex(0);
  }, [activeTour, emit, persist]);

  // Resume-on-load: a tour left in_progress (e.g. the page was reloaded mid-tour) re-opens
  // at the saved step exactly once, on mount — not on every render.
  useEffect(() => {
    if (hasResumedRef.current) return;
    hasResumedRef.current = true;
    const local = readLocalProgress();
    const entry = Object.entries(local).find(([, p]) => p.status === 'in_progress');
    if (entry?.[1].currentStepId) {
      startTour(entry[0], { resumeAtStepId: entry[1].currentStepId });
    }
    // Intentionally run once on mount only — startTour is stable enough in practice for a
    // one-shot resume check, and re-running on every permission/location change would
    // re-trigger resume logic mid-tour.
  }, []);

  const value: TourContextValue = {
    activeTour,
    visibleSteps,
    activeStep,
    stepIndex,
    startTour,
    next,
    prev,
    skip,
    finish,
    isTourAvailable,
  };

  return <TourContext.Provider value={value}>{children}</TourContext.Provider>;
}
