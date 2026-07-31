import { useId, useRef, useState, type ReactNode } from 'react';
import { Info } from 'lucide-react';

interface InfoTooltipProps {
  children: ReactNode;
  label?: string;
}

// Field-level contextual help that appears exactly where a user needs it — next to a label —
// rather than only inside a guided tour. Hover, focus, or tap (mobile) to reveal; Escape or
// blur dismisses. Deliberately a small standalone component rather than a new prop on the
// shared `Input`/`Select` from @erp/ui: those are used across every module in the app, and
// adding a tooltip slot to their public API would be a much larger, riskier change than this
// task calls for. Compose it manually next to a label instead:
// `<label className="flex items-center gap-1">Place of Supply <InfoTooltip>...</InfoTooltip></label>`
export default function InfoTooltip({ children, label = 'More information' }: InfoTooltipProps) {
  const [open, setOpen] = useState(false);
  const id = useId();
  const closeTimer = useRef<number | undefined>(undefined);

  function show() {
    window.clearTimeout(closeTimer.current);
    setOpen(true);
  }
  function hide() {
    // A short delay lets the pointer travel from the icon into the tooltip itself (e.g. to
    // select/copy text) without it vanishing mid-move.
    closeTimer.current = window.setTimeout(() => setOpen(false), 100);
  }

  return (
    <span className="relative inline-flex">
      <button
        type="button"
        aria-describedby={open ? id : undefined}
        aria-label={label}
        onMouseEnter={show}
        onMouseLeave={hide}
        onFocus={show}
        onBlur={hide}
        onClick={(e) => {
          e.preventDefault();
          setOpen((v) => !v);
        }}
        onKeyDown={(e) => {
          if (e.key === 'Escape') setOpen(false);
        }}
        className="inline-flex items-center justify-center text-disabled hover:text-secondary focus-visible:text-secondary transition-colors rounded-full"
      >
        <Info size={13} />
      </button>
      {open && (
        <span
          role="tooltip"
          id={id}
          onMouseEnter={show}
          onMouseLeave={hide}
          className="absolute z-[var(--z-popover)] left-1/2 -translate-x-1/2 bottom-full mb-1.5 w-64 max-w-[80vw] rounded-lg bg-surface-overlay border border-default text-secondary text-xs leading-relaxed p-2.5 shadow-token-lg"
        >
          {children}
        </span>
      )}
    </span>
  );
}
