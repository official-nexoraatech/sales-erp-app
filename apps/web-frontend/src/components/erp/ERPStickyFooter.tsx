import { type ReactNode } from 'react';

interface Props {
  children: ReactNode;
  className?: string;
}

export default function ERPStickyFooter({ children, className = '' }: Props) {
  return (
    <div
      className={`sticky bottom-0 z-[--z-sticky] bg-surface-card border-t border-default px-6 py-4 flex items-center justify-end gap-3 ${className}`}
    >
      {children}
    </div>
  );
}
