/**
 * RBAC gate for pos-frontend routes — shown by RequirePermission (main.tsx) when an
 * authenticated user's role doesn't hold POS_MANAGE (e.g. an HR Manager who is a valid ERP
 * login but not till staff). See auth.test.ts's hasPermission tests for the gating logic
 * itself; this covers the screen shown for the denied case, which must always leave a way
 * to sign out (previously every "bare" pos-frontend screen except ShiftSummaryScreen had none).
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import AccessDeniedScreen from '../AccessDeniedScreen.js';
import { getAccessToken, setTokens } from '../auth.js';
import { runAxe, formatViolations } from '../testUtils/axe.js';

beforeEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
});

function renderScreen() {
  return render(
    <MemoryRouter>
      <AccessDeniedScreen />
    </MemoryRouter>
  );
}

describe('AccessDeniedScreen', () => {
  it('explains the lack of POS access without a raw backend error string', () => {
    renderScreen();
    expect(screen.getByText(/No POS Access/i)).toBeInTheDocument();
    expect(screen.queryByText(/Missing permission/i)).not.toBeInTheDocument();
  });

  it('logging out clears the stored token', () => {
    setTokens('access-1', 'refresh-1');
    renderScreen();

    fireEvent.click(screen.getByRole('button', { name: 'Logout' }));

    expect(getAccessToken()).toBeNull();
  });

  it('has no axe accessibility violations', async () => {
    const { container } = renderScreen();
    const violations = await runAxe(container);
    expect(violations, formatViolations(violations)).toHaveLength(0);
  });
});
