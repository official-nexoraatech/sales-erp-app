// Phase 4 — useCart was extracted out of POSScreen.tsx specifically so the cart/line-item
// domain could be tested in isolation, without mounting the full screen (offline sync, camera
// scanner, react-query, etc.). This covers the behaviors POSScreen.tsx relies on.
import { describe, it, expect } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { useCart } from '../hooks/useCart.js';
import type { POSItem } from '../components/pos/types.js';

const ITEM_A: POSItem = { id: 1, name: 'Cotton Poplin', salePrice: '100.00', gstRate: 18 };
const ITEM_B: POSItem = { id: 2, name: 'Zipper 7in', salePrice: '25.00', gstRate: 12 };

describe('useCart', () => {
  it('adds a new item as a fresh line, then increments quantity on repeat adds', () => {
    const { result } = renderHook(() => useCart());

    act(() => result.current.addItem(ITEM_A));
    expect(result.current.cart).toEqual([
      expect.objectContaining({ itemId: 1, quantity: 1, unitPrice: 100, lineTotal: 118 }),
    ]);

    act(() => result.current.addItem(ITEM_A));
    expect(result.current.cart).toEqual([
      expect.objectContaining({ itemId: 1, quantity: 2, lineTotal: 236 }),
    ]);
    expect(result.current.grandTotal).toBe(236);
  });

  it('includes cessRate in the line total, matching GSTCalculator.computeLine server-side', () => {
    const { result } = renderHook(() => useCart());
    const cessItem: POSItem = {
      id: 3,
      name: 'Aerated Drink',
      salePrice: '100.00',
      gstRate: 18,
      cessRate: 12,
    };

    act(() => result.current.addItem(cessItem));
    // taxable 100 + gst 18 + cess 12 = 130, previously this dropped cess and totaled 118.
    expect(result.current.cart).toEqual([
      expect.objectContaining({ itemId: 3, cessRate: 12, lineTotal: 130 }),
    ]);

    act(() => result.current.updateQty(3, 2));
    expect(result.current.cart).toEqual([expect.objectContaining({ lineTotal: 260 })]);
  });

  it('updateQty to zero removes the line entirely', () => {
    const { result } = renderHook(() => useCart());
    act(() => result.current.addItem(ITEM_A));

    act(() => result.current.updateQty(1, 0));
    expect(result.current.cart).toEqual([]);
  });

  it('updateDiscount clamps to 0-100 and recomputes the line total', () => {
    const { result } = renderHook(() => useCart());
    act(() => result.current.addItem(ITEM_A));

    act(() => result.current.updateDiscount(1, 200));
    expect(result.current.cart[0]).toMatchObject({ discountPct: 100, lineTotal: 0 });

    act(() => result.current.updateDiscount(1, 10));
    // 100 * (1 - 0.10) = 90 taxable, +18% GST = 106.2
    expect(result.current.cart[0]).toMatchObject({ discountPct: 10, lineTotal: 106.2 });
  });

  it('applyOrderDiscount applies the same percentage to every line', () => {
    const { result } = renderHook(() => useCart());
    act(() => {
      result.current.addItem(ITEM_A);
      result.current.addItem(ITEM_B);
    });

    act(() => result.current.applyOrderDiscount(50));
    expect(result.current.cart.every((l) => l.discountPct === 50)).toBe(true);
  });

  it('undoLastLine decrements the most-recently-added line by one, removing it at zero', () => {
    const { result } = renderHook(() => useCart());
    act(() => {
      result.current.addItem(ITEM_A);
      result.current.addItem(ITEM_A);
    });
    expect(result.current.cart[0]?.quantity).toBe(2);

    act(() => result.current.undoLastLine());
    expect(result.current.cart[0]?.quantity).toBe(1);

    act(() => result.current.undoLastLine());
    expect(result.current.cart).toEqual([]);
  });

  it('undoLastLine is a no-op once nothing has ever been added', () => {
    const { result } = renderHook(() => useCart());
    act(() => result.current.undoLastLine());
    expect(result.current.cart).toEqual([]);
  });

  it('moveLineSelection wraps around in both directions and drives highlightedLineItemId', () => {
    const { result } = renderHook(() => useCart());
    act(() => {
      result.current.addItem(ITEM_A);
      result.current.addItem(ITEM_B);
    });

    act(() => result.current.moveLineSelection('down'));
    expect(result.current.highlightedLineItemId).toBe(1);

    act(() => result.current.moveLineSelection('down'));
    expect(result.current.highlightedLineItemId).toBe(2);

    // Wraps back to the first line past the end.
    act(() => result.current.moveLineSelection('down'));
    expect(result.current.highlightedLineItemId).toBe(1);

    // Wraps backward past the start too.
    act(() => result.current.moveLineSelection('up'));
    expect(result.current.highlightedLineItemId).toBe(2);
  });

  it('clearCart resets the cart, last-added item, and line selection together', () => {
    const { result } = renderHook(() => useCart());
    act(() => result.current.addItem(ITEM_A));
    act(() => result.current.moveLineSelection('down'));
    expect(result.current.highlightedLineItemId).toBe(1);

    act(() => result.current.clearCart());
    expect(result.current.cart).toEqual([]);
    expect(result.current.lastAddedItem).toBeNull();
    expect(result.current.highlightedLineItemId).toBeNull();
  });

  it('derives the totals breakdown (items/quantity/subtotal/discount/tax) from the cart lines', () => {
    const { result } = renderHook(() => useCart());
    act(() => {
      result.current.addItem(ITEM_A); // 100 @ 18% GST
      result.current.addItem(ITEM_B); // 25 @ 12% GST
      result.current.addItem(ITEM_B);
    });

    expect(result.current.totalItems).toBe(2);
    expect(result.current.totalQuantity).toBe(3);
    expect(result.current.subtotal).toBe(150); // 100 + 25*2

    act(() => result.current.updateDiscount(1, 10));
    // Item A: 100 * 10% = 10 discount, taxable 90, GST 18% = 16.2 tax
    // Item B (qty 2): no discount, taxable 50, GST 12% = 6 tax
    expect(result.current.discountAmount).toBe(10);
    expect(result.current.taxAmount).toBeCloseTo(22.2);
    expect(result.current.grandTotal).toBeCloseTo(
      result.current.cart.reduce((s, l) => s + l.lineTotal, 0)
    );
  });

  it('restoreCart (held-sale resume) replaces the cart wholesale and clears stale selection', () => {
    const { result } = renderHook(() => useCart());
    act(() => result.current.addItem(ITEM_A));
    act(() => result.current.moveLineSelection('down'));

    const restored = [
      {
        itemId: 9,
        itemName: 'Restored Line',
        quantity: 3,
        unitPrice: 50,
        gstRate: 5,
        cessRate: 0,
        discountPct: 0,
        lineTotal: 157.5,
      },
    ];
    act(() => result.current.restoreCart(restored));

    expect(result.current.cart).toEqual(restored);
    expect(result.current.lastAddedItem).toBeNull();
    expect(result.current.highlightedLineItemId).toBeNull();
  });
});
