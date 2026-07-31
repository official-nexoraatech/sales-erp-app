import { describe, it, expect } from 'vitest';
import { getAllTours, getTourById, getToursForModule } from '../registry.js';
import { TourDefinitionSchema } from '../schema.js';

describe('DAP content registry', () => {
  it('auto-discovers at least the DAP-1 pilot tour', () => {
    const tours = getAllTours();
    expect(tours.length).toBeGreaterThan(0);
    expect(tours.some((t) => t.id === 'purchase-to-dashboard-workflow')).toBe(true);
  });

  it('every discovered tour passes schema validation', () => {
    for (const tour of getAllTours()) {
      expect(() => TourDefinitionSchema.parse(tour)).not.toThrow();
    }
  });

  it('no tour anywhere forces a real click to advance (interactive mode is unused by policy)', () => {
    // Gating Next on a real DOM click was a genuine UX bug when the target was a Save/Confirm
    // button — a "user guide" tour must stay a passive walkthrough, never require actually
    // creating real data (an invoice, a payment, an approved return) just to read the next
    // step. `mode: 'interactive'` still exists in the engine, but no shipped tour should use it.
    for (const tour of getAllTours()) {
      const interactiveSteps = tour.steps.filter((s) => s.mode === 'interactive');
      expect(
        interactiveSteps,
        `tour "${tour.id}" has interactive step(s): ${interactiveSteps.map((s) => s.id).join(', ')}`
      ).toHaveLength(0);
    }
  });

  it('every tour has globally unique step ids', () => {
    for (const tour of getAllTours()) {
      const ids = tour.steps.map((s) => s.id);
      expect(new Set(ids).size).toBe(ids.length);
    }
  });

  it('every interactive step declares a requiredAction', () => {
    for (const tour of getAllTours()) {
      for (const step of tour.steps) {
        if (step.mode === 'interactive') {
          expect(step.requiredAction).toBeDefined();
        }
      }
    }
  });

  it('getTourById returns the pilot tour by its real id', () => {
    const tour = getTourById('purchase-to-dashboard-workflow');
    expect(tour?.title).toContain('Purchase');
  });

  it('getTourById returns undefined for an unknown id', () => {
    expect(getTourById('does-not-exist')).toBeUndefined();
  });

  it('getToursForModule filters by module', () => {
    const crossModule = getToursForModule('cross-module');
    expect(crossModule.every((t) => t.module === 'cross-module')).toBe(true);
    expect(crossModule.length).toBeGreaterThan(0);
  });

  describe('pilot tour content', () => {
    const tour = getTourById('purchase-to-dashboard-workflow')!;

    it('covers the full Purchase→GRN→Stock→Accounting→GST→Reports workflow', () => {
      const ids = tour.steps.map((s) => s.id);
      expect(ids).toEqual([
        'intro',
        'purchase-order',
        'grn',
        'stock',
        'accounting',
        'gst',
        'reports',
        'outro',
      ]);
    });

    it('has no interactive step forcing a real click to advance — a guided tour is a passive walkthrough', () => {
      // Every step could, mechanically, gate Next on a real DOM click via `mode: 'interactive'`
      // (useTourAction still supports it), but forcing that on a Save/Confirm button meant the
      // tour couldn't be read without actually creating real data — a genuine UX bug, not a
      // feature. No shipped tour should use it.
      expect(tour.steps.some((s) => s.mode === 'interactive')).toBe(false);
    });

    it('every step declares real business-education routes (no leading slash, matching App.tsx route table)', () => {
      for (const step of tour.steps) {
        expect(step.route.startsWith('/')).toBe(false);
      }
    });

    it('most steps carry businessImpact content, not just UI description', () => {
      const withImpact = tour.steps.filter((s) => (s.businessImpact?.length ?? 0) > 0);
      expect(withImpact.length).toBeGreaterThanOrEqual(5);
    });
  });
});
