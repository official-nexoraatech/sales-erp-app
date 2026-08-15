import { render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import MyApprovalsPage from '../MyApprovalsPage.js';

// jsdom doesn't implement scrollIntoView (it requires real layout) — MyApprovalsPage calls it
// when auto-selecting a deep-linked item, which throws in this test environment otherwise.
Element.prototype.scrollIntoView = vi.fn();

const pendingMock = vi.fn();
const statusMock = vi.fn();

vi.mock('../../api/endpoints.js', () => ({
  approvalApi: {
    pending: (...args: unknown[]) => pendingMock(...args),
    status: (...args: unknown[]) => statusMock(...args),
    approve: vi.fn(),
    reject: vi.fn(),
  },
}));

vi.mock('../../context/ConfirmContext.js', () => ({
  useConfirm: () => vi.fn().mockResolvedValue(true),
}));

function renderPage(initialEntry: string) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[initialEntry]}>
        <MyApprovalsPage />
      </MemoryRouter>
    </QueryClientProvider>
  );
}

const ITEMS = [
  {
    approvalId: 1,
    instanceId: 100,
    nodeId: 'node_1',
    nodeName: 'Purchase Manager Approval',
    entityType: 'PurchaseOrder',
    entityId: 55,
    triggeredByUserId: 2,
    createdAt: new Date().toISOString(),
  },
  {
    approvalId: 2,
    instanceId: 200,
    nodeId: 'node_1',
    nodeName: 'Sales Manager Approval',
    entityType: 'Invoice',
    entityId: 9,
    triggeredByUserId: 3,
    createdAt: new Date().toISOString(),
  },
];

describe('MyApprovalsPage — Notification Center deep-link', () => {
  beforeEach(() => {
    pendingMock.mockReset().mockResolvedValue({ content: ITEMS, totalElements: ITEMS.length });
    statusMock.mockReset().mockResolvedValue({
      instanceId: 100,
      status: 'PENDING',
      currentNodeId: 'node_1',
      pendingApprovals: [],
      history: [],
    });
  });

  it('with no ?instanceId=, nothing is auto-selected', async () => {
    renderPage('/my-approvals');
    await waitFor(() => expect(screen.getByText('Purchase Manager Approval')).toBeInTheDocument());
    expect(screen.getByText('Select an item to review and decide')).toBeInTheDocument();
  });

  it('?instanceId= matching a pending item auto-selects it and fetches its status', async () => {
    renderPage('/my-approvals?instanceId=200');

    await waitFor(() => expect(statusMock).toHaveBeenCalledWith(200));
    // The details panel heading switches to the selected item's entity once selected — queried
    // as a heading specifically, since "Invoice #9" also appears in the list row's own text.
    await waitFor(() =>
      expect(screen.getByRole('heading', { name: 'Invoice #9' })).toBeInTheDocument()
    );
  });

  it('?instanceId= with no matching pending item leaves the list unselected (no crash)', async () => {
    renderPage('/my-approvals?instanceId=999');
    await waitFor(() => expect(screen.getByText('Purchase Manager Approval')).toBeInTheDocument());
    expect(screen.getByText('Select an item to review and decide')).toBeInTheDocument();
    expect(statusMock).not.toHaveBeenCalled();
  });
});
