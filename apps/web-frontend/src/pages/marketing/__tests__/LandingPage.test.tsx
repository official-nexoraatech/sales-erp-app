import { render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { describe, it, expect, vi } from 'vitest';
import { runAxe, formatViolations } from '../../../testUtils/axe.js';
import LandingPage from '../LandingPage.js';

vi.mock('../../../api/endpoints.js', () => ({
  faqApi: {
    listPublic: vi.fn().mockResolvedValue({
      content: [
        { id: 1, category: 'Getting Started', question: 'Test question?', answer: 'Test answer.' },
      ],
    }),
  },
}));

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={['/']}>
        <LandingPage />
      </MemoryRouter>
    </QueryClientProvider>
  );
}

describe('LandingPage', () => {
  it('renders the hero headline and primary CTAs', () => {
    renderPage();
    expect(
      screen.getByRole('heading', { level: 1, name: /run your whole business/i })
    ).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: /start free trial/i }).length).toBeGreaterThan(0);
  });

  it('renders every product module as a link to the Features page', () => {
    renderPage();
    // Appears in both the module grid and the footer's product links.
    const links = screen.getAllByRole('link', { name: /sales & invoicing/i });
    expect(links.length).toBeGreaterThan(0);
    for (const link of links) {
      expect(link).toHaveAttribute('href', '/features#sales');
    }
  });

  it('labels illustrative testimonials/logos as non-real', () => {
    renderPage();
    expect(screen.getAllByText(/illustrative example/i).length).toBeGreaterThan(0);
  });

  it('labels compliance badges as in-progress, not certified', () => {
    renderPage();
    expect(screen.getAllByText(/in progress/i).length).toBeGreaterThan(0);
    expect(screen.queryByText(/iso 27001 certified/i)).not.toBeInTheDocument();
  });

  it('has no axe violations', async () => {
    const { container } = renderPage();
    await waitFor(() => expect(screen.getByText(/test question/i)).toBeInTheDocument());
    const violations = await runAxe(container);
    expect(violations, formatViolations(violations)).toHaveLength(0);
  });
});
