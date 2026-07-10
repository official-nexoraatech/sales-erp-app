/**
 * OFFLINE-06 testing requirement #3 ("Sync status UI correctly reflects pending count,
 * last-sync time, and stuck-item count in various states") had no component-level test —
 * only the underlying offlineDb counters were tested. SyncStatusPanel and StockConflictModal
 * are exported from POSScreen.tsx (previously private) specifically so they're testable in
 * isolation, without mounting the full POSScreen (camera scanner, react-query, etc.).
 */
import 'fake-indexeddb/auto';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { SyncStatusPanel } from '../POSScreen.js';
import { runAxe, formatViolations } from '../testUtils/axe.js';

function renderPanel(overrides: Partial<Parameters<typeof SyncStatusPanel>[0]> = {}) {
  const onSyncNow = vi.fn();
  const onRetryStuck = vi.fn();
  const onShowConflicts = vi.fn();
  render(
    <SyncStatusPanel
      online
      pendingCount={0}
      stuckCount={0}
      conflictCount={0}
      lastSyncedAt={null}
      onSyncNow={onSyncNow}
      onRetryStuck={onRetryStuck}
      onShowConflicts={onShowConflicts}
      {...overrides}
    />
  );
  return { onSyncNow, onRetryStuck, onShowConflicts };
}

describe('SyncStatusPanel', () => {
  it('shows 0 pending / stuck / conflict state with no action buttons beyond connectivity', () => {
    renderPanel();
    expect(screen.getByText('Online')).toBeInTheDocument();
    expect(screen.getByText('Last sync: never')).toBeInTheDocument();
    expect(screen.queryByText(/Sync now/)).not.toBeInTheDocument();
    expect(screen.queryByText(/stock conflict/)).not.toBeInTheDocument();
    expect(screen.queryByText(/need attention/)).not.toBeInTheDocument();
  });

  it('shows a "Sync now" button only when online with pending items, and it fires onSyncNow', () => {
    const { onSyncNow } = renderPanel({ pendingCount: 2 });
    const button = screen.getByText('Sync now');
    fireEvent.click(button);
    expect(onSyncNow).toHaveBeenCalledTimes(1);
  });

  it('does not show "Sync now" when offline, even with pending items', () => {
    renderPanel({ online: false, pendingCount: 2 });
    expect(screen.queryByText('Sync now')).not.toBeInTheDocument();
  });

  it('shows the stuck-item count and fires onRetryStuck', () => {
    const { onRetryStuck } = renderPanel({ stuckCount: 3 });
    const button = screen.getByText(/3 items? need attention — Retry/);
    fireEvent.click(button);
    expect(onRetryStuck).toHaveBeenCalledTimes(1);
  });

  it('shows the stock-conflict count and fires onShowConflicts', () => {
    const { onShowConflicts } = renderPanel({ conflictCount: 2 });
    const button = screen.getByText(/2 stock conflicts — Resolve/);
    fireEvent.click(button);
    expect(onShowConflicts).toHaveBeenCalledTimes(1);
  });

  it('shows both stuck and conflict banners simultaneously when both are nonzero', () => {
    renderPanel({ stuckCount: 1, conflictCount: 1 });
    expect(screen.getByText(/1 item need attention — Retry/)).toBeInTheDocument();
    expect(screen.getByText(/1 stock conflict — Resolve/)).toBeInTheDocument();
  });

  // ERP-PLANNING/07_ERP_IMPLEMENTATION_PLAN.md Phase 7.
  it('has no axe accessibility violations with pending/stuck/conflict banners shown', async () => {
    const { container } = render(
      <SyncStatusPanel
        online={false}
        pendingCount={4}
        stuckCount={1}
        conflictCount={1}
        lastSyncedAt={Date.now() - 5 * 60_000}
        onSyncNow={vi.fn()}
        onRetryStuck={vi.fn()}
        onShowConflicts={vi.fn()}
      />
    );

    const violations = await runAxe(container);
    expect(violations, formatViolations(violations)).toHaveLength(0);
  });
});
