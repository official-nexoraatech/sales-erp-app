import { useEffect, useRef, type ReactNode } from 'react';
import { X } from 'lucide-react';
import { useFocusTrap } from '../../hooks/useFocusTrap.js';

interface Props {
  open?: boolean;
  isOpen?: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  size?: 'sm' | 'md' | 'lg' | 'xl' | '2xl' | 'fullscreen';
  closeOnBackdropClick?: boolean;
}

const SIZES: Record<NonNullable<Props['size']>, string> = {
  sm: 'max-w-sm',
  md: 'max-w-lg',
  lg: 'max-w-2xl',
  xl: 'max-w-4xl',
  '2xl': 'max-w-5xl',
  fullscreen: 'max-w-none w-full h-full rounded-none',
};

let titleIdCounter = 0;

export default function Modal({
  open,
  isOpen,
  onClose,
  title,
  children,
  size = 'md',
  closeOnBackdropClick = true,
}: Props) {
  const isVisible = open ?? isOpen ?? false;
  const titleId = useRef(`modal-title-${++titleIdCounter}`).current;
  const panelRef = useRef<HTMLDivElement>(null);

  // Lock body scroll
  useEffect(() => {
    document.body.style.overflow = isVisible ? 'hidden' : '';
    return () => { document.body.style.overflow = ''; };
  }, [isVisible]);

  // Escape key closes
  useEffect(() => {
    if (!isVisible) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [isVisible, onClose]);

  // Trap Tab focus inside the modal, focus the first element on open, and
  // restore focus to the trigger element on close.
  useFocusTrap(panelRef, isVisible);

  if (!isVisible) return null;

  return (
    <div
      className="fixed inset-0 flex items-center justify-center p-4"
      style={{ zIndex: 'var(--z-modal)' }}
      onClick={closeOnBackdropClick ? onClose : undefined}
    >
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className={`relative w-full ${SIZES[size]} bg-surface-card rounded-2xl shadow-token-modal`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-6 py-4 border-b border-default">
          <h2 id={titleId} className="font-semibold text-primary">{title}</h2>
          <button
            onClick={onClose}
            aria-label="Close dialog"
            className="text-secondary hover:text-primary transition-colors"
          >
            <X size={18} />
          </button>
        </div>
        <div className="px-6 py-5 max-h-[80vh] overflow-y-auto">{children}</div>
      </div>
    </div>
  );
}
