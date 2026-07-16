import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';

interface ThemeContextValue {
  isDark: boolean;
  toggleTheme: () => void;
}

const ThemeContext = createContext<ThemeContextValue>({ isDark: false, toggleTheme: () => {} });

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [isDark, setIsDark] = useState(() => {
    const stored = localStorage.getItem('erp-theme');
    if (stored) return stored === 'dark';
    return window.matchMedia('(prefers-color-scheme: dark)').matches;
  });

  useEffect(() => {
    const html = document.documentElement;
    if (isDark) {
      html.classList.add('dark');
      localStorage.setItem('erp-theme', 'dark');
    } else {
      html.classList.remove('dark');
      localStorage.setItem('erp-theme', 'light');
    }
  }, [isDark]);

  // Cross-tab sync — the `storage` event fires in every other same-origin tab whenever
  // localStorage changes, so toggling dark mode in one tab updates every other open tab.
  useEffect(() => {
    function onStorage(e: StorageEvent) {
      if (e.key === 'erp-theme' && e.newValue !== null) {
        setIsDark(e.newValue === 'dark');
      }
    }
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

  function toggleTheme() {
    setIsDark((prev) => !prev);
  }

  return <ThemeContext.Provider value={{ isDark, toggleTheme }}>{children}</ThemeContext.Provider>;
}

export function useTheme() {
  return useContext(ThemeContext);
}
