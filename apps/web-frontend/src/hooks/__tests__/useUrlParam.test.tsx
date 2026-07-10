import { renderHook, act } from '@testing-library/react';
import { MemoryRouter, useSearchParams } from 'react-router-dom';
import { describe, it, expect } from 'vitest';
import { useUrlParams, toNumber } from '../useUrlParam.js';

const DEFAULTS = { q: '', status: '', page: '1' };

function wrapper({ children, initialEntries }: { children: React.ReactNode; initialEntries?: string[] }) {
  return <MemoryRouter initialEntries={initialEntries ?? ['/']}>{children}</MemoryRouter>;
}

describe('useUrlParams', () => {
  it('returns the defaults when no params are present in the URL', () => {
    const { result } = renderHook(() => useUrlParams(DEFAULTS), { wrapper });
    expect(result.current[0]).toEqual(DEFAULTS);
  });

  it('reads initial values from the URL, falling back to defaults for missing keys', () => {
    const { result } = renderHook(() => useUrlParams(DEFAULTS), {
      wrapper: (props) => wrapper({ ...props, initialEntries: ['/?q=ramesh&page=3'] }),
    });
    expect(result.current[0]).toEqual({ q: 'ramesh', status: '', page: '3' });
  });

  it('patches multiple keys atomically in a single update — the exact race this hook exists to avoid', () => {
    const { result } = renderHook(
      () => {
        const [values, patch] = useUrlParams(DEFAULTS);
        const [params] = useSearchParams();
        return { values, patch, params };
      },
      { wrapper },
    );

    // Two keys change together, as they would from one user action (e.g. a filter change
    // that also resets pagination) — must both land, not race against each other.
    act(() => result.current.patch({ q: 'ramesh', page: '2' }));

    expect(result.current.values).toEqual({ q: 'ramesh', status: '', page: '2' });
    expect(result.current.params.get('q')).toBe('ramesh');
    expect(result.current.params.get('page')).toBe('2');
  });

  it('omits a key from the URL once patched back to its default', () => {
    const { result } = renderHook(
      () => {
        const [values, patch] = useUrlParams(DEFAULTS);
        const [params] = useSearchParams();
        return { values, patch, params };
      },
      { wrapper: (props) => wrapper({ ...props, initialEntries: ['/?status=ACTIVE'] }) },
    );

    act(() => result.current.patch({ status: '' }));

    expect(result.current.values.status).toBe('');
    expect(result.current.params.has('status')).toBe(false);
  });
});

describe('toNumber', () => {
  it('parses a valid numeric string', () => {
    expect(toNumber('3', 1)).toBe(3);
  });

  it('falls back for a malformed numeric string', () => {
    expect(toNumber('not-a-number', 1)).toBe(1);
  });
});
