import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { TourProvider } from '../TourProvider.js';
import { TourOverlay } from '../TourOverlay.js';
import { useTour } from '../useTour.js';
import { useAuthStore } from '../../../store/auth.store.js';
import type * as EndpointsModule from '../../../api/endpoints.js';

// This is the gap the state-machine-only tests in TourProvider.test.tsx don't close: it mounts the
// *real* TourOverlay/TourSpotlight/TourTooltipCard component tree and drives it via real DOM clicks
// on real rendered nodes (role/text queries, not internal state), the same way live-dap-tour.spec.ts
// drives it in a real browser — just without needing a browser or the backend stack.
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

const FULL_PERMISSIONS = [
  'DASHBOARD_VIEW',
  'PO_VIEW',
  'GRN_CREATE',
  'ITEM_VIEW',
  'JOURNAL_VIEW',
  'GST_VIEW',
  'REPORT_VIEW',
];

function setUser(permissions: string[]) {
  useAuthStore.setState({
    user: {
      id: 1,
      tenantId: 1,
      email: 'a@test.com',
      firstName: 'A',
      lastName: 'B',
      roles: [],
      branchIds: [],
      permissions,
    },
    accessToken: 'tok',
  });
}

// Stands in for the real "+ Create GRN" button GRNsPage.tsx renders — same data-tour-id, so
// useTourAction's real capture-phase click listener has a real element to find and click.
function GrnTargetStub() {
  return <button data-tour-id="grn-create-button">+ Create GRN</button>;
}

function StartButton() {
  const { startTour } = useTour();
  return <button onClick={() => startTour('purchase-to-dashboard-workflow')}>start</button>;
}

function renderOverlay() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={['/dashboard']}>
        <TourProvider>
          <StartButton />
          <GrnTargetStub />
          <TourOverlay />
        </TourProvider>
      </MemoryRouter>
    </QueryClientProvider>
  );
}

describe('TourOverlay (real render, not just state-machine)', () => {
  beforeEach(() => {
    localStorage.clear();
    setUser(FULL_PERMISSIONS);
  });

  it('renders nothing when no tour is active', () => {
    renderOverlay();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it("renders a real dialog with the first step's actual content once started", () => {
    renderOverlay();
    fireEvent.click(screen.getByText('start'));

    const dialog = screen.getByRole('dialog');
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(screen.getByText('Step 1 of 8')).toBeInTheDocument();
    expect(screen.getByText('One purchase touches six modules')).toBeInTheDocument();
    expect(
      screen.getByText(/Nothing happens yet at this step — this is the map before the walk\./)
    ).toBeInTheDocument();
  });

  it("Next advances to the next step's real rendered content", () => {
    renderOverlay();
    fireEvent.click(screen.getByText('start'));
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));

    expect(screen.getByText('Step 2 of 8')).toBeInTheDocument();
    expect(screen.getByText('Step 1 — Purchase Order')).toBeInTheDocument();
    expect(screen.getByText('Business impact')).toBeInTheDocument();
    expect(screen.getByText('No stock quantity changes.')).toBeInTheDocument();
  });

  it("Back returns to the previous step's real rendered content", () => {
    renderOverlay();
    fireEvent.click(screen.getByText('start'));
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    fireEvent.click(screen.getByRole('button', { name: 'Back' }));

    expect(screen.getByText('Step 1 of 8')).toBeInTheDocument();
  });

  it('the GRN step is informational — Next is never disabled, no tour step forces a real click', () => {
    // Every tour step used to be able to gate Next on a real DOM click via `mode: 'interactive'`
    // (useTourAction still supports it), but no shipped tour content uses that anymore — a
    // guided tour is a passive walkthrough, and forcing a user to actually submit a real form
    // (create an invoice, record a payment, approve a return) just to read the next step was a
    // genuine UX bug, not a feature. This test locks in that regression.
    renderOverlay();
    fireEvent.click(screen.getByText('start'));
    fireEvent.click(screen.getByRole('button', { name: 'Next' })); // -> purchase-order
    fireEvent.click(screen.getByRole('button', { name: 'Next' })); // -> grn

    expect(screen.getByText('Step 3 of 8')).toBeInTheDocument();
    expect(screen.queryByText('Complete the action above to continue.')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Next' })).toBeEnabled();
  });

  it('the last step\'s advance button reads "Finish", and clicking it closes the overlay', () => {
    renderOverlay();
    fireEvent.click(screen.getByText('start')); // intro
    fireEvent.click(screen.getByRole('button', { name: 'Next' })); // purchase-order
    fireEvent.click(screen.getByRole('button', { name: 'Next' })); // grn
    fireEvent.click(screen.getByRole('button', { name: 'Next' })); // stock
    fireEvent.click(screen.getByRole('button', { name: 'Next' })); // accounting
    fireEvent.click(screen.getByRole('button', { name: 'Next' })); // gst
    fireEvent.click(screen.getByRole('button', { name: 'Next' })); // reports
    fireEvent.click(screen.getByRole('button', { name: 'Next' })); // outro — last step

    expect(screen.getByText('Step 8 of 8')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Finish' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Finish' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('the footer "Skip tour" text button closes the overlay', () => {
    renderOverlay();
    fireEvent.click(screen.getByText('start'));
    // Two "Skip tour" affordances share the same accessible name by design (header X icon,
    // footer text button) — the header X is first in DOM order, so index 1 is the footer one.
    fireEvent.click(screen.getAllByRole('button', { name: 'Skip tour' })[1]!);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('the header X "Skip tour" icon button also closes the overlay', () => {
    renderOverlay();
    fireEvent.click(screen.getByText('start'));
    fireEvent.click(screen.getAllByRole('button', { name: 'Skip tour' })[0]!);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it("Escape closes the overlay, matching this app's platform-wide overlay-close law", () => {
    renderOverlay();
    fireEvent.click(screen.getByText('start'));
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('renders a dim backdrop (not a spotlight ring) for a step with no target', () => {
    const { container } = renderOverlay();
    fireEvent.click(screen.getByText('start'));
    expect(container.querySelector('.bg-black\\/40')).toBeInTheDocument();
  });

  it('a step with fewer permissions renders correspondingly fewer total steps in the real DOM', () => {
    setUser(['DASHBOARD_VIEW', 'PO_VIEW', 'GRN_CREATE', 'ITEM_VIEW']);
    renderOverlay();
    fireEvent.click(screen.getByText('start'));
    expect(screen.getByText('Step 1 of 5')).toBeInTheDocument();
  });
});
