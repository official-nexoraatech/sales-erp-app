// CRM-ROADMAP Phase 3, Feature 6 (Field-level RBAC for CRM Records) — filter-logic correctness
// per permission combination, per this feature's own stated testing requirement.
import { describe, it, expect } from 'vitest';
import {
  omitFieldsWithoutPermission,
  omitFieldsFromListWithoutPermission,
} from '../field-visibility.js';

describe('omitFieldsWithoutPermission', () => {
  const obj = { id: 1, name: 'Deal', value: 5000 };

  it('returns the object unchanged when the caller holds the permission', () => {
    const result = omitFieldsWithoutPermission(
      obj,
      ['value'],
      ['OPPORTUNITY_VALUE_VIEW'],
      'OPPORTUNITY_VALUE_VIEW'
    );
    expect(result).toEqual(obj);
  });

  it('omits the field entirely (not nulled) when the caller lacks the permission', () => {
    const result = omitFieldsWithoutPermission(obj, ['value'], [], 'OPPORTUNITY_VALUE_VIEW');
    expect('value' in result).toBe(false);
    expect(result).toEqual({ id: 1, name: 'Deal' });
  });

  it('does not mutate the original object', () => {
    omitFieldsWithoutPermission(obj, ['value'], [], 'OPPORTUNITY_VALUE_VIEW');
    expect(obj).toEqual({ id: 1, name: 'Deal', value: 5000 });
  });

  it('omits multiple fields at once', () => {
    const wide = { id: 1, value: 5000, margin: 0.2 };
    const result = omitFieldsWithoutPermission(
      wide,
      ['value', 'margin'],
      [],
      'OPPORTUNITY_VALUE_VIEW'
    );
    expect(result).toEqual({ id: 1 });
  });

  it('is unaffected by an unrelated permission the caller does hold', () => {
    const result = omitFieldsWithoutPermission(
      obj,
      ['value'],
      ['OPPORTUNITY_UPDATE'],
      'OPPORTUNITY_VALUE_VIEW'
    );
    expect('value' in result).toBe(false);
  });
});

describe('omitFieldsFromListWithoutPermission', () => {
  const rows = [
    { id: 1, value: 100 },
    { id: 2, value: 200 },
  ];

  it('leaves every row unchanged when the caller holds the permission', () => {
    const result = omitFieldsFromListWithoutPermission(
      rows,
      ['value'],
      ['OPPORTUNITY_VALUE_VIEW'],
      'OPPORTUNITY_VALUE_VIEW'
    );
    expect(result).toEqual(rows);
  });

  it('omits the field from every row when the caller lacks the permission', () => {
    const result = omitFieldsFromListWithoutPermission(
      rows,
      ['value'],
      [],
      'OPPORTUNITY_VALUE_VIEW'
    );
    expect(result).toEqual([{ id: 1 }, { id: 2 }]);
  });

  it('returns an empty list unchanged', () => {
    const result = omitFieldsFromListWithoutPermission([], ['value'], [], 'OPPORTUNITY_VALUE_VIEW');
    expect(result).toEqual([]);
  });
});
