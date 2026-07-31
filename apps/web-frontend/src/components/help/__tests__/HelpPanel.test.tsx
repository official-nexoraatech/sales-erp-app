import type { ReactElement } from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { runAxe, formatViolations } from '../../../testUtils/axe.js';
import { HelpPanel } from '../HelpPanel.js';
import { useAuthStore } from '../../../store/auth.store.js';
import { TourProvider } from '../../../dap/index.js';
import type * as EndpointsModule from '../../../api/endpoints.js';

// HelpPanel now offers Guided Tours (DAP-1), which need Router + React Query + TourProvider
// context — none of this file's assertions concern tour progress itself, so the DAP API is
// mocked to resolve instantly rather than attempt a real network call in jsdom.
vi.mock('../../../api/endpoints.js', async (importOriginal) => {
  const actual = await importOriginal<typeof EndpointsModule>();
  return {
    ...actual,
    dapApi: {
      getProgress: vi.fn().mockResolvedValue([]),
      upsertProgress: vi.fn().mockResolvedValue({ tourId: '', status: 'in_progress' }),
      recordEvent: vi.fn().mockResolvedValue({ recorded: true }),
    },
  };
});

function renderHelpPanel(ui: ReactElement) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <TourProvider>{ui}</TourProvider>
      </MemoryRouter>
    </QueryClientProvider>
  );
}

