import React, { useEffect } from 'react';
import { AlertTriangle, Info, X } from 'lucide-react';
import { Button } from './Button';

interface ConfirmDialogProps {
  isOpen: boolean;
  title: string;
  message: string;
  onConfirm: () => void;
  onCancel: () => void;
  isLoading?: boolean;
  confirmText?: string;
  cancelText?: string;
  variant?: 'danger' | 'warning' | 'info';
}

const variantConfig = {
  danger: {
    icon: <AlertTriangle size={22} />,
    iconClass: 'text-red-600 dark:text-red-400',
    iconBg: 'bg-red-100 dark:bg-red-900/40',
    titleClass: 'text-red-900 dark:text-red-200',
    messageClass: 'text-red-700 dark:text-red-300',
    headerBg: 'bg-red-50 dark:bg-red-900/20 border-red-200 dark:border-red-800/50',
    confirmVariant: 'danger' as const,
  },
  warning: {
    icon: <AlertTriangle size={22} />,
    iconClass: 'text-amber-600 dark:text-amber-400',
    iconBg: 'bg-amber-100 dark:bg-amber-900/40',
    titleClass: 'text-amber-900 dark:text-amber-200',
    messageClass: 'text-amber-700 dark:text-amber-300',
    headerBg: 'bg-amber-50 dark:bg-amber-900/20 border-amber-200 dark:border-amber-800/50',
    confirmVariant: 'warning' as const,
  },
  info: {
    icon: <Info size={22} />,
    iconClass: 'text-blue-600 dark:text-blue-400',
    iconBg: 'bg-blue-100 dark:bg-blue-900/40',
    titleClass: 'text-blue-900 dark:text-blue-200',
    messageClass: 'text-blue-700 dark:text-blue-300',
    headerBg: 'bg-blue-50 dark:bg-blue-900/20 border-blue-200 dark:border-blue-800/50',
    confirmVariant: 'primary' as const,
  },
};

export const ConfirmDialog: React.FC<ConfirmDialogProps> = ({
  isOpen,
  title,
  message,
  onConfirm,
  onCancel,
  isLoading = false,
  confirmText = 'Confirm',
  cancelText = 'Cancel',
  variant = 'warning',
}) => {
  useEffect(() => {
    if (!isOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCancel();
      if (e.key === 'Enter') onConfirm();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [isOpen, onCancel, onConfirm]);

  if (!isOpen) return null;

  const cfg = variantConfig[variant];

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="confirm-title"
    >
      <div
        className="absolute inset-0 bg-black/50 dark:bg-black/70 backdrop-blur-[1px]"
        aria-hidden="true"
      />
      <div className="relative w-full max-w-md overflow-hidden rounded-xl bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 shadow-xl dark:shadow-slate-900/70">
        {/* Header */}
        <div className={`flex items-start gap-4 border-b p-5 ${cfg.headerBg}`}>
          <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full ${cfg.iconBg}`}>
            <span className={cfg.iconClass}>{cfg.icon}</span>
          </div>
          <div className="flex-1 min-w-0 pt-0.5">
            <h2 id="confirm-title" className={`font-semibold text-base ${cfg.titleClass}`}>
              {title}
            </h2>
            <p className={`mt-1 text-sm leading-relaxed ${cfg.messageClass}`}>{message}</p>
          </div>
          <button
            type="button"
            onClick={onCancel}
            disabled={isLoading}
            aria-label="Close"
            className="rounded-lg p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600 dark:text-slate-500 dark:hover:bg-slate-700 dark:hover:text-slate-300 transition-colors"
          >
            <X size={16} />
          </button>
        </div>

        {/* Actions */}
        <div className="flex items-center justify-end gap-2.5 bg-slate-50 dark:bg-slate-900/50 px-5 py-3">
          <Button variant="secondary" size="sm" onClick={onCancel} disabled={isLoading}>
            {cancelText}
          </Button>
          <Button
            variant={cfg.confirmVariant}
            size="sm"
            onClick={onConfirm}
            isLoading={isLoading}
          >
            {confirmText}
          </Button>
        </div>
      </div>
    </div>
  );
};
