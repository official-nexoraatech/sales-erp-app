import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { runAxe, formatViolations } from '../../../testUtils/axe.js';
import CampaignsPage from '../CampaignsPage.js';
import { useAuthStore } from '../../../store/auth.store.js';

const listCampaignsMock = vi.fn();

vi.mock('../../../api/endpoints.js', () => ({
  crmApi: {
    listCampaigns: (...args: unknown[]) => listCampaignsMock(...args),
  },
}));

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={['/crm/campaigns']}>
        <CampaignsPage />
      </MemoryRouter>
    </QueryClientProvider>
  );
}

const SAMPLE_CAMPAIGNS = {
  content: [
    {
      id: 1,
      name: 'Diwali Sale 2026',
      channel: 'WHATSAPP',
      status: 'SENT',
      approvalStatus: 'APPROVED',
      totalRecipients: 120,
      sentCount: 118,
      deliveredCount: 110,
      failedCount: 2,
      sentAt: '2026-07-01T10:00:00Z',
      createdAt: '2026-06-30T10:00:00Z',
    },
    {
      id: 2,
      name: 'Winter Collection Launch',
      channel: 'EMAIL',
      status: 'DRAFT',
      approvalStatus: null,
      createdAt: '2026-07-10T10:00:00Z',
    },
  ],
  totalElements: 2,
};

describe('CampaignsPage', () => {
  beforeEach(() => {
    listCampaignsMock.mockReset();
    useAuthStore.setState({ user: null });
  });

  it('renders campaign rows with status/channel/approval badges from a mocked API response', async () => {
    listCampaignsMock.mockResolvedValue(SAMPLE_CAMPAIGNS);
    renderPage();

    expect(await screen.findByText('Diwali Sale 2026')).toBeInTheDocument();
    expect(screen.getByText('Winter Collection Launch')).toBeInTheDocument();
    expect(screen.getByText('APPROVED')).toBeInTheDocument();
  });

  it('shows the View button on every row regardless of status, but Edit/Submit only on DRAFT/SCHEDULED', async () => {
    useAuthStore.setState({
      user: {
        id: 1,
        tenantId: 1,
        email: 't@test.com',
        firstName: 'T',
        lastName: 'U',
        roles: ['ADMIN'],
        branchIds: [],
        permissions: ['CRM_CAMPAIGN_CREATE', 'CRM_CAMPAIGN_SEND'],
      },
    });
    listCampaignsMock.mockResolvedValue(SAMPLE_CAMPAIGNS);
    renderPage();

    await screen.findByText('Diwali Sale 2026');
    const viewButtons = screen.getAllByRole('button', { name: 'View' });
    expect(viewButtons).toHaveLength(2);
    // Only the DRAFT campaign ("Winter Collection Launch") gets Edit/Submit for Approval.
    expect(screen.getAllByRole('button', { name: 'Edit' })).toHaveLength(1);
    expect(screen.getAllByRole('button', { name: 'Submit for Approval' })).toHaveLength(1);
  });

  // ERP-PLANNING/Campaign-Planning/24_PLAYWRIGHT_TEST_PLAN.md's non-functional-checks section:
  // axe-core assertions embedded in each surface's own test, not a separate afterthought suite.
  it('has no axe accessibility violations with data loaded', async () => {
    listCampaignsMock.mockResolvedValue(SAMPLE_CAMPAIGNS);
    const { container } = renderPage();
    await screen.findByText('Diwali Sale 2026');

    const violations = await runAxe(container);
    expect(violations, formatViolations(violations)).toHaveLength(0);
  });

  it('has no axe accessibility violations on the empty state', async () => {
    listCampaignsMock.mockResolvedValue({ content: [], totalElements: 0 });
    const { container } = renderPage();
    await screen.findByText('No campaigns found');

    const violations = await runAxe(container);
    expect(violations, formatViolations(violations)).toHaveLength(0);
  });
});
