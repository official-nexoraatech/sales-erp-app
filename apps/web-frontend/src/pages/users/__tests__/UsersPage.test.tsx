import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { runAxe, formatViolations } from '../../../testUtils/axe.js';
import UsersPage from '../UsersPage.js';
import { useAuthStore } from '../../../store/auth.store.js';

const listMock = vi.fn();
const impersonateMock = vi.fn();

vi.mock('../../../api/endpoints.js', () => ({
  userApi: {
    list: (...args: unknown[]) => listMock(...args),
    delete: vi.fn(),
    lock: vi.fn(),
  },
  adminSecurityApi: {
    impersonate: (...args: unknown[]) => impersonateMock(...args),
  },
}));

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={['/users']}>
        <UsersPage />
      </MemoryRouter>
    </QueryClientProvider>
  );
}

const SAMPLE_ROWS = {
  content: [
    {
      id: 1,
      firstName: 'Priya',
      lastName: 'Shah',
      email: 'priya@test.com',
      isActive: true,
      roles: ['SALES_MANAGER'],
    },
  ],
};

// Fake JWT with a base64url-ish payload (atob just needs valid base64) — good enough since
// UsersPage decodes it with atob(token.split('.')[1]), not a real signature check.
function fakeImpersonationToken(payload: Record<string, unknown>): string {
  const body = btoa(JSON.stringify(payload));
  return `header.${body}.signature`;
}

describe('UsersPage', () => {
  beforeEach(() => {
    listMock.mockReset();
    impersonateMock.mockReset();
    useAuthStore.setState({
      user: null,
      accessToken: null,
      refreshToken: null,
      realSession: null,
      impersonationExpiresAt: null,
    });
  });

  it('hides the Impersonate action without IMPERSONATE_USER', async () => {
    useAuthStore.setState({
      user: {
        id: 9,
        tenantId: 1,
        email: 'admin@test.com',
        firstName: 'A',
        lastName: 'D',
        roles: ['ADMIN'],
        branchIds: [],
        permissions: ['USER_UPDATE'],
      },
    });
    listMock.mockResolvedValue(SAMPLE_ROWS);

    renderPage();

    expect(await screen.findByText('Priya Shah')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Impersonate' })).not.toBeInTheDocument();
  });

  it('shows the Impersonate action and confirmation dialog with target details when permitted', async () => {
    useAuthStore.setState({
      user: {
        id: 9,
        tenantId: 1,
        email: 'admin@test.com',
        firstName: 'A',
        lastName: 'D',
        roles: ['ADMIN'],
        branchIds: [],
        permissions: ['IMPERSONATE_USER'],
      },
      accessToken: 'admin-token',
      refreshToken: 'admin-refresh',
    });
    listMock.mockResolvedValue(SAMPLE_ROWS);

    renderPage();

    expect(await screen.findByText('Priya Shah')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Impersonate' }));

    // Scope assertions to the dialog — "Priya Shah" etc. also appear in the underlying table row.
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByText('Impersonate this user?')).toBeInTheDocument();
    expect(within(dialog).getByText(/Priya Shah/)).toBeInTheDocument();
    expect(within(dialog).getByText(/priya@test.com/)).toBeInTheDocument();
    expect(within(dialog).getByText(/SALES_MANAGER/)).toBeInTheDocument();

    // Reason is required — confirm stays disabled until something is typed.
    expect(within(dialog).getByRole('button', { name: 'Start impersonating' })).toBeDisabled();
    fireEvent.change(within(dialog).getByLabelText(/Reason/), {
      target: { value: 'Debugging a permission report' },
    });
    expect(within(dialog).getByRole('button', { name: 'Start impersonating' })).not.toBeDisabled();
  });

  it('starts an impersonation session (stashing the real session) on confirm', async () => {
    useAuthStore.setState({
      user: {
        id: 9,
        tenantId: 1,
        email: 'admin@test.com',
        firstName: 'A',
        lastName: 'D',
        roles: ['ADMIN'],
        branchIds: [],
        permissions: ['IMPERSONATE_USER'],
      },
      accessToken: 'admin-token',
      refreshToken: 'admin-refresh',
    });
    listMock.mockResolvedValue(SAMPLE_ROWS);
    const expSeconds = Math.floor(Date.now() / 1000) + 3600;
    impersonateMock.mockResolvedValue({
      accessToken: fakeImpersonationToken({
        exp: expSeconds,
        tenantId: 1,
        roles: ['SALES_MANAGER'],
        permissions: ['CUSTOMER_VIEW'],
        branchIds: [2],
      }),
    });

    renderPage();

    expect(await screen.findByText('Priya Shah')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Impersonate' }));
    fireEvent.change(screen.getByLabelText(/Reason/), {
      target: { value: 'Reproduce a support ticket' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Start impersonating' }));

    await waitFor(() =>
      expect(impersonateMock).toHaveBeenCalledWith({
        targetUserId: 1,
        reason: 'Reproduce a support ticket',
      })
    );

    await waitFor(() => {
      const state = useAuthStore.getState();
      expect(state.realSession?.accessToken).toBe('admin-token');
      expect(state.user?.email).toBe('priya@test.com');
      expect(state.user?.permissions).toEqual(['CUSTOMER_VIEW']);
      expect(state.impersonationExpiresAt).toBe(expSeconds * 1000);
    });
  });

  it('has no axe accessibility violations with data loaded', async () => {
    useAuthStore.setState({
      user: {
        id: 9,
        tenantId: 1,
        email: 'admin@test.com',
        firstName: 'A',
        lastName: 'D',
        roles: ['ADMIN'],
        branchIds: [],
        permissions: [],
      },
    });
    listMock.mockResolvedValue(SAMPLE_ROWS);

    const { container } = renderPage();
    await screen.findByText('Priya Shah');

    const violations = await runAxe(container);
    expect(violations, formatViolations(violations)).toHaveLength(0);
  });
});
