import { Compass } from 'lucide-react';
import type { TourDefinition } from '../../dap/index.js';
import type { TourProgressRecord } from '../../api/endpoints.js';

// Shared between HelpPanel (full Help Center) and TourGuidePanel (the dedicated tour-only
// entry point) — extracted so both render the exact same Start/Resume/Restart affordance
// rather than drifting into two slightly-different copies.
export function TourLaunchButton({
  tour,
  progress,
  onLaunch,
  onClose,
}: {
  tour: TourDefinition;
  progress: TourProgressRecord | undefined;
  onLaunch: (tourId: string, options?: { resumeAtStepId: string }) => void;
  onClose: () => void;
}) {
  const label =
    progress?.status === 'completed'
      ? 'Restart'
      : progress?.status === 'in_progress'
        ? 'Resume'
        : 'Start';
  return (
    <button
      aria-label={`${label} guided tour: ${tour.title}`}
      onClick={() => {
        onLaunch(
          tour.id,
          progress?.status === 'in_progress' && progress.currentStepId
            ? { resumeAtStepId: progress.currentStepId }
            : undefined
        );
        onClose();
      }}
      className="flex items-center gap-2 text-sm text-link hover:underline w-full text-left"
    >
      <Compass size={14} className="shrink-0" />
      <span className="flex-1">{tour.title}</span>
      <span className="text-xs text-secondary">{label}</span>
    </button>
  );
}

export default TourLaunchButton;
