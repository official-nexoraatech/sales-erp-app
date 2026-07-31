import { useEffect, type RefObject } from 'react';
import type { POSItem } from '../components/pos/types.js';

// Arrow-key cart navigation must not hijack arrow keys while the cashier is typing in a text
// field (qty box, discount box, omnibox, etc.) — it only applies once focus has moved off
// any input.
function isEditableTarget(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLElement &&
    (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)
  );
}

interface Params {
  barcodeRef: RefObject<HTMLInputElement | null>;
  cartLength: number;
  highlightedLineItemId: number | null;
  lastAddedItem: POSItem | null;
  showPayment: boolean;
  showHeldSales: boolean;
  showNewCustomer: boolean;
  isHolding: boolean;
  onNewBill: () => void;
  onOpenLookup: () => void;
  onHold: () => void;
  onSetPaymentMode: (mode: 'CASH' | 'CARD' | 'UPI') => void;
  onShowPayment: (show: boolean) => void;
  onShowHeldSales: (show: boolean) => void;
  onShowNewCustomer: (show: boolean) => void;
  onRepeatLast: (item: POSItem) => void;
  onUndoLastLine: () => void;
  onMoveLineSelection: (direction: 'up' | 'down') => void;
}

// POS billing keyboard shortcuts (documented in docs/training/CASHIER_GUIDE.md): F2 new bill,
// F3 open the full-screen item lookup, F4 hold sale, F5/F6/F7 jump straight to Cash/Card/UPI,
// F8 process payment, F9 repeat last item, Ctrl+Z undo last line, Ctrl+D focus the highlighted
// line's discount box, Ctrl+F focus the omnibox, Up/Down navigate cart lines (only when focus
// isn't already in a text field), Esc cancel/back.
export function useKeyboardShortcuts({
  barcodeRef,
  cartLength,
  highlightedLineItemId,
  lastAddedItem,
  showPayment,
  showHeldSales,
  showNewCustomer,
  isHolding,
  onNewBill,
  onOpenLookup,
  onHold,
  onSetPaymentMode,
  onShowPayment,
  onShowHeldSales,
  onShowNewCustomer,
  onRepeatLast,
  onUndoLastLine,
  onMoveLineSelection,
}: Params): void {
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'F2') {
        e.preventDefault();
        onNewBill();
      } else if (e.key === 'F3') {
        e.preventDefault();
        onOpenLookup();
      } else if (e.key === 'F4') {
        e.preventDefault();
        if (cartLength > 0 && !isHolding) onHold();
      } else if (e.key === 'F5' || e.key === 'F6' || e.key === 'F7') {
        // preventDefault() unconditionally — these are claimed shortcut keys in this app
        // regardless of cart state; without this, an empty-cart F5 fell through to the
        // browser's native page-refresh instead of being a no-op.
        e.preventDefault();
        if (cartLength === 0) return;
        onSetPaymentMode(e.key === 'F5' ? 'CASH' : e.key === 'F6' ? 'CARD' : 'UPI');
        onShowPayment(true);
      } else if (e.key === 'F8') {
        e.preventDefault();
        if (cartLength > 0) onShowPayment(true);
      } else if (e.key === 'F9') {
        e.preventDefault();
        if (lastAddedItem) onRepeatLast(lastAddedItem);
      } else if (
        e.ctrlKey &&
        !e.shiftKey &&
        e.key.toLowerCase() === 'z' &&
        !isEditableTarget(e.target)
      ) {
        // Guarded the same way ArrowUp/Down already are below — without this, Ctrl+Z typed
        // while focused in a qty/discount input undid the last *cart line* instead of the
        // character just typed, since this listener is bound to window, not the input.
        if (cartLength === 0) return;
        e.preventDefault();
        onUndoLastLine();
      } else if (e.ctrlKey && e.key.toLowerCase() === 'f') {
        e.preventDefault();
        barcodeRef.current?.focus();
      } else if (e.ctrlKey && e.key.toLowerCase() === 'd') {
        // preventDefault() unconditionally — without this, an empty-highlight Ctrl+D leaked
        // through to the browser's native bookmark dialog instead of being a no-op.
        e.preventDefault();
        if (highlightedLineItemId === null) return;
        document.getElementById(`pos-cart-discount-${highlightedLineItemId}`)?.focus();
      } else if ((e.key === 'ArrowDown' || e.key === 'ArrowUp') && !isEditableTarget(e.target)) {
        if (cartLength === 0) return;
        e.preventDefault();
        onMoveLineSelection(e.key === 'ArrowDown' ? 'down' : 'up');
      } else if (e.key === 'Escape') {
        if (showPayment) onShowPayment(false);
        else if (showHeldSales) onShowHeldSales(false);
        else if (showNewCustomer) onShowNewCustomer(false);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [
    barcodeRef,
    cartLength,
    highlightedLineItemId,
    lastAddedItem,
    showPayment,
    showHeldSales,
    showNewCustomer,
    isHolding,
    onNewBill,
    onOpenLookup,
    onHold,
    onSetPaymentMode,
    onShowPayment,
    onShowHeldSales,
    onShowNewCustomer,
    onRepeatLast,
    onUndoLastLine,
    onMoveLineSelection,
  ]);
}
