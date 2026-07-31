import { describe, it, expect } from 'vitest';
import { TourDefinitionSchema, validateTourDefinition } from '../schema.js';

function baseTour(overrides: Record<string, unknown> = {}) {
  return {
    id: 'test-tour',
    version: 1,
    type: 'quick',
    title: 'Test Tour',
    description: 'A tour for testing',
    module: 'cross-module',
    estimatedMinutes: 2,
    steps: [
      {
        id: 'step-1',
        route: 'dashboard',
        title: 'Step 1',
        body: 'Body text',
        mode: 'informational',
      },
    ],
    ...overrides,
  };
}

describe('TourDefinitionSchema', () => {
  it('accepts a minimal valid tour', () => {
    expect(() => validateTourDefinition(baseTour())).not.toThrow();
  });

  it('rejects a non-kebab-case id', () => {
    expect(() => validateTourDefinition(baseTour({ id: 'Test_Tour' }))).toThrow();
  });

  it('rejects an unknown permission constant (guards against typos in content)', () => {
    const tour = baseTour({
      steps: [
        {
          id: 'step-1',
          route: 'dashboard',
          title: 'Step 1',
          body: 'Body',
          mode: 'informational',
          requiredPermission: 'NOT_A_REAL_PERMISSION',
        },
      ],
    });
    expect(() => validateTourDefinition(tour)).toThrow();
  });

  it('accepts a real permission constant', () => {
    const tour = baseTour({
      steps: [
        {
          id: 'step-1',
          route: 'dashboard',
          title: 'Step 1',
          body: 'Body',
          mode: 'informational',
          requiredPermission: 'DASHBOARD_VIEW',
        },
      ],
    });
    expect(() => validateTourDefinition(tour)).not.toThrow();
  });

  it('rejects an interactive step with no requiredAction (ADR-5)', () => {
    const tour = baseTour({
      steps: [{ id: 'step-1', route: 'dashboard', title: 'S', body: 'B', mode: 'interactive' }],
    });
    expect(() => validateTourDefinition(tour)).toThrow();
  });

  it('accepts an interactive step with a requiredAction', () => {
    const tour = baseTour({
      steps: [
        {
          id: 'step-1',
          route: 'purchase/grns',
          title: 'S',
          body: 'B',
          mode: 'interactive',
          target: '[data-tour-id="x"]',
          placement: 'bottom',
          requiredAction: { type: 'click', selector: '[data-tour-id="x"]' },
        },
      ],
    });
    expect(() => validateTourDefinition(tour)).not.toThrow();
  });

  it('rejects a target with placement "center" (a spotlighted step must have a real placement)', () => {
    const tour = baseTour({
      steps: [
        {
          id: 'step-1',
          route: 'dashboard',
          title: 'S',
          body: 'B',
          mode: 'informational',
          target: '[data-tour-id="x"]',
          placement: 'center',
        },
      ],
    });
    expect(() => validateTourDefinition(tour)).toThrow();
  });

  it('rejects duplicate step ids within one tour', () => {
    const tour = baseTour({
      steps: [
        { id: 'dup', route: 'dashboard', title: 'A', body: 'B', mode: 'informational' },
        { id: 'dup', route: 'reports', title: 'C', body: 'D', mode: 'informational' },
      ],
    });
    expect(() => validateTourDefinition(tour)).toThrow();
  });

  it('rejects a tour with zero steps', () => {
    expect(() => validateTourDefinition(baseTour({ steps: [] }))).toThrow();
  });

  it('parses successfully via the exported schema object directly', () => {
    const result = TourDefinitionSchema.safeParse(baseTour());
    expect(result.success).toBe(true);
  });
});
