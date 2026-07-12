import { describe, it, expect } from 'vitest';
import { friendlyApiErrorMessage } from '../errorMessages.js';

const items = [{ id: 36, name: 'Amul Milk 1L' }];

describe('friendlyApiErrorMessage', () => {
  it('names the item and formats currency for PRICE_FLOOR_VIOLATION', () => {
    const msg = friendlyApiErrorMessage(
      {
        code: 'PRICE_FLOOR_VIOLATION',
        message: 'Item 36 min sale price is 23, offered 12',
        details: { itemId: 36, minPrice: 23, offered: 12 },
      },
      { items }
    );
    expect(msg).toContain('Amul Milk 1L');
    expect(msg).not.toContain('Item 36');
  });

  it('names the item for INSUFFICIENT_STOCK', () => {
    const msg = friendlyApiErrorMessage(
      {
        code: 'INSUFFICIENT_STOCK',
        message: 'Item 36 has only 2 units available',
        details: { itemId: 36, available: 2, requested: 5 },
      },
      { items }
    );
    expect(msg).toBe('Only 2 of Amul Milk 1L in stock — requested 5.');
  });

  it('names the customer for CREDIT_LIMIT_EXCEEDED', () => {
    const msg = friendlyApiErrorMessage(
      {
        code: 'CREDIT_LIMIT_EXCEEDED',
        message: 'Invoice would exceed credit limit. Limit: 5000, New balance: 6200',
        details: { limit: 5000, newBalance: 6200 },
      },
      { customerName: 'Ramesh Traders' }
    );
    expect(msg).toContain('Ramesh Traders');
    expect(msg).toContain('5,000');
    expect(msg).toContain('6,200');
  });

  it('falls back to a generic customer label when no context given', () => {
    const msg = friendlyApiErrorMessage({
      code: 'CREDIT_LIMIT_EXCEEDED',
      message: 'Invoice would exceed credit limit. Limit: 5000, New balance: 6200',
      details: { limit: 5000, newBalance: 6200 },
    });
    expect(msg).toContain('This customer');
  });

  it('falls back to the raw backend message for an unmapped code', () => {
    const msg = friendlyApiErrorMessage({
      code: 'SOME_FUTURE_CODE',
      message: 'a new kind of failure',
    });
    expect(msg).toBe('a new kind of failure');
  });

  it('falls back to a generic string when the message is empty', () => {
    const msg = friendlyApiErrorMessage({ code: 'UNKNOWN', message: '' });
    expect(msg).toBe('Something went wrong. Please try again.');
  });
});
