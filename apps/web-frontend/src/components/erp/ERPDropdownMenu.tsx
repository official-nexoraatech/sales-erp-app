import { useEffect, useRef, useState, type ReactNode, type LegacyRef } from 'react';
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
  align?: 'left' | 'right';
}

export default function ERPDropdownMenu({ items, trigger, align = 'right' }: Props) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function handler(e: MouseEvent) {
      if (!containerRef.current?.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false);
    }
    document.addEventListener('mousedown', handler);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', handler);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <div ref={containerRef} className="relative inline-block">
      <button
        onClick={(e) => { e.stopPropagation(); setOpen((o) => !o); }}
        aria-label="More actions"
        aria-haspopup="true"
        aria-expanded={open}
        className="p-1.5 rounded-md text-secondary hover:bg-surface-raised transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-border-focus"
      >
        {trigger ?? <MoreHorizontal size={16} />}
      </button>

      {open && (
        <div
          role="menu"
          className={`absolute z-[--z-dropdown] top-full mt-1 min-w-[160px] bg-surface-overlay border border-default rounded-xl shadow-token-lg py-1 ${
            align === 'right' ? 'right-0' : 'left-0'
          }`}
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
                onClick={() => { setOpen(false); item.onClick(); }}
                className={`w-full flex items-center gap-2.5 px-3 py-2 text-sm transition-colors text-left
                  disabled:opacity-40 disabled:cursor-not-allowed
                  ${item.variant === 'danger'
                    ? 'text-danger hover:bg-danger-bg'
                    : 'text-primary hover:bg-surface-raised'
                  }`}
              >
                {Icon && <Icon size={15} className="shrink-0" />}
                {item.label}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
