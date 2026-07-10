import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from 'react';
import Modal from '../components/ui/Modal.js';
import Button from '../components/ui/Button.js';

export interface ConfirmOptions {
  title?: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  variant?: 'primary' | 'danger';
}

type ConfirmFn = (options: ConfirmOptions) => Promise<boolean>;

const ConfirmContext = createContext<ConfirmFn>(async () => false);

export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [options, setOptions] = useState<ConfirmOptions | null>(null);
  const resolveRef = useRef<((value: boolean) => void) | null>(null);

  const confirm = useCallback<ConfirmFn>((opts) => {
    setOptions(opts);
    return new Promise<boolean>((resolve) => {
      resolveRef.current = resolve;
    });
  }, []);

  function settle(result: boolean) {
    resolveRef.current?.(result);
    resolveRef.current = null;
    setOptions(null);
  }

  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      <Modal open={options !== null} onClose={() => settle(false)} title={options?.title ?? 'Confirm'} size="sm">
        {options && (
          <div className="space-y-5">
            <p className="text-sm text-secondary">{options.message}</p>
            <div className="flex justify-end gap-3">
              <Button variant="secondary" onClick={() => settle(false)}>{options.cancelLabel ?? 'Cancel'}</Button>
              <Button variant={options.variant === 'danger' ? 'danger' : 'primary'} onClick={() => settle(true)}>
                {options.confirmLabel ?? 'Confirm'}
              </Button>
            </div>
          </div>
        )}
      </Modal>
    </ConfirmContext.Provider>
  );
}

export function useConfirm(): ConfirmFn {
  return useContext(ConfirmContext);
}
