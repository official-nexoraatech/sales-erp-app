import { render, screen, act } from '@testing-library/react';
import { describe, it, expect, beforeEach } from 'vitest';
import { ThemeProvider, useTheme } from '../ThemeContext.js';

function Probe() {
  const { isDark } = useTheme();
  return <span>dark={String(isDark)}</span>;
}

function renderProbe() {
  return render(
    <ThemeProvider>
      <Probe />
    </ThemeProvider>
  );
}

describe('ThemeProvider (pos-frontend)', () => {
  beforeEach(() => {
    localStorage.clear();
    document.documentElement.classList.remove('dark');
  });

  it('applies the dark class to <html> from a stored preference', () => {
    localStorage.setItem('erp-theme', 'dark');
    renderProbe();
    expect(document.documentElement.classList.contains('dark')).toBe(true);
    expect(screen.getByText('dark=true')).toBeInTheDocument();
  });

  it('picks up a theme change from another tab via the storage event', () => {
    renderProbe();
    expect(screen.getByText('dark=false')).toBeInTheDocument();

    act(() => {
      localStorage.setItem('erp-theme', 'dark');
      window.dispatchEvent(new StorageEvent('storage', { key: 'erp-theme', newValue: 'dark' }));
    });

    expect(screen.getByText('dark=true')).toBeInTheDocument();
    expect(document.documentElement.classList.contains('dark')).toBe(true);
  });

  it('ignores storage events for unrelated keys', () => {
    renderProbe();
    act(() => {
      window.dispatchEvent(new StorageEvent('storage', { key: 'some-other-key', newValue: 'x' }));
    });
    expect(screen.getByText('dark=false')).toBeInTheDocument();
  });
});
