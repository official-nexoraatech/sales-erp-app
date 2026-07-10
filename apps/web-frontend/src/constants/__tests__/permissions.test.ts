import { describe, it, expect } from 'vitest';
import { PERMISSIONS } from '../permissions.js';
import { PERMISSIONS as SHARED_PERMISSIONS } from '@erp/types';

describe('PERMISSIONS', () => {
  it('re-exports the exact object from @erp/types', () => {
    expect(PERMISSIONS).toBe(SHARED_PERMISSIONS);
  });
});
