import { useMemo } from 'react';
import { useLocation } from 'react-router-dom';
import { useTour } from './useTour.js';
import { matchesRoutePattern } from './routeMatch.js';
import { getAllTours } from '../content/registry.js';
import { useTourProgress, findProgress } from '../api/useTourProgress.js';

// The DAP tour system has been entirely pull-based: even a genuinely great tour is invisible
// unless a user thinks to open Help Panel. Every real DAP platform (Pendo, WalkMe, Appcues)
// leads with a lightweight, passive signal instead — this is that signal. True when the
// current page has an available "This page" tour (same eligibility Help Panel itself uses:
// permission-gated, route-pattern matched, not a cross-module workflow tour) that this user
// has never started, skipped, or completed — i.e. genuinely never encountered, not just
// "not finished." Consumed by a small pulsing dot on the Help icon in Layout.tsx, not a modal
// or toast — those would compete with the Notifications bell and OnboardingChecklist for
// attention on every single page load, which is exactly the nagging behavior real DAP tools
// deliberately avoid.
export function useHasUnseenPageTour(): boolean {
  const location = useLocation();
  const { isTourAvailable } = useTour();
  const { data: progress } = useTourProgress();
  const currentPageRoute = location.pathname.replace(/^\//, '');

  return useMemo(
    () =>
      getAllTours().some((tour) => {
        if (tour.module === 'cross-module') return false;
        if (!isTourAvailable(tour)) return false;
        const firstStep = tour.steps[0];
        if (!firstStep || !matchesRoutePattern(firstStep.route, currentPageRoute)) return false;
        return findProgress(progress, tour.id) === undefined;
      }),
    [isTourAvailable, currentPageRoute, progress]
  );
}
