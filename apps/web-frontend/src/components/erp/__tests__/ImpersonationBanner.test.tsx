import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { runAxe, formatViolations } from '../../../testUtils/axe.js';
import ImpersonationBanner from '../ImpersonationBanner.js';
import { useAuthStore } from '../../../store/auth.store.js';

const endImpersonationMock = vi.fn();

vi.mock('../../../api/endpoints.js', () => ({
  adminSecurityApi: {
    endImpersonation: (...args: unknown[]) => endImpersonationMock(...args),
  },
}));

const REAL_USER = { id: 9, tenantId: 1, email: 'admin@test.com', firstName: 'A', lastName: 'D', roles: ['ADMIN'], branchIds: [], permissions: ['IMPERSONATE_USER'] };
const TARGET_USER = { id: 1, tenantId: 1, email: 'priya@test.com', firstName: 'Priya', lastName: 'Shah', roles: ['SALES_MANAGER'], branchIds: [2], permissions: ['CUSTOMER_VIEW'] };

function renderBanner() {
  return render(
    <MemoryRouter>
      <ImpersonationBanner />
    </MemoryRouter>
  );
}

describe('ImpersonationBanner', () => {
  beforeEach(() => {
    endImpersonationMock.mockReset();
    endImpersonationMock.mockResolvedValue(undefined);
    useAuthStore.setState({ user: null, accessToken: null, refreshToken: null, realSession: null, impersonationExpiresAt: null });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('renders nothing when not impersonating', () => {
    useAuthStore.setState({ user: REAL_USER, accessToken: 'admin-token', refreshToken: 'admin-refresh' });
    const { container } = renderBanner();
    expect(container).toBeEmptyDOMElement();
  });

  it('shows the target user and a live countdown while impersonating, non-dismissibly', async () => {
    const expiresAt = Date.now() + 61_000;
    useAuthStore.setState({
      user: TARGET_USER,
      accessToken: 'impersonation-token',
      refreshToken: 'admin-refresh',
      realSession: { user: REAL_USER, accessToken: 'admin-token', refreshToken: 'admin-refresh' },
      impersonationExpiresAt: expiresAt,
    });

    renderBanner();

    expect(screen.getByText(/Impersonating/)).toBeInTheDocument();
    expect(screen.getByText(/Priya Shah/)).toBeInTheDocument();
    expect(screen.getByText(/priya@test.com/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Stop impersonating' })).toBeInTheDocument();
    // No close/dismiss affordance — this banner is a hard requirement to stay visible.
    expect(screen.queryByRole('button', { name: /close/i })).not.toBeInTheDocument();
  });

  it('restores the real session and calls the end-impersonation API when stopped manually', async () => {
    useAuthStore.setState({
      user: TARGET_USER,
      accessToken: 'impersonation-token',
      refreshToken: 'admin-refresh',
      realSession: { user: REAL_USER, accessToken: 'admin-token', refreshToken: 'admin-refresh' },
      impersonationExpiresAt: Date.now() + 61_000,
    });

    renderBanner();
    fireEvent.click(screen.getByRole('button', { name: 'Stop impersonating' }));

    await waitFor(() => expect(endImpersonationMock).toHaveBeenCalled());
    await waitFor(() => {
      const state = useAuthStore.getState();
      expect(state.realSession).toBeNull();
      expect(state.accessToken).toBe('admin-token');
      expect(state.user?.email).toBe('admin@test.com');
    });
  });

  it('auto-stops and restores the real session once the countdown reaches zero', async () => {
    vi.useFakeTimers();
    useAuthStore.setState({
      user: TARGET_USER,
      accessToken: 'impersonation-token',
      refreshToken: 'admin-refresh',
      realSession: { user: REAL_USER, accessToken: 'admin-token', refreshToken: 'admin-refresh' },
      impersonationExpiresAt: Date.now() + 2000,
    });

    renderBanner();

    await act(async () => {
      vi.advanceTimersByTime(2500);
      await Promise.resolve();
    });

    await vi.waitFor(() => expect(useAuthStore.getState().realSession).toBeNull());
    expect(useAuthStore.getState().accessToken).toBe('admin-token');
  });

  it('has no axe accessibility violations while impersonating', async () => {
    useAuthStore.setState({
      user: TARGET_USER,
      accessToken: 'impersonation-token',
      refreshToken: 'admin-refresh',
      realSession: { user: REAL_USER, accessToken: 'admin-token', refreshToken: 'admin-refresh' },
      impersonationExpiresAt: Date.now() + 61_000,
    });

    const { container } = renderBanner();
    const violations = await runAxe(container);
    expect(violations, formatViolations(violations)).toHaveLength(0);
  });
});
