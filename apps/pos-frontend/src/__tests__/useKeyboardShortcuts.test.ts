/**
 * useKeyboardShortcuts.ts previously had two related bugs:
 * 1. Ctrl+Z had no isEditableTarget guard (unlike the adjacent ArrowUp/Down handler), so
 *    pressing it while typing in a qty/discount text input undid the last *cart line*
 *    instead of the character just typed.
 * 2. F5/F6/F7 and Ctrl+D only called preventDefault() after their action-guard passed, so an
 *    empty-cart F5 (or Ctrl+D with no highlighted line) leaked through to the browser's
 *    native refresh / bookmark-dialog shortcut instead of being a no-op.
 */
import { describe, it, expect, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useKeyboardShortcuts } from '../hooks/useKeyboardShortcuts.js';

function baseParams(overrides: Partial<Parameters<typeof useKeyboardShortcuts>[0]> = {}) {
  return {
    barcodeRef: { current: null },
    cartLength: 1,
    highlightedLineItemId: null,
    lastAddedItem: null,
    showPayment: false,
    showHeldSales: false,
    showNewCustomer: false,
    isHolding: false,
    onNewBill: vi.fn(),
    onOpenLookup: vi.fn(),
    onHold: vi.fn(),
    onSetPaymentMode: vi.fn(),
    onShowPayment: vi.fn(),
    onShowHeldSales: vi.fn(),
    onShowNewCustomer: vi.fn(),
    onRepeatLast: vi.fn(),
    onUndoLastLine: vi.fn(),
    onMoveLineSelection: vi.fn(),
    ...overrides,
  };
}

function dispatchKey(init: KeyboardEventInit, target: EventTarget = window) {
  const event = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init });
  target.dispatchEvent(event);
  return event;
}

describe('useKeyboardShortcuts', () => {
  it('Ctrl+Z undoes the last line when focus is not in a text field', () => {
    const params = baseParams();
    renderHook(() => useKeyboardShortcuts(params));

    const event = dispatchKey({ key: 'z', ctrlKey: true });

    expect(params.onUndoLastLine).toHaveBeenCalledTimes(1);
    expect(event.defaultPrevented).toBe(true);
  });

  it('Ctrl+Z does not hijack native undo while focused in a text input', () => {
    const params = baseParams();
    renderHook(() => useKeyboardShortcuts(params));
    const input = document.createElement('input');
    document.body.appendChild(input);
    input.focus();

    const event = dispatchKey({ key: 'z', ctrlKey: true }, input);

    expect(params.onUndoLastLine).not.toHaveBeenCalled();
    expect(event.defaultPrevented).toBe(false);
    document.body.removeChild(input);
  });

  it('Ctrl+Z does not hijack native undo while focused in a textarea', () => {
    const params = baseParams();
    renderHook(() => useKeyboardShortcuts(params));
    const textarea = document.createElement('textarea');
    document.body.appendChild(textarea);
    textarea.focus();

    const event = dispatchKey({ key: 'z', ctrlKey: true }, textarea);

    expect(params.onUndoLastLine).not.toHaveBeenCalled();
    expect(event.defaultPrevented).toBe(false);
    document.body.removeChild(textarea);
  });

  it('F5 with an empty cart calls preventDefault (no native page refresh) but takes no action', () => {
    const params = baseParams({ cartLength: 0 });
    renderHook(() => useKeyboardShortcuts(params));

    const event = dispatchKey({ key: 'F5' });

    expect(event.defaultPrevented).toBe(true);
    expect(params.onSetPaymentMode).not.toHaveBeenCalled();
    expect(params.onShowPayment).not.toHaveBeenCalled();
  });

  it('F6 with items in the cart jumps to the Card payment mode', () => {
    const params = baseParams({ cartLength: 1 });
    renderHook(() => useKeyboardShortcuts(params));

    dispatchKey({ key: 'F6' });

    expect(params.onSetPaymentMode).toHaveBeenCalledWith('CARD');
    expect(params.onShowPayment).toHaveBeenCalledWith(true);
  });

  it('Ctrl+D with no highlighted line calls preventDefault (no native bookmark dialog) but takes no action', () => {
    const params = baseParams({ highlightedLineItemId: null });
    renderHook(() => useKeyboardShortcuts(params));

    const event = dispatchKey({ key: 'd', ctrlKey: true });

    expect(event.defaultPrevented).toBe(true);
  });
});
