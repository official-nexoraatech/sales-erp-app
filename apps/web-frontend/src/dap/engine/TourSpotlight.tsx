import { useEffect, useState } from 'react';

const FIND_TIMEOUT_MS = 5000;

// Locates `[data-tour-id="…"]` targets and tracks their position. Distinct from
// packages/ui's usePopoverPosition: that hook positions a panel relative to a *trigger ref the
// caller renders and owns*; a tour target is an arbitrary, already-rendered element found by
// selector, possibly not mounted yet right after navigation (lazy-loaded route chunk) — so this
// re-locates on a short interval/MutationObserver instead of computing once from a ref. The
// underlying math (getBoundingClientRect, fixed positioning) is the same technique
// usePopoverPosition uses, adapted for selector-based lookup rather than reused verbatim — see
// ERP-PLANNING/DAP-Planning/01_ARCHITECTURE.md §3.
export function useTargetRect(selector: string | undefined, stepKey: string): DOMRect | null {
  const [rect, setRect] = useState<DOMRect | null>(null);

  useEffect(() => {
    setRect(null);
    if (!selector) return;

    let cancelled = false;
    let observer: MutationObserver | null = null;
    let pollId: number | undefined;
    const deadline = Date.now() + FIND_TIMEOUT_MS;

    let scrolledIntoView = false;

    function measure(): boolean {
      const el = document.querySelector(selector!);
      if (cancelled) return Boolean(el);
      // Explicitly clear to null (not just "leave stale") when the element disappears —
      // e.g. the user's click on the real target also navigates them off the page it was
      // on, same-tick as satisfying the interactive step's requiredAction. Without this the
      // ring would keep rendering at its last-known, now-meaningless screen position.
      if (el && !scrolledIntoView) {
        // Scroll it into view *before* the first measurement — a target below the fold
        // (inside the page's own scroll container, e.g. a long form or a scrolled table)
        // would otherwise be measured at its off-screen position, so the ring/tooltip would
        // briefly render somewhere the user can't see until the next poll tick catches up.
        // Instant (not smooth) so the first paint is already at the right spot.
        scrolledIntoView = true;
        el.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
      }
      setRect(el ? el.getBoundingClientRect() : null);
      return Boolean(el);
    }

    function tick() {
      if (cancelled) return;
      if (measure() || Date.now() > deadline) {
        observer?.disconnect();
        if (pollId !== undefined) window.clearInterval(pollId);
        return;
      }
    }

    if (!measure()) {
      observer = new MutationObserver(tick);
      observer.observe(document.body, { childList: true, subtree: true });
      pollId = window.setInterval(tick, 250);
    }

    function onScrollOrResize() {
      measure();
    }
    window.addEventListener('scroll', onScrollOrResize, true);
    window.addEventListener('resize', onScrollOrResize);

    return () => {
      cancelled = true;
      observer?.disconnect();
      if (pollId !== undefined) window.clearInterval(pollId);
      window.removeEventListener('scroll', onScrollOrResize, true);
      window.removeEventListener('resize', onScrollOrResize);
    };
    // stepKey (not just selector) forces a fresh find-attempt every time the *active step*
    // changes, even back to a step whose selector string is identical to one seen before
    // (e.g. Prev back to an interactive step after its target navigated away and cleared) —
    // otherwise this effect wouldn't re-run since the selector value itself didn't change.
  }, [selector, stepKey]);

  return rect;
}

const PADDING = 6;

// Real click-blocking scrim with a genuine hit-testing hole cut around the target, not a
// visual-only illusion. A single fixed, full-viewport `pointer-events:auto` div is clipped
// with a "donut" polygon (outer viewport rect wound one way, inner target rect wound the
// other, bridged at a shared point) — the clipped-away hole is excluded from hit-testing by
// the browser itself, so clicks inside it fall through to the real target underneath while
// clicks anywhere else are absorbed by the scrim. The previous version only *looked* dimmed
// via a box-shadow on the ring (which never blocks pointer events) — every pixel outside the
// ring was still fully interactive, letting a user click something else mid-tour.
function clipPathHole(rect: DOMRect): string {
  const left = rect.left - PADDING;
  const top = rect.top - PADDING;
  const right = rect.right + PADDING;
  const bottom = rect.bottom + PADDING;
  return `polygon(
    0px 0px, 0px 100vh, 100vw 100vh, 100vw 0px, 0px 0px,
    ${left}px ${top}px, ${right}px ${top}px, ${right}px ${bottom}px, ${left}px ${bottom}px, ${left}px ${top}px
  )`;
}

export function TourSpotlightRing({ rect }: { rect: DOMRect }) {
  return (
    <>
      <div
        aria-hidden="true"
        className="fixed inset-0 bg-black/50 pointer-events-auto transition-[clip-path]"
        style={{
          zIndex: 'var(--z-tour)',
          clipPath: clipPathHole(rect),
          transitionDuration: 'var(--duration-normal)',
        }}
      />
      <div
        aria-hidden="true"
        className="fixed rounded-lg ring-2 ring-brand pointer-events-none transition-[top,left,width,height] animate-[tourSpotlightPulse_2s_ease-in-out_infinite]"
        style={{
          top: rect.top - PADDING,
          left: rect.left - PADDING,
          width: rect.width + PADDING * 2,
          height: rect.height + PADDING * 2,
          zIndex: 'var(--z-tour)',
          transitionDuration: 'var(--duration-normal)',
        }}
      />
    </>
  );
}
