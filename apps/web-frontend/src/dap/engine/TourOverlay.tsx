import { useEffect } from 'react';
import { useTour } from './useTour.js';
import { useTargetRect, TourSpotlightRing } from './TourSpotlight.js';
import { useTourAction } from './useTourAction.js';
import { TourTooltipCard } from './TourTooltipCard.js';

// Single instance, mounted once in Layout.tsx — renders nothing when no tour is active. See
// ERP-PLANNING/DAP-Planning/01_ARCHITECTURE.md §3. Escape = skip, matching the platform-wide
// "Esc closes any overlay" law (apps/web-frontend/src/components/help/HelpPanel.tsx and
// ShortcutsModal follow the same rule).
export function TourOverlay() {
  const { activeTour, activeStep, visibleSteps, stepIndex, next, prev, skip } = useTour();
  const targetRect = useTargetRect(activeStep?.target, `${activeTour?.id}:${activeStep?.id}`);
  const actionSatisfied = useTourAction(activeStep);

  useEffect(() => {
    if (!activeStep) return;
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        skip();
        return;
      }
      // Don't hijack arrow/enter while the user is typing somewhere on the page — an
      // interactive step's `requiredAction` often has them filling in a real form field,
      // and ArrowLeft/ArrowRight/Enter need their normal text-editing behavior there.
      const target = e.target as HTMLElement | null;
      if (target && ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)) return;
      if (e.key === 'ArrowLeft') {
        prev();
      } else if (e.key === 'ArrowRight' || e.key === 'Enter') {
        if (activeStep!.mode === 'interactive' && !actionSatisfied) return;
        next();
      }
    }
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [activeStep, skip, prev, next, actionSatisfied]);

  if (!activeTour || !activeStep) return null;

  const showsOwnBackdrop = Boolean(activeStep.target && targetRect);

  return (
    <>
      {!showsOwnBackdrop && (
        <div
          aria-hidden="true"
          className="fixed inset-0 bg-black/40 backdrop-blur-sm"
          style={{ zIndex: 'var(--z-tour)' }}
        />
      )}
      {showsOwnBackdrop && targetRect && <TourSpotlightRing rect={targetRect} />}
      <TourTooltipCard
        tour={activeTour}
        step={activeStep}
        stepNumber={stepIndex + 1}
        totalSteps={visibleSteps.length}
        targetRect={showsOwnBackdrop ? targetRect : null}
        actionSatisfied={actionSatisfied}
        isFirst={stepIndex === 0}
        isLast={stepIndex === visibleSteps.length - 1}
        onNext={next}
        onPrev={prev}
        onSkip={skip}
      />
    </>
  );
}
