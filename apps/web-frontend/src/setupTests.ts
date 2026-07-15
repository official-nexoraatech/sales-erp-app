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
