import { useCallback, useRef, useState } from 'react';
import { ConfirmDialog } from '../components/ui/ConfirmDialog';

type ConfirmationVariant = 'danger' | 'warning' | 'info';

interface ConfirmationOptions {
  title?: string;
  message: string;
  confirmText?: string;
  cancelText?: string;
  variant?: ConfirmationVariant;
}

type PendingConfirmation = Required<Pick<ConfirmationOptions, 'title' | 'message' | 'confirmText' | 'cancelText' | 'variant'>>;

export const useConfirmation = () => {
  const [pending, setPending] = useState<PendingConfirmation | null>(null);
  const resolverRef = useRef<((confirmed: boolean) => void) | null>(null);

  const close = useCallback((confirmed: boolean) => {
    resolverRef.current?.(confirmed);
    resolverRef.current = null;
    setPending(null);
  }, []);

  const confirmAction = useCallback((options: ConfirmationOptions) => {
    resolverRef.current?.(false);

    setPending({
      title: options.title || 'Confirm Action',
      message: options.message,
      confirmText: options.confirmText || 'Confirm',
      cancelText: options.cancelText || 'Cancel',
      variant: options.variant || 'warning',
    });

    return new Promise<boolean>((resolve) => {
      resolverRef.current = resolve;
    });
  }, []);

  const confirmationDialog = (
    <ConfirmDialog
      isOpen={Boolean(pending)}
      title={pending?.title || ''}
      message={pending?.message || ''}
      confirmText={pending?.confirmText}
      cancelText={pending?.cancelText}
      variant={pending?.variant}
      onConfirm={() => close(true)}
      onCancel={() => close(false)}
    />
  );

  return { confirmAction, confirmationDialog };
};
