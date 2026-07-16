import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { runAxe, formatViolations } from '../../../testUtils/axe.js';
import SignupPage from '../SignupPage.js';
import { useAuthStore } from '../../../store/auth.store.js';

const publicSignupMock = vi.fn();
const loginMock = vi.fn();
const meMock = vi.fn();

vi.mock('../../../api/endpoints.js', () => ({
  tenantApi: { publicSignup: (...args: unknown[]) => publicSignupMock(...args) },
  authApi: {
    login: (...args: unknown[]) => loginMock(...args),
    me: (...args: unknown[]) => meMock(...args),
  },
}));

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/signup']}>
      <SignupPage />
    </MemoryRouter>
  );
}

function fakeJwt(payload: Record<string, unknown>): string {
  return `header.${btoa(JSON.stringify(payload))}.signature`;
}

describe('SignupPage', () => {
  beforeEach(() => {
    publicSignupMock.mockReset();
    loginMock.mockReset();
    meMock.mockReset();
    useAuthStore.setState({
      user: null,
      accessToken: null,
      refreshToken: null,
      realSession: null,
      impersonationExpiresAt: null,
    });
  });

  it('shows validation errors for empty required fields', async () => {
    renderPage();
    fireEvent.click(screen.getByRole('button', { name: /create workspace/i }));
    expect(await screen.findByText(/organization name is required/i)).toBeInTheDocument();
    expect(publicSignupMock).not.toHaveBeenCalled();
  });

  it('provisions the tenant, logs the new admin in, and redirects on success', async () => {
    publicSignupMock.mockResolvedValue({ tenantId: 42, adminUserId: 1, adminEmail: 'a@b.com' });
    loginMock.mockResolvedValue({
      accessToken: fakeJwt({ roles: [], permissions: [] }),
      refreshToken: 'refresh-token',
    });
    meMock.mockResolvedValue({ id: 1, branches: [] });

    renderPage();
    fireEvent.change(screen.getByLabelText(/organization name/i), {
      target: { value: 'Acme Textiles' },
    });
    fireEvent.change(screen.getByLabelText(/workspace url/i), { target: { value: 'acme' } });
    fireEvent.change(screen.getByLabelText(/your work email/i), {
      target: { value: 'admin@acme.example' },
    });
    fireEvent.change(screen.getByLabelText(/first name/i), { target: { value: 'Ada' } });
    fireEvent.change(screen.getByLabelText(/last name/i), { target: { value: 'Lovelace' } });
    fireEvent.change(screen.getByLabelText(/^password$/i), {
      target: { value: 'supersecurepassword123' },
    });

    fireEvent.click(screen.getByRole('button', { name: /create workspace/i }));

    await waitFor(() => expect(publicSignupMock).toHaveBeenCalledTimes(1));
    expect(loginMock).toHaveBeenCalledWith(
      expect.objectContaining({ email: 'admin@acme.example', tenantId: 42 })
    );
    await waitFor(() => expect(useAuthStore.getState().accessToken).not.toBeNull());
  });

  it('has no axe violations', async () => {
    const { container } = renderPage();
    const violations = await runAxe(container);
    expect(violations, formatViolations(violations)).toHaveLength(0);
  });
});