describe('HelpPanel', () => {
  beforeEach(() => {
    useAuthStore.setState({
      user: null,
      accessToken: null,
      refreshToken: null,
      realSession: null,
      impersonationExpiresAt: null,
    });
  });

  it('renders route-specific content for a known path', () => {
    renderHelpPanel(<HelpPanel currentPath="/customers" onClose={vi.fn()} />);
    expect(screen.getByText('Help — Customers')).toBeInTheDocument();
    expect(screen.getByText('Add a new customer')).toBeInTheDocument();
  });

  it('falls back to generic help content for an unknown path', () => {
    renderHelpPanel(<HelpPanel currentPath="/some/unmapped/route" onClose={vi.fn()} />);
    expect(screen.getByText('Help — Help')).toBeInTheDocument();
    expect(screen.getByText('Navigate to a module')).toBeInTheDocument();
  });

  it('renders a real mailto link for support instead of a placeholder', () => {
    renderHelpPanel(<HelpPanel currentPath="/dashboard" onClose={vi.fn()} />);
    const link = screen.getByRole('link', { name: /Contact support/ });
    expect(link).toHaveAttribute('href', 'mailto:nexoraatech.seo@gmail.com');
  });

  it('renders a report-an-issue mailto link, distinct from contact support', () => {
    renderHelpPanel(<HelpPanel currentPath="/dashboard" onClose={vi.fn()} />);
    const link = screen.getByRole('link', { name: /Report an issue/ });
    expect(link.getAttribute('href')).toMatch(/^mailto:nexoraatech\.seo@gmail\.com\?subject=/);
  });

  it('exposes dialog semantics', () => {
    renderHelpPanel(<HelpPanel currentPath="/dashboard" onClose={vi.fn()} />);
    const dialog = screen.getByRole('dialog', { name: 'Help — Dashboard' });
    expect(dialog).toHaveAttribute('aria-modal', 'true');
  });

  it('calls onClose when the close button is clicked', () => {
    const onClose = vi.fn();
    renderHelpPanel(<HelpPanel currentPath="/dashboard" onClose={onClose} />);
    fireEvent.click(screen.getByRole('button', { name: 'Close help panel' }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('calls onClose when Escape is pressed', () => {
    const onClose = vi.fn();
    renderHelpPanel(<HelpPanel currentPath="/dashboard" onClose={onClose} />);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('traps focus on the close button as the only focusable element until a task is expanded', () => {
    renderHelpPanel(<HelpPanel currentPath="/dashboard" onClose={vi.fn()} />);
    expect(screen.getByRole('button', { name: 'Close help panel' })).toHaveFocus();
  });

  it('has no axe accessibility violations', async () => {
    const { container } = renderHelpPanel(<HelpPanel currentPath="/customers" onClose={vi.fn()} />);
    const violations = await runAxe(container);
    expect(violations, formatViolations(violations)).toHaveLength(0);
  });

  it('shows the app version and environment', () => {
    renderHelpPanel(<HelpPanel currentPath="/dashboard" onClose={vi.fn()} />);
    expect(screen.getByText(/NEXORAA ERP v\d+\.\d+\.\d+/)).toBeInTheDocument();
  });

  it('opens the keyboard shortcuts modal from the footer button', () => {
    renderHelpPanel(<HelpPanel currentPath="/dashboard" onClose={vi.fn()} />);
    expect(screen.queryByRole('dialog', { name: 'Keyboard shortcuts' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Keyboard shortcuts' }));
    expect(screen.getByRole('dialog', { name: 'Keyboard shortcuts' })).toBeInTheDocument();
  });

  it("opens the what's new modal from the footer button", () => {
    renderHelpPanel(<HelpPanel currentPath="/dashboard" onClose={vi.fn()} />);
    expect(screen.queryByRole('dialog', { name: "What's new" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /What.s new/ }));
    expect(screen.getByRole('dialog', { name: "What's new" })).toBeInTheDocument();
  });

  describe('search', () => {
    it('shows results from other routes when searching, hiding the current-route view', () => {
      renderHelpPanel(<HelpPanel currentPath="/dashboard" onClose={vi.fn()} />);
      fireEvent.change(screen.getByLabelText('Search help'), { target: { value: 'GSTIN' } });
      expect(screen.getByText('Customers')).toBeInTheDocument();
      expect(screen.getByText('Organization Settings')).toBeInTheDocument();
      expect(screen.queryByText('Top tasks on this screen')).not.toBeInTheDocument();
    });

    it('shows a no-results message for a query matching nothing', () => {
      renderHelpPanel(<HelpPanel currentPath="/dashboard" onClose={vi.fn()} />);
      fireEvent.change(screen.getByLabelText('Search help'), {
        target: { value: 'zzznotarealtopic' },
      });
      expect(screen.getByText(/No help topics match/)).toBeInTheDocument();
    });

    it('returns to the normal per-route view when the search is cleared', () => {
      renderHelpPanel(<HelpPanel currentPath="/dashboard" onClose={vi.fn()} />);
      const input = screen.getByLabelText('Search help');
      fireEvent.change(input, { target: { value: 'GSTIN' } });
      fireEvent.change(input, { target: { value: '' } });
      expect(screen.getByText('Top tasks on this screen')).toBeInTheDocument();
    });
  });

  describe('role-based diagnostics link', () => {
    it('hides System diagnostics for a user without PERFORMANCE_VIEW', () => {
      useAuthStore.setState({
        user: {
          id: 1,
          tenantId: 1,
          email: 'a@test.com',
          firstName: 'A',
          lastName: 'B',
          roles: [],
          branchIds: [],
          permissions: [],
        },
        accessToken: 'tok',
      });
      renderHelpPanel(<HelpPanel currentPath="/dashboard" onClose={vi.fn()} />);
      expect(screen.queryByText('System diagnostics')).not.toBeInTheDocument();
    });

    it('shows System diagnostics for a user with PERFORMANCE_VIEW', () => {
      useAuthStore.setState({
        user: {
          id: 1,
          tenantId: 1,
          email: 'a@test.com',
          firstName: 'A',
          lastName: 'B',
          roles: [],
          branchIds: [],
          permissions: ['PERFORMANCE_VIEW'],
        },
        accessToken: 'tok',
      });
      renderHelpPanel(<HelpPanel currentPath="/dashboard" onClose={vi.fn()} />);
      const link = screen.getByRole('link', { name: /System diagnostics/ });
      expect(link).toHaveAttribute('href', '/admin/distributed/performance');
    });
  });
});
