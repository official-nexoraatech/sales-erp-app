import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { describe, it, expect } from 'vitest';
import { getAllTours } from '../registry.js';

// Cross-module regression test: every tour's `route` (and every `route` implied by a step's
// `target`) must resolve to a page that actually exists in App.tsx's route table. Tour content
// is hand-written prose, not type-checked against the router — a typo'd or renamed route
// (e.g. a page moved from `inventory/items` to `inventory/products`) would otherwise only be
// caught by a human clicking through all ~150 tours by hand. This parses the real route table
// once and checks all tour content against it statically, no running app/browser required.

const appTsxPath = resolve(dirname(fileURLToPath(import.meta.url)), '../../../App.tsx');
const appSource = readFileSync(appTsxPath, 'utf-8');

// Every authenticated-app route is a self-closing `<Route path="...">` with no leading slash,
// nested one level under the single `<ProtectedRoute><Layout /></ProtectedRoute>` wrapper (the
// only route in the file using a closing `</Route>` tag) — confirmed flat, not further nested.
const routePaths = [...appSource.matchAll(/<Route\s+path="([^"/][^"]*)"/g)].map((m) => m[1]!);

if (routePaths.length < 100) {
  throw new Error(
    `Only found ${routePaths.length} authenticated routes in App.tsx — the path="..." parsing regex likely broke against a refactor; fix this test's regex before trusting its results.`
  );
}

// Symmetric wildcard match: either side's `:xxx` segment matches anything, since both real
// App.tsx routes (`settings/branches/:id/edit`) and tour-authored routes for detail-page tours
// (`sales/invoices/:id`) legitimately use dynamic segments.
function routeExists(tourRoute: string): boolean {
  const tourSegments = tourRoute.split('/').filter(Boolean);
  return routePaths.some((real) => {
    const realSegments = real.split('/').filter(Boolean);
    if (realSegments.length !== tourSegments.length) return false;
    return realSegments.every(
      (seg, i) => seg.startsWith(':') || tourSegments[i]!.startsWith(':') || seg === tourSegments[i]
    );
  });
}

describe('DAP tour routes resolve to real pages', () => {
  const tours = getAllTours();

  it('sanity: parsed a plausible number of real routes from App.tsx', () => {
    expect(routePaths.length).toBeGreaterThan(100);
    expect(routePaths).toContain('dashboard');
    expect(routePaths).toContain('reports');
  });

  for (const tour of tours) {
    it(`"${tour.id}" — every step's route exists in App.tsx`, () => {
      const badRoutes = tour.steps.map((s) => s.route).filter((route) => !routeExists(route));
      expect(
        badRoutes,
        `tour "${tour.id}" has step(s) pointing at route(s) not in App.tsx: ${badRoutes.join(', ')}`
      ).toHaveLength(0);
    });
  }
});
