import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { runAxe, formatViolations } from '../../../testUtils/axe.js';
import LoginPage from '../LoginPage.js';
import { useAuthStore } from '../../../store/auth.store.js';

const lookupTenantsMock = vi.fn();
const loginMock = vi.fn();
const meMock = vi.fn();

vi.mock('../../../api/endpoints.js', () => ({
  authApi: {
    lookupTenants: (...args: unknown[]) => lookupTenantsMock(...args),
    login: (...args: unknown[]) => loginMock(...args),
    me: (...args: unknown[]) => meMock(...args),
    forgotPassword: vi.fn(),
  },
  mfaApi: { verify: vi.fn() },
}));

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/login']}>
      <LoginPage />
    </MemoryRouter>
  );
}

function fakeJwt(payload: Record<string, unknown>): string {
  return `header.${btoa(JSON.stringify(payload))}.signature`;
}

describe('LoginPage', () => {
  beforeEach(() => {
    lookupTenantsMock.mockReset();
    loginMock.mockReset();
    meMock.mockReset();
    localStorage.clear();
    useAuthStore.setState({
      user: null,
      accessToken: null,
      refreshToken: null,
      realSession: null,
      impersonationExpiresAt: null,
    });
  });

  it('single matching workspace: auto-advances straight to the password step', async () => {
    lookupTenantsMock.mockResolvedValue({
      tenants: [{ tenantId: 7, name: 'Acme Textiles', slug: 'acme' }],
    });
    loginMock.mockResolvedValue({
      accessToken: fakeJwt({ roles: [], permissions: [] }),
      refreshToken: 'refresh-token',
    });
    meMock.mockResolvedValue({ id: 1, branches: [] });

    renderPage();
    fireEvent.change(screen.getByLabelText(/email/i), { target: { value: 'ada@acme.example' } });
    fireEvent.click(screen.getByRole('button', { name: /continue/i }));

    expect(await screen.findByText(/acme textiles/i)).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText(/^password$/i), {
      target: { value: 'correcthorsebattery' },
    });
    fireEvent.click(screen.getByRole('button', { name: /sign in/i }));

    await waitFor(() =>
      expect(loginMock).toHaveBeenCalledWith(
        expect.objectContaining({ email: 'ada@acme.example', tenantId: 7 })
      )
    );
    await waitFor(() => expect(useAuthStore.getState().accessToken).not.toBeNull());
  });

  it('multiple workspaces: shows a picker, then logs in with the chosen tenantId', async () => {
    lookupTenantsMock.mockResolvedValue({
      tenants: [
        { tenantId: 7, name: 'Acme Textiles', slug: 'acme' },
        { tenantId: 9, name: 'Acme Retail', slug: 'acme-retail' },
      ],
    });
    loginMock.mockResolvedValue({
      accessToken: fakeJwt({ roles: [], permissions: [] }),
      refreshToken: 'refresh-token',
    });
    meMock.mockResolvedValue({ id: 1, branches: [] });

    renderPage();
    fireEvent.change(screen.getByLabelText(/email/i), { target: { value: 'ada@acme.example' } });
    fireEvent.click(screen.getByRole('button', { name: /continue/i }));

    fireEvent.click(await screen.findByRole('button', { name: /acme retail/i }));
    fireEvent.change(screen.getByLabelText(/^password$/i), {
      target: { value: 'correcthorsebattery' },
    });
    fireEvent.click(screen.getByRole('button', { name: /sign in/i }));

    await waitFor(() =>
      expect(loginMock).toHaveBeenCalledWith(
        expect.objectContaining({ email: 'ada@acme.example', tenantId: 9 })
      )
    );
  });

  it('no matching workspace: shows an error and offers the manual tenant-ID fallback', async () => {
    lookupTenantsMock.mockResolvedValue({ tenants: [] });

    renderPage();
    fireEvent.change(screen.getByLabelText(/email/i), {
      target: { value: 'nobody@nowhere.example' },
    });
    fireEvent.click(screen.getByRole('button', { name: /continue/i }));

    expect(await screen.findByText(/couldn't find a workspace/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /sign in with a tenant id instead/i }));
    expect(screen.getByLabelText(/tenant id/i)).toBeInTheDocument();
  });

  it('manual fallback logs in with a directly-entered tenantId', async () => {
    loginMock.mockResolvedValue({
      accessToken: fakeJwt({ roles: [], permissions: [] }),
      refreshToken: 'refresh-token',
    });
    meMock.mockResolvedValue({ id: 1, branches: [] });

    renderPage();
    fireEvent.click(screen.getByRole('button', { name: /sign in with a tenant id instead/i }));

    fireEvent.change(screen.getByLabelText(/tenant id/i), { target: { value: '3' } });
    fireEvent.change(screen.getByLabelText(/email/i), { target: { value: 'ada@acme.example' } });
    fireEvent.change(screen.getByLabelText(/^password$/i), {
      target: { value: 'correcthorsebattery' },
    });
    fireEvent.click(screen.getByRole('button', { name: /sign in/i }));

    await waitFor(() =>
      expect(loginMock).toHaveBeenCalledWith(
        expect.objectContaining({ email: 'ada@acme.example', tenantId: 3 })
      )
    );
    expect(lookupTenantsMock).not.toHaveBeenCalled();
  });

  it('has no axe violations on the initial email step', async () => {
    const { container } = renderPage();
    const violations = await runAxe(container);
    expect(violations, formatViolations(violations)).toHaveLength(0);
  });
});
