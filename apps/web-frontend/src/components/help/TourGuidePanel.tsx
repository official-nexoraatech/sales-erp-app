import { useEffect, useMemo, useRef } from 'react';
import { useLocation } from 'react-router-dom';
import { X, Compass, HelpCircle } from 'lucide-react';
import { useFocusTrap } from '../../hooks/useFocusTrap.js';
import { useTour, getAllTours, matchesRoutePattern } from '../../dap/index.js';
import { useTourProgress, findProgress } from '../../dap/api/useTourProgress.js';
import { TourLaunchButton } from './TourLaunchButton.js';

interface TourGuidePanelProps {
  onClose: () => void;
  onOpenHelp: () => void;
}

// A dedicated entry point for guided tours, separate from the general Help Center — tours
// were previously only reachable by opening Help and scrolling past FAQs/shortcuts/contact
// links to find them. This surfaces exactly the same tour list (same eligibility, same
// Start/Resume/Restart logic — see TourLaunchButton) in a small, focused dropdown anchored to
// its own header button, matching how NotificationsPanel anchors to the bell icon rather than
// taking over the whole right edge of the screen the way HelpPanel does.
export function TourGuidePanel({ onClose, onOpenHelp }: TourGuidePanelProps) {
  const location = useLocation();
  const panelRef = useRef<HTMLDivElement>(null);
  const { startTour, isTourAvailable } = useTour();
  const { data: tourProgress } = useTourProgress();
  const currentPageRoute = location.pathname.replace(/^\//, '');

  const pageTours = useMemo(
    () =>
      getAllTours().filter(
        (t) =>
          isTourAvailable(t) &&
          t.module !== 'cross-module' &&
          t.steps[0] !== undefined &&
          matchesRoutePattern(t.steps[0].route, currentPageRoute)
      ),
    [isTourAvailable, currentPageRoute]
  );
  const workflowTours = useMemo(
    () => getAllTours().filter((t) => isTourAvailable(t) && t.module === 'cross-module'),
    [isTourAvailable]
  );

  useFocusTrap(panelRef, true);

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  return (
    <div
      ref={panelRef}
      role="dialog"
      aria-modal="true"
      aria-label="Guided tours"
      className="absolute right-0 top-12 z-[var(--z-popover)] w-80 max-h-[28rem] flex flex-col bg-surface-card border border-default rounded-lg shadow-2xl overflow-hidden"
    >
      <div className="flex items-center justify-between px-4 py-3 border-b border-default">
        <span className="flex items-center gap-2 text-sm font-semibold text-primary">
          <Compass size={16} className="text-brand" />
          Guided Tours
        </span>
        <button
          onClick={onClose}
          aria-label="Close guided tours"
          className="text-secondary hover:text-primary transition-colors"
        >
          <X size={16} />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {pageTours.length === 0 && workflowTours.length === 0 && (
          <div className="flex flex-col items-center gap-2 py-8 text-center text-secondary">
            <Compass size={24} className="text-disabled" />
            <p className="text-sm">No guided tour for this page yet.</p>
            <p className="text-xs text-disabled">Check Help Center for FAQs and documentation.</p>
          </div>
        )}
        {pageTours.length > 0 && (
          <div className="space-y-1.5">
            <p className="text-xs font-semibold text-secondary uppercase tracking-wide">
              This page
            </p>
            {pageTours.map((tour) => (
              <TourLaunchButton
                key={tour.id}
                tour={tour}
                progress={findProgress(tourProgress, tour.id)}
                onLaunch={startTour}
                onClose={onClose}
              />
            ))}
          </div>
        )}
        {workflowTours.length > 0 && (
          <div className="space-y-1.5">
            <p className="text-xs font-semibold text-secondary uppercase tracking-wide">
              Business workflows
            </p>
            {workflowTours.map((tour) => (
              <TourLaunchButton
                key={tour.id}
                tour={tour}
                progress={findProgress(tourProgress, tour.id)}
                onLaunch={startTour}
                onClose={onClose}
              />
            ))}
          </div>
        )}
      </div>

      <div className="border-t border-default px-4 py-2.5">
        <button
          onClick={() => {
            onClose();
            onOpenHelp();
          }}
          className="flex items-center gap-2 text-sm text-link hover:underline"
        >
          <HelpCircle size={14} />
          Open Help Center
        </button>
      </div>
    </div>
  );
}

export default TourGuidePanel;
