// Matches a tour step's declared `route` (e.g. `sales/invoices/:id`) against a real pathname
// (e.g. `/sales/invoices/142`) segment-by-segment, treating any `:xxx` segment as a wildcard.
// A plain static route (the overwhelming majority of tour content) is just a same-length,
// zero-wildcard case of the same check, so this replaces the old exact-string comparison
// without changing behavior for any existing tour.
export function matchesRoutePattern(pattern: string, pathname: string): boolean {
  const patternSegments = pattern.split('/').filter(Boolean);
  const pathSegments = pathname.split('/').filter(Boolean);
  if (patternSegments.length !== pathSegments.length) return false;
  return patternSegments.every((seg, i) => seg.startsWith(':') || seg === pathSegments[i]);
}

export function routeHasDynamicSegment(route: string): boolean {
  return route.split('/').some((seg) => seg.startsWith(':'));
}
