import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import OrganizationPage from '../OrganizationPage.js';
import { useAuthStore } from '../../../store/auth.store.js';
import { runAxe, formatViolations } from '../../../testUtils/axe.js';

vi.mock('../../../api/endpoints.js', () => ({
  organizationApi: {
    get: vi.fn().mockResolvedValue({ legalName: 'Test Co' }),
    update: vi.fn(),
  },
}));

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <OrganizationPage />
      </MemoryRouter>
    </QueryClientProvider>
  );
}

describe('OrganizationPage GSTIN validation', () => {
  beforeEach(() => {
    // ES-37 — the Save button is now gated on ORG_SETTINGS_EDIT (previously unconditional).
    useAuthStore.setState({
      user: {
        id: 1, tenantId: 1, email: 't@test.com', firstName: 'T', lastName: 'U',
        roles: ['ADMIN'], branchIds: [], permissions: ['ORG_SETTINGS_EDIT'],
      },
    });
  });

  it('rejects a GSTIN with 0 in the 9th (entity-code) position', async () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={qc}>
        <MemoryRouter>
          <OrganizationPage />
        </MemoryRouter>
      </QueryClientProvider>
    );

    const gstinInput = await screen.findByLabelText('GSTIN');
    // Valid shape except the entity-code digit (9th position after state+PAN) is 0,
    // which the shared GSTIN_REGEX correctly excludes ([1-9A-Z], not [0-9A-Z]).
    fireEvent.change(gstinInput, { target: { value: '27AAPFU0939F0ZV' } });
    fireEvent.blur(gstinInput);

    fireEvent.click(screen.getByRole('button', { name: 'Save Changes' }));

    expect(await screen.findByText('Invalid GSTIN format')).toBeInTheDocument();
  });

  it('accepts a valid GSTIN', async () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={qc}>
        <MemoryRouter>
          <OrganizationPage />
        </MemoryRouter>
      </QueryClientProvider>
    );

    const gstinInput = await screen.findByLabelText('GSTIN');
    fireEvent.change(gstinInput, { target: { value: '27AAPFU0939F1ZV' } });
    fireEvent.blur(gstinInput);

    await waitFor(() => {
      expect(screen.queryByText('Invalid GSTIN format')).not.toBeInTheDocument();
    });
  });

  // ERP-PLANNING/07_ERP_IMPLEMENTATION_PLAN.md Phase 7.
  it('has no axe accessibility violations', async () => {
    const { container } = renderPage();
    await screen.findByLabelText('GSTIN');

    const violations = await runAxe(container);
    expect(violations, formatViolations(violations)).toHaveLength(0);
  });
});
