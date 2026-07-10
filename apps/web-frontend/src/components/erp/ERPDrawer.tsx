import { useEffect, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import Button from '../ui/Button.js';
import { useFocusTrap } from '../../hooks/useFocusTrap.js';

type DrawerSize = 'sm' | 'md' | 'lg' | 'xl';

interface Props {
  open: boolean;
  onClose: () => void;
  title?: string;
  subtitle?: string;
  size?: DrawerSize;
  children: ReactNode;
  footer?: ReactNode;
  closeOnBackdropClick?: boolean;
}

const sizeClass: Record<DrawerSize, string> = {
  sm: 'w-80',
  md: 'w-96',
  lg: 'w-[32rem]',
  xl: 'w-[40rem]',
};

export default function ERPDrawer({
  open,
  onClose,
  title,
  subtitle,
  size = 'md',
  children,
  footer,
  closeOnBackdropClick = true,
}: Props) {
  const drawerRef = useRef<HTMLDivElement>(null);

  // Trap Tab focus inside the drawer, focus the first element on open, and
  // restore focus to the trigger element on close.
  useFocusTrap(drawerRef, open);

  // Escape key closes
  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  // Lock body scroll
  useEffect(() => {
    if (open) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = '';
    }
    return () => { document.body.style.overflow = ''; };
  }, [open]);

  if (!open) return null;

  return createPortal(
    <div className="fixed inset-0 z-[--z-modal] flex">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/40"
        aria-hidden="true"
        onClick={closeOnBackdropClick ? onClose : undefined}
      />

      {/* Drawer panel — slides in from right */}
      <div
        ref={drawerRef}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className={`relative ml-auto flex flex-col bg-surface-card shadow-token-modal h-full ${sizeClass[size]} animate-[slideInRight_200ms_ease-out]`}
      >
        {/* Header */}
        {(title || subtitle) && (
          <div className="flex items-start justify-between px-6 py-4 border-b border-default shrink-0">
            <div>
              {title && <h2 className="text-base font-semibold text-primary">{title}</h2>}
              {subtitle && <p className="text-sm text-secondary mt-0.5">{subtitle}</p>}
            </div>
            <button
              onClick={onClose}
              aria-label="Close drawer"
              className="p-1.5 rounded-lg text-secondary hover:bg-surface-raised hover:text-primary transition-colors -mr-1 -mt-0.5"
            >
              <X size={18} />
            </button>
          </div>
        )}

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-6 py-4">{children}</div>

        {/* Footer */}
        {footer && (
          <div className="shrink-0 px-6 py-4 border-t border-default bg-surface-card">
            {footer}
          </div>
        )}
      </div>
    </div>,
    document.body
  );
}
