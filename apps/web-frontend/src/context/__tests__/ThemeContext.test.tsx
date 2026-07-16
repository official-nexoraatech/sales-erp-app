import { render, screen, act } from '@testing-library/react';
import { describe, it, expect, beforeEach } from 'vitest';
import { ThemeProvider, useTheme } from '../ThemeContext.js';

function Probe() {
  const { mode, reducedMotion } = useTheme();
  return (
    <span>
      mode={mode} motion={String(reducedMotion)}
    </span>
  );
}

function renderProbe() {
  return render(
    <ThemeProvider>
      <Probe />
    </ThemeProvider>
  );
}

describe('ThemeProvider', () => {
  beforeEach(() => {
    localStorage.clear();
    document.documentElement.classList.remove('dark', 'hc');
    document.documentElement.removeAttribute('data-motion');
  });

  it('applies the mode class to <html> and persists it', () => {
    localStorage.setItem('erp-theme', 'hc');
    renderProbe();
    expect(document.documentElement.classList.contains('hc')).toBe(true);
    expect(screen.getByText(/mode=hc/)).toBeInTheDocument();
  });

  it('picks up a mode change from another tab via the storage event', () => {
    renderProbe();
    expect(document.documentElement.classList.contains('dark')).toBe(false);

    act(() => {
      localStorage.setItem('erp-theme', 'dark');
      window.dispatchEvent(new StorageEvent('storage', { key: 'erp-theme', newValue: 'dark' }));
    });

    expect(screen.getByText(/mode=dark/)).toBeInTheDocument();
    expect(document.documentElement.classList.contains('dark')).toBe(true);
  });

  it('picks up a reduced-motion change from another tab via the storage event', () => {
    renderProbe();
    expect(screen.getByText(/motion=false/)).toBeInTheDocument();

    act(() => {
      localStorage.setItem('erp-reduced-motion', 'true');
      window.dispatchEvent(
        new StorageEvent('storage', { key: 'erp-reduced-motion', newValue: 'true' })
      );
    });

    expect(screen.getByText(/motion=true/)).toBeInTheDocument();
    expect(document.documentElement.getAttribute('data-motion')).toBe('none');
  });

  it('ignores storage events for unrelated keys', () => {
    renderProbe();
    act(() => {
      window.dispatchEvent(new StorageEvent('storage', { key: 'some-other-key', newValue: 'x' }));
    });
    expect(screen.getByText(/mode=light/)).toBeInTheDocument();
  });
});
