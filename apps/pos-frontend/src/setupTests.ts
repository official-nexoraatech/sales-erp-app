import '@testing-library/jest-dom/vitest';

// jsdom doesn't implement window.matchMedia at all (throws, not just a no-op stub) — needed
// by ThemeContext. Reports "not matching" by default. Mirrors web-frontend/src/setupTests.ts.
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
