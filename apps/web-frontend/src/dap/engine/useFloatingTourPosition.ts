import { useLayoutEffect, useRef, useState, type CSSProperties } from 'react';
import {
  computePosition,
  autoUpdate,
  offset,
  flip,
  shift,
  arrow as arrowMiddleware,
  type Placement,
  type Side,
} from '@floating-ui/dom';
import type { TourStep } from '../content/schema.js';

const GAP = 12;
const VIEWPORT_MARGIN = 8;
const ARROW_SIZE = 8;

const PLACEMENT_MAP: Record<Exclude<TourStep['placement'], 'center'>, Placement> = {
  top: 'top',
  bottom: 'bottom',
  left: 'left',
  right: 'right',
};

const STATIC_SIDE: Record<Side, Side> = {
  top: 'bottom',
  bottom: 'top',
  left: 'right',
  right: 'left',
};

export interface ArrowPosition {
  side: Side;
  style: CSSProperties;
}

// Replaces the old hand-rolled `usePositionedStyle` with @floating-ui/dom's `computePosition` —
// the same positioning primitive Radix/Headless UI/shadcn build on. Fixes what the hand-rolled
// version couldn't: auto-flip to the opposite side when the naive placement would overflow the
// viewport, shift along the cross-axis to stay in bounds, and compute a real arrow anchor point
// instead of just clamping top/left after the fact. `targetRect` comes from a *virtual*
// floating-ui reference (a plain `{ getBoundingClientRect }` object, not a real DOM element) —
// the actual target may live behind a portal/dialog/table row this hook never touches directly;
// `useTargetRect` (TourSpotlight.tsx) already re-measures it on scroll/resize/DOM mutation and
// hands us a fresh rect, which is what re-triggers this effect.
export function useFloatingTourPosition(
  targetRect: DOMRect | null,
  placement: TourStep['placement']
) {
  const cardRef = useRef<HTMLDivElement>(null);
  const arrowRef = useRef<HTMLDivElement>(null);
  const [style, setStyle] = useState<CSSProperties>({ visibility: 'hidden' });
  const [arrow, setArrow] = useState<ArrowPosition | null>(null);

  useLayoutEffect(() => {
    if (!targetRect) {
      // No target → the card centers itself in the viewport. `top:50%/left:50%` +
      // `translate(-50%,-50%)` centers using the box's own rendered size (computed after
      // layout) — it needs no explicit height, unlike the `inset:0 + margin:auto` this
      // replaced: with top:0 AND bottom:0 both pinned and no explicit height, the box had
      // nothing to shrink-to-content against and stretched to fill the entire viewport height,
      // anchoring the card's actual content at the top with a large empty gap below it. (An
      // earlier fix here already removed `display:flex` on the card — a separate bug where the
      // card's own children scattered into a horizontal row instead of stacking — that fix was
      // correct but didn't address this height issue.)
      setStyle({ position: 'fixed', top: '50%', left: '50%', transform: 'translate(-50%, -50%)' });
      setArrow(null);
      return;
    }
    const floatingEl = cardRef.current;
    if (!floatingEl) return;

    const reference = { getBoundingClientRect: () => targetRect };
    let cancelled = false;

    const cleanup = autoUpdate(reference, floatingEl, () => {
      const arrowEl = arrowRef.current;
      void computePosition(reference, floatingEl, {
        placement: PLACEMENT_MAP[placement === 'center' ? 'bottom' : placement],
        middleware: [
          offset(GAP),
          flip({ padding: VIEWPORT_MARGIN }),
          shift({ padding: VIEWPORT_MARGIN }),
          ...(arrowEl ? [arrowMiddleware({ element: arrowEl, padding: 12 })] : []),
        ],
      }).then(({ x, y, placement: finalPlacement, middlewareData }) => {
        if (cancelled) return;
        setStyle({
          position: 'fixed',
          top: 0,
          left: 0,
          transform: `translate(${Math.round(x)}px, ${Math.round(y)}px)`,
        });
        const side = finalPlacement.split('-')[0] as Side;
        if (middlewareData.arrow) {
          const { x: ax, y: ay } = middlewareData.arrow;
          setArrow({
            side,
            style: {
              left: ax != null ? `${ax}px` : '',
              top: ay != null ? `${ay}px` : '',
              [STATIC_SIDE[side]]: `${-ARROW_SIZE / 2}px`,
            },
          });
        } else {
          setArrow(null);
        }
      });
    });

    return () => {
      cancelled = true;
      cleanup();
    };
  }, [targetRect, placement]);

  return { cardRef, arrowRef, style, arrow };
}
