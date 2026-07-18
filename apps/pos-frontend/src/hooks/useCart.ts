import { useCallback, useState } from 'react';
import type { CartItem, POSItem } from '../components/pos/types.js';

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function computeLineTotal(qty: number, price: number, gst: number, discountPct = 0): number {
  const taxable = round2(qty * price * (1 - discountPct / 100));
  return round2(taxable + (taxable * gst) / 100);
}

// The current-sale domain, extracted out of POSScreen.tsx (Phase 4) so it's independently
// testable and so the screen component doesn't have to carry every line-item mutation inline.
export function useCart() {
  const [cart, setCart] = useState<CartItem[]>([]);
  const [lastAddedItem, setLastAddedItem] = useState<POSItem | null>(null);
  const [selectedLineIndex, setSelectedLineIndex] = useState<number | null>(null);

  const safeSelectedLineIndex =
    cart.length === 0 || selectedLineIndex === null
      ? null
      : Math.min(selectedLineIndex, cart.length - 1);
  const highlightedLineItemId =
    safeSelectedLineIndex !== null ? (cart[safeSelectedLineIndex]?.itemId ?? null) : null;
  const grandTotal = cart.reduce((s, l) => s + l.lineTotal, 0);

  const addItem = useCallback((item: POSItem) => {
    const price = parseFloat(item.salePrice ?? '0');
    const gstRate = item.gstRate !== undefined && item.gstRate !== null ? Number(item.gstRate) : 18;
    setLastAddedItem(item);
    setCart((prev) => {
      const existing = prev.find((l) => l.itemId === item.id);
      if (existing) {
        return prev.map((l) =>
          l.itemId === item.id
            ? {
                ...l,
                quantity: l.quantity + 1,
                lineTotal: computeLineTotal(l.quantity + 1, l.unitPrice, l.gstRate, l.discountPct),
              }
            : l
        );
      }
      return [
        ...prev,
        {
          itemId: item.id,
          itemName: item.name,
          quantity: 1,
          unitPrice: price,
          gstRate,
          discountPct: 0,
          lineTotal: computeLineTotal(1, price, gstRate, 0),
        },
      ];
    });
  }, []);

  const updateQty = useCallback((itemId: number, qty: number) => {
    if (qty <= 0) {
      setCart((prev) => prev.filter((l) => l.itemId !== itemId));
    } else {
      setCart((prev) =>
        prev.map((l) =>
          l.itemId === itemId
            ? {
                ...l,
                quantity: qty,
                lineTotal: computeLineTotal(qty, l.unitPrice, l.gstRate, l.discountPct),
              }
            : l
        )
      );
    }
  }, []);

  const updateDiscount = useCallback((itemId: number, discountPct: number) => {
    const clamped = Math.max(0, Math.min(100, discountPct));
    setCart((prev) =>
      prev.map((l) =>
        l.itemId === itemId
          ? {
              ...l,
              discountPct: clamped,
              lineTotal: computeLineTotal(l.quantity, l.unitPrice, l.gstRate, clamped),
            }
          : l
      )
    );
  }, []);

  const applyOrderDiscount = useCallback((discountPct: number) => {
    const clamped = Math.max(0, Math.min(100, discountPct));
    setCart((prev) =>
      prev.map((l) => ({
        ...l,
        discountPct: clamped,
        lineTotal: computeLineTotal(l.quantity, l.unitPrice, l.gstRate, clamped),
      }))
    );
  }, []);

  // Ctrl+Z — undoes the single most recent addItem() call (decrements by one, removing the
  // line entirely once it hits zero) rather than deleting the whole line, so a cashier who
  // scanned the same item three times can back out one scan at a time.
  const undoLastLine = useCallback(() => {
    if (!lastAddedItem) return;
    setCart((prev) => {
      const line = prev.find((l) => l.itemId === lastAddedItem.id);
      if (!line) return prev;
      if (line.quantity <= 1) return prev.filter((l) => l.itemId !== lastAddedItem.id);
      const quantity = round2(line.quantity - 1);
      return prev.map((l) =>
        l.itemId === lastAddedItem.id
          ? {
              ...l,
              quantity,
              lineTotal: computeLineTotal(quantity, l.unitPrice, l.gstRate, l.discountPct),
            }
          : l
      );
    });
  }, [lastAddedItem]);

  const moveLineSelection = useCallback(
    (direction: 'up' | 'down') => {
      if (cart.length === 0) return;
      setSelectedLineIndex((i) => {
        const current = i ?? (direction === 'down' ? -1 : 0);
        const next = direction === 'down' ? current + 1 : current - 1;
        return ((next % cart.length) + cart.length) % cart.length;
      });
    },
    [cart.length]
  );

  const clearCart = useCallback(() => {
    setCart([]);
    setLastAddedItem(null);
    setSelectedLineIndex(null);
  }, []);

  // Held-sale resume replaces the whole cart wholesale — the previous bill's "last added"/
  // highlighted-line references don't apply to it, so this resets them the same as clearCart.
  const restoreCart = useCallback((items: CartItem[]) => {
    setCart(items);
    setLastAddedItem(null);
    setSelectedLineIndex(null);
  }, []);

  return {
    cart,
    lastAddedItem,
    highlightedLineItemId,
    grandTotal,
    addItem,
    updateQty,
    updateDiscount,
    applyOrderDiscount,
    undoLastLine,
    moveLineSelection,
    clearCart,
    restoreCart,
  };
}
