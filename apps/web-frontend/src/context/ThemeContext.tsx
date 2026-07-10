import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';

/** Per ERP-PLANNING/05_ERP_THEME_SYSTEM.md §3 — Light/Dark/High-Contrast are mutually
 * exclusive modes, not independent toggles. */
export type ThemeMode = 'light' | 'dark' | 'hc';

interface ThemeContextValue {
  mode: ThemeMode;
  setMode: (mode: ThemeMode) => void;
  /** @deprecated kept for existing callers — equivalent to `mode === 'dark'`. */
  isDark: boolean;
  /** @deprecated kept for existing callers — cycles light/dark only, never lands on 'hc'. */
  toggleTheme: () => void;
  reducedMotion: boolean;
  setReducedMotion: (v: boolean) => void;
}

const ThemeContext = createContext<ThemeContextValue>({
  mode: 'light',
  setMode: () => {},
  isDark: false,
  toggleTheme: () => {},
  reducedMotion: false,
  setReducedMotion: () => {},
});

const MODE_KEY = 'erp-theme';
const MOTION_KEY = 'erp-reduced-motion';

function readStoredMode(): ThemeMode | null {
  const stored = localStorage.getItem(MODE_KEY);
  return stored === 'light' || stored === 'dark' || stored === 'hc' ? stored : null;
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [mode, setModeState] = useState<ThemeMode>(
    () => readStoredMode() ?? (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'),
  );
  const [reducedMotion, setReducedMotionState] = useState<boolean>(() => {
    const stored = localStorage.getItem(MOTION_KEY);
    if (stored !== null) return stored === 'true';
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  });

  useEffect(() => {
    const html = document.documentElement;
    html.classList.remove('dark', 'hc');
    if (mode !== 'light') html.classList.add(mode);
    localStorage.setItem(MODE_KEY, mode);
  }, [mode]);

  useEffect(() => {
    const html = document.documentElement;
    if (reducedMotion) {
      html.setAttribute('data-motion', 'none');
    } else {
      html.removeAttribute('data-motion');
    }
    localStorage.setItem(MOTION_KEY, String(reducedMotion));
  }, [reducedMotion]);

  function toggleTheme(): void {
    setModeState((prev) => (prev === 'dark' ? 'light' : 'dark'));
  }

  const value: ThemeContextValue = {
    mode,
    setMode: setModeState,
    isDark: mode === 'dark',
    toggleTheme,
    reducedMotion,
    setReducedMotion: setReducedMotionState,
  };

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeContextValue {
  return useContext(ThemeContext);
}
