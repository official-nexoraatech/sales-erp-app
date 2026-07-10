/**
 * OFFLINE-10 — component-level coverage for the shared online/offline + last-sync
 * indicator (ConnectivityStatus.tsx), used by both POSScreen's SyncStatusPanel and
 * LookupScreen. Previously only exercised indirectly (or not at all); this was a real
 * gap since OFFLINE-06's testing requirement #3 ("sync status UI correctly reflects
 * pending count...") had no component-level assertion, only logic-level offlineDb tests.
 */
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ConnectivityDot, formatLastSync } from '../ConnectivityStatus.js';

describe('ConnectivityDot', () => {
  it('shows Offline (red) when not online, regardless of pending count', () => {
    render(<ConnectivityDot online={false} pendingCount={3} />);
    expect(screen.getByText('Offline')).toBeInTheDocument();
  });

  it('shows "N pending sync" (yellow) when online with a nonzero pending count', () => {
    render(<ConnectivityDot online pendingCount={4} />);
    expect(screen.getByText('4 pending sync')).toBeInTheDocument();
  });

  it('shows Online (green) when online with nothing pending', () => {
    render(<ConnectivityDot online pendingCount={0} />);
    expect(screen.getByText('Online')).toBeInTheDocument();
  });
});

describe('formatLastSync', () => {
  it('returns "never" for null', () => {
    expect(formatLastSync(null)).toBe('never');
  });

  it('returns "just now" for a timestamp under a minute old', () => {
    expect(formatLastSync(Date.now() - 5_000)).toBe('just now');
  });

  it('returns minutes-ago for a timestamp under an hour old', () => {
    expect(formatLastSync(Date.now() - 5 * 60_000)).toBe('5m ago');
  });

  it('returns hours-ago for a timestamp under a day old', () => {
    expect(formatLastSync(Date.now() - 3 * 60 * 60_000)).toBe('3h ago');
  });

  it('returns a locale date string for a timestamp over a day old', () => {
    const ts = Date.now() - 3 * 24 * 60 * 60_000;
    expect(formatLastSync(ts)).toBe(new Date(ts).toLocaleDateString());
  });
});
