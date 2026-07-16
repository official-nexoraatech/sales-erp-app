import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { runAxe, formatViolations } from '../../../testUtils/axe.js';
import CampaignSettingsPage from '../CampaignSettingsPage.js';

const getCommunicationSettingsMock = vi.fn();
const listSenderIdentitiesMock = vi.fn();

vi.mock('../../../api/endpoints.js', () => ({
  crmApi: {
    getCommunicationSettings: (...args: unknown[]) => getCommunicationSettingsMock(...args),
    listSenderIdentities: (...args: unknown[]) => listSenderIdentitiesMock(...args),
  },
}));

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={['/crm/campaign-settings']}>
        <CampaignSettingsPage />
      </MemoryRouter>
    </QueryClientProvider>
  );
}

describe('CampaignSettingsPage', () => {
  beforeEach(() => {
    getCommunicationSettingsMock.mockReset();
    listSenderIdentitiesMock.mockReset();
  });

  it('renders all three settings sections with data loaded', async () => {
    getCommunicationSettingsMock.mockResolvedValue({
      approvalRequired: true,
      maxPerDayFrequencyCap: 3,
    });
    listSenderIdentitiesMock.mockResolvedValue({
      content: [
        {
          id: 1,
          channel: 'EMAIL',
          senderName: 'Style Hub',
          senderAddressOrNumber: 'promo@stylehub.example',
        },
      ],
    });

    renderPage();

    // "Style Hub" renders as part of a combined text node (" — Style Hub (promo@...)"), not
    // standalone — a regex matcher, not a plain string, is required for RTL's default exact
    // whole-node text matching to find it.
    expect(await screen.findByText(/Style Hub/)).toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: /require approval/i })).toBeChecked();
    expect(screen.getByRole('link', { name: /Organization → Integrations/i })).toHaveAttribute(
      'href',
      '/settings/integrations'
    );
  });

  it('has no axe accessibility violations with data loaded', async () => {
    getCommunicationSettingsMock.mockResolvedValue({
      approvalRequired: false,
      maxPerDayFrequencyCap: null,
    });
    listSenderIdentitiesMock.mockResolvedValue({ content: [] });

    const { container } = renderPage();
    await screen.findByRole('heading', { name: 'Sender Identity' });

    const violations = await runAxe(container);
    expect(violations, formatViolations(violations)).toHaveLength(0);
  });
});
