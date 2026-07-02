import { type ReactNode } from 'react';
import { AlertTriangle, Trash2, type LucideIcon } from 'lucide-react';
import Modal from '../ui/Modal.js';
import Button from '../ui/Button.js';

interface Props {
  open: boolean;
  onClose: () => void;
  onConfirm: () => void;
  title: string;
  description?: string | ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  variant?: 'danger' | 'warning';
  isLoading?: boolean;
  icon?: LucideIcon;
}

export default function ERPConfirmModal({
  open,
  onClose,
  onConfirm,
  title,
  description,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  variant = 'danger',
  isLoading = false,
  icon: Icon,
}: Props) {
  const DefaultIcon = variant === 'danger' ? Trash2 : AlertTriangle;
  const IconComponent = Icon ?? DefaultIcon;
  const iconColor = variant === 'danger' ? 'text-danger' : 'text-warning';
  const iconBg = variant === 'danger' ? 'bg-danger-bg' : 'bg-warning-bg';

  return (
    <Modal title={title} open={open} onClose={onClose} size="sm" closeOnBackdropClick={!isLoading}>
      <div className="flex flex-col items-center gap-4 py-2 text-center">
        <div className={`w-12 h-12 rounded-full ${iconBg} flex items-center justify-center shrink-0`}>
          <IconComponent size={22} className={iconColor} />
        </div>
        <div>
          <h2 className="text-base font-semibold text-primary">{title}</h2>
          {description && (
            <p className="text-sm text-secondary mt-1">{description}</p>
          )}
        </div>
        <div className="flex items-center gap-3 w-full">
          <Button
            variant="outline"
            className="flex-1"
            onClick={onClose}
            disabled={isLoading}
          >
            {cancelLabel}
          </Button>
          <Button
            variant={variant === 'danger' ? 'danger' : 'primary'}
            className="flex-1"
            onClick={onConfirm}
            loading={isLoading}
          >
            {confirmLabel}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
