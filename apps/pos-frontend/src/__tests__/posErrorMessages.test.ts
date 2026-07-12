import { describe, it, expect } from 'vitest';
import { friendlySaleErrorMessage } from '../posErrorMessages.js';
import type { CartItem, Customer } from '../components/pos/types.js';

const cart: CartItem[] = [
  {
    itemId: 36,
    itemName: 'Amul Milk 1L',
    quantity: 1,
    unitPrice: 12,
    gstRate: 5,
    discountPct: 0,
    lineTotal: 12.6,
  },
];
const customer: Customer = {
  id: 1,
  displayName: 'Ramesh Traders',
  phone: '9999999999',
  loyaltyPoints: 40,
};

describe('friendlySaleErrorMessage', () => {
  it('names the item and formats currency for PRICE_FLOOR_VIOLATION', () => {
    const msg = friendlySaleErrorMessage(
      {
        code: 'PRICE_FLOOR_VIOLATION',
        message: 'Item 36 min sale price is 23, offered 12',
        details: { itemId: 36, minPrice: 23, offered: 12 },
      },
      cart,
      null
    );
    expect(msg).toBe(
      "Amul Milk 1L can't be sold below ₹23.00 — you entered ₹12.00. Update the price to continue."
    );
  });

  it('names the item for INSUFFICIENT_STOCK', () => {
    const msg = friendlySaleErrorMessage(
      { code: 'INSUFFICIENT_STOCK', details: { itemId: 36, available: 2, requested: 5 } },
      cart,
      null
    );
    expect(msg).toBe(
      "Only 2 of Amul Milk 1L left in stock — you're trying to sell 5. Reduce the quantity or restock."
    );
  });

  it('falls back to a generic item label when the itemId is not in the cart', () => {
    const msg = friendlySaleErrorMessage(
      { code: 'INSUFFICIENT_STOCK', details: { itemId: 999, available: 0, requested: 1 } },
      cart,
      null
    );
    expect(msg).toContain('item #999');
  });

  it('names the customer for CREDIT_LIMIT_EXCEEDED', () => {
    const msg = friendlySaleErrorMessage(
      { code: 'CREDIT_LIMIT_EXCEEDED', details: { limit: 5000, newBalance: 6200 } },
      cart,
      customer
    );
    expect(msg).toBe(
      'This sale would put Ramesh Traders ₹1200.00 over their ₹5000.00 credit limit. Collect payment or get manager approval.'
    );
  });

  it('names the customer for INSUFFICIENT_POINTS', () => {
    const msg = friendlySaleErrorMessage(
      { code: 'INSUFFICIENT_POINTS', details: { available: 40, requested: 100 } },
      cart,
      customer
    );
    expect(msg).toBe('Ramesh Traders only has 40 loyalty points — lower the redeem amount.');
  });

  it('uses the backend message as-is for DISCOUNT_LIMIT_EXCEEDED', () => {
    const msg = friendlySaleErrorMessage(
      {
        code: 'DISCOUNT_LIMIT_EXCEEDED',
        message: 'Discount above 10% requires a manager to complete this sale',
      },
      cart,
      null
    );
    expect(msg).toBe('Discount above 10% requires a manager to complete this sale');
  });

  it('falls back to the raw backend message for an unmapped code', () => {
    const msg = friendlySaleErrorMessage(
      { code: 'SOME_FUTURE_CODE', message: 'a new kind of failure' },
      cart,
      null
    );
    expect(msg).toBe('a new kind of failure');
  });

  it('falls back to a generic string when there is no code and no message', () => {
    const msg = friendlySaleErrorMessage({}, cart, null);
    expect(msg).toBe('Sale failed');
  });
});
