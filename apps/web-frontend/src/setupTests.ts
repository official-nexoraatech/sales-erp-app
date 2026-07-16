import '@testing-library/jest-dom/vitest';

// jsdom doesn't implement window.matchMedia at all (throws, not just a no-op stub) —
// needed by useMediaQuery/ThemeContext. Reports "not matching" so tests keep rendering
// the desktop-width layout by default, matching every existing test's assumptions.
if (typeof window !== 'undefined' && typeof window.matchMedia !== 'function') {
  window.matchMedia = (query: string): MediaQueryList =>
    ({
      matches: false,
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    }) as MediaQueryList;
}

// jsdom doesn't implement IntersectionObserver at all — needed by useScrollReveal (marketing
// site scroll-reveal animations). A no-op stub is enough for tests: components just never
// receive an "isVisible" callback, which every consumer already treats as a valid, renderable
// state (pre-reveal), not an error condition.
if (typeof window !== 'undefined' && typeof window.IntersectionObserver !== 'function') {
  class MockIntersectionObserver implements IntersectionObserver {
    readonly root: Element | Document | null = null;
    readonly rootMargin: string = '';
    readonly thresholds: ReadonlyArray<number> = [];
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
    takeRecords(): IntersectionObserverEntry[] {
      return [];
    }
  }
  window.IntersectionObserver = MockIntersectionObserver as unknown as typeof IntersectionObserver;
  globalThis.IntersectionObserver = window.IntersectionObserver;
}
