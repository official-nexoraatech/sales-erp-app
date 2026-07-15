import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';
import { MoreHorizontal } from 'lucide-react';

export interface ERPMenuItem {
  label: string;
  icon?: React.ComponentType<{ size?: number; className?: string }>;
  onClick: () => void;
  variant?: 'default' | 'danger';
  disabled?: boolean;
  separator?: boolean;
}

interface Props {
  items: ERPMenuItem[];
  trigger?: ReactNode;
  /** Overrides the default icon-button look entirely — for triggers that need to match a
   * surrounding design (e.g. the collapsed sidebar rail's nav-item styling) rather than the
   * standard row-actions "More" button. */
  triggerClassName?: string;
  /** Native title tooltip for the trigger button, e.g. a nav label when only an icon is shown. */
  triggerTitle?: string;
  align?: 'left' | 'right';
  /** Defaults to "More actions" (the row-actions convention) — override whenever a custom
   * `trigger` makes that label wrong, e.g. a "Columns" or filter-menu trigger, so two
   * dropdowns on the same page never collide on accessible name. */
  ariaLabel?: string;
}

export default function ERPDropdownMenu({
  items,
  trigger,
  triggerClassName,
  triggerTitle,
  align = 'right',
  ariaLabel = 'More actions',
}: Props) {
  const [open, setOpen] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [style, setStyle] = useState<CSSProperties>({ visibility: 'hidden' });

  // Recompute the fixed-position coordinates from the trigger button each time the menu
  // opens (or its item count changes), flipping upward if it would overflow the viewport.
  // Runs before paint so there's no visible jump from the initial hidden position.
  useLayoutEffect(() => {
    if (!open || !buttonRef.current) return;
    const rect = buttonRef.current.getBoundingClientRect();
    const menuHeight = menuRef.current?.offsetHeight ?? 0;
    const openUp = rect.bottom + menuHeight > window.innerHeight;
    const next: CSSProperties = {
      position: 'fixed',
      top: openUp ? rect.top - menuHeight - 4 : rect.bottom + 4,
    };
    if (align === 'right') {
      next.right = window.innerWidth - rect.right;
    } else {
      next.left = rect.left;
    }
    setStyle(next);
  }, [open, align, items.length]);

  useEffect(() => {
    if (!open) return;
    function handler(e: MouseEvent) {
      const target = e.target as Node;
      if (buttonRef.current?.contains(target) || menuRef.current?.contains(target)) return;
      setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false);
    }
    function onScrollOrResize() {
      setOpen(false);
    }
    document.addEventListener('mousedown', handler);
    document.addEventListener('keydown', onKey);

    // Opening the menu is often preceded by an auto-scroll-into-view (e.g. clicking "More
    // actions" on a row near the bottom of a long list) whose trailing 'scroll' event can
    // still be in flight when this effect runs. Attaching the close-on-scroll listener
    // immediately would catch that leftover event from the SAME click gesture and instantly
    // close the menu that just opened — reproduced live: clicking a row that required
    // scrolling into view failed silently ~15% of the time, while rows already fully in
    // view never failed. A short deferred attach lets any in-flight scroll settle first.
    let scrollListenerAttached = false;
    const attachTimer = window.setTimeout(() => {
      window.addEventListener('scroll', onScrollOrResize, true);
      window.addEventListener('resize', onScrollOrResize);
      scrollListenerAttached = true;
    }, 150);

    return () => {
      document.removeEventListener('mousedown', handler);
      document.removeEventListener('keydown', onKey);
      window.clearTimeout(attachTimer);
      if (scrollListenerAttached) {
        window.removeEventListener('scroll', onScrollOrResize, true);
        window.removeEventListener('resize', onScrollOrResize);
      }
    };
  }, [open]);

  return (
    <>
      <button
        ref={buttonRef}
        onClick={(e) => {
          e.stopPropagation();
          setOpen((o) => !o);
        }}
        aria-label={ariaLabel}
        aria-haspopup="true"
        aria-expanded={open}
        title={triggerTitle}
        className={
          triggerClassName ??
          'p-1.5 rounded-md text-secondary hover:bg-surface-raised transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-border-focus'
        }
      >
        {trigger ?? <MoreHorizontal size={16} />}
      </button>

      {open &&
        createPortal(
          <div
            ref={menuRef}
            role="menu"
            style={style}
            className="z-[var(--z-popover)] min-w-[160px] bg-surface-overlay border border-default rounded-xl shadow-token-lg py-1"
          >
            {items.map((item, i) => {
              const Icon = item.icon;
              if (item.separator) {
                return <div key={`sep-${i}`} className="my-1 border-t border-default" />;
              }
              return (
                <button
                  key={item.label}
                  role="menuitem"
                  disabled={item.disabled}
                  onClick={() => {
                    setOpen(false);
                    item.onClick();
                  }}
                  className={`w-full flex items-center gap-2.5 px-3 py-2 text-sm transition-colors text-left
                  disabled:opacity-40 disabled:cursor-not-allowed
                  ${
                    item.variant === 'danger'
                      ? 'text-danger hover:bg-danger-bg'
                      : 'text-primary hover:bg-surface-raised'
                  }`}
                >
                  {Icon && <Icon size={15} className="shrink-0" />}
                  {item.label}
                </button>
              );
            })}
          </div>,
          document.body
        )}
    </>
  );
}
