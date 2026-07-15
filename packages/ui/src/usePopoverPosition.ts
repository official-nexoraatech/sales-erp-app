import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from 'react';

interface Options {
  open: boolean;
  onClose: () => void;
  align?: 'left' | 'right';
}

/** Shared portal-popover positioning/dismissal logic for DatePicker/MonthPicker/TimePicker/
 * DateTimePicker (and originally proven out in ERPDropdownMenu) — computes a fixed position
 * from the trigger's bounding rect, flipping upward if it would overflow the viewport, and
 * closes on outside click / Escape / scroll-resize. The scroll listener is attached on a
 * short delay: opening a popover is often preceded by an auto-scroll-into-view (e.g. a field
 * near the bottom of a long form), and attaching immediately would catch that same
 * in-flight scroll event and instantly close the popover that just opened. */
export function usePopoverPosition<TriggerEl extends HTMLElement = HTMLDivElement>({
  open,
  onClose,
  align = 'left',
}: Options) {
  const triggerRef = useRef<TriggerEl>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const [style, setStyle] = useState<CSSProperties>({ visibility: 'hidden' });

  useLayoutEffect(() => {
    if (!open || !triggerRef.current) return;
    const rect = triggerRef.current.getBoundingClientRect();
    const panelHeight = panelRef.current?.offsetHeight ?? 0;
    const openUp = rect.bottom + panelHeight > window.innerHeight;
    const next: CSSProperties = {
      position: 'fixed',
      top: openUp ? rect.top - panelHeight - 4 : rect.bottom + 4,
      minWidth: rect.width,
    };
    if (align === 'right') {
      next.right = window.innerWidth - rect.right;
    } else {
      next.left = rect.left;
    }
    setStyle(next);
  }, [open, align]);

  useEffect(() => {
    if (!open) return;
    function handleMouseDown(e: MouseEvent) {
      const target = e.target as Node;
      if (triggerRef.current?.contains(target) || panelRef.current?.contains(target)) return;
      onClose();
    }
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    function handleScrollOrResize() {
      onClose();
    }
    document.addEventListener('mousedown', handleMouseDown);
    document.addEventListener('keydown', handleKeyDown);

    let scrollListenerAttached = false;
    const attachTimer = window.setTimeout(() => {
      window.addEventListener('scroll', handleScrollOrResize, true);
      window.addEventListener('resize', handleScrollOrResize);
      scrollListenerAttached = true;
    }, 150);

    return () => {
      document.removeEventListener('mousedown', handleMouseDown);
      document.removeEventListener('keydown', handleKeyDown);
      window.clearTimeout(attachTimer);
      if (scrollListenerAttached) {
        window.removeEventListener('scroll', handleScrollOrResize, true);
        window.removeEventListener('resize', handleScrollOrResize);
      }
    };
  }, [open, onClose]);

  return { triggerRef, panelRef, style };
}
