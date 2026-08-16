import { useCallback, useState } from 'react';
import type { CartItem, POSItem } from '../components/pos/types.js';

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

// Mirrors apps/sales-service/src/domain/GSTCalculator.ts's computeLine exactly (taxable *
// (1 + (gstRate + cessRate) / 100)) — cess was previously omitted here, so the on-screen
// running total under-counted (and the sale payload sent an implicit cessRate: 0) for any
// cess-liable item, diverging from the server-authoritative invoice total.
function computeLineTotal(
  qty: number,
  price: number,
  gst: number,
  discountPct = 0,
  cess = 0
): number {
  const taxable = round2(qty * price * (1 - discountPct / 100));
  return round2(taxable + (taxable * gst) / 100 + (taxable * cess) / 100);
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

  // Display-only breakdown of the same figures computeLineTotal already folds into lineTotal —
  // re-derived per line for the Current Sale summary, not a second source of truth.
  const totalItems = cart.length;
  const totalQuantity = cart.reduce((s, l) => s + l.quantity, 0);
  const subtotal = cart.reduce((s, l) => s + round2(l.quantity * l.unitPrice), 0);
  const discountAmount = cart.reduce(
    (s, l) => s + round2(l.quantity * l.unitPrice * (l.discountPct / 100)),
    0
  );
  const taxAmount = cart.reduce((s, l) => {
    const taxable = round2(l.quantity * l.unitPrice * (1 - l.discountPct / 100));
    return s + round2((taxable * (l.gstRate + l.cessRate)) / 100);
  }, 0);

  // `quantity` defaults to 1 (a normal scan/tap); a GS1 variable-weight barcode passes the
  // decoded weight-in-kg instead, so a single scan of a scale label lands the full weight
  // rather than a qty-1 line the cashier would have to hand-correct.
  const addItem = useCallback((item: POSItem, quantity = 1) => {
    const price = parseFloat(item.salePrice ?? '0');
    const gstRate = item.gstRate !== undefined && item.gstRate !== null ? Number(item.gstRate) : 18;
    const cessRate =
      item.cessRate !== undefined && item.cessRate !== null ? Number(item.cessRate) : 0;
    setLastAddedItem(item);
    setCart((prev) => {
      const existing = prev.find((l) => l.itemId === item.id);
      if (existing) {
        return prev.map((l) =>
          l.itemId === item.id
            ? {
                ...l,
                quantity: round2(l.quantity + quantity),
                lineTotal: computeLineTotal(
                  round2(l.quantity + quantity),
                  l.unitPrice,
                  l.gstRate,
                  l.discountPct,
                  l.cessRate
                ),
              }
            : l
        );
      }
      return [
        ...prev,
        {
          itemId: item.id,
          itemName: item.name,
          quantity,
          unitPrice: price,
          mrp: item.mrp ?? null,
          gstRate,
          cessRate,
          discountPct: 0,
          lineTotal: computeLineTotal(quantity, price, gstRate, 0, cessRate),
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
                lineTotal: computeLineTotal(qty, l.unitPrice, l.gstRate, l.discountPct, l.cessRate),
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
              lineTotal: computeLineTotal(l.quantity, l.unitPrice, l.gstRate, clamped, l.cessRate),
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
        lineTotal: computeLineTotal(l.quantity, l.unitPrice, l.gstRate, clamped, l.cessRate),
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
              lineTotal: computeLineTotal(
                quantity,
                l.unitPrice,
                l.gstRate,
                l.discountPct,
                l.cessRate
              ),
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
    totalItems,
    totalQuantity,
    subtotal,
    discountAmount,
    taxAmount,
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
