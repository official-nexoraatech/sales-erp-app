import { describe, it, expect, beforeEach, vi } from 'vitest';
import { useUIStore } from '../ui.store.js';

describe('useUIStore cross-tab sync', () => {
  beforeEach(() => {
    localStorage.clear();
    useUIStore.setState({ sidebarCollapsed: false, density: 'comfortable', recentPages: [] });
  });

  it('picks up a density change written by another tab via the storage event', async () => {
    // Simulate another tab's persist middleware writing the shared key.
    localStorage.setItem(
      'nexoraa-ui',
      JSON.stringify({
        state: { sidebarCollapsed: false, density: 'compact', recentPages: [] },
        version: 0,
      })
    );

    window.dispatchEvent(
      new StorageEvent('storage', {
        key: 'nexoraa-ui',
        newValue: localStorage.getItem('nexoraa-ui'),
      })
    );
    // persist.rehydrate() reads storage asynchronously even though localStorage itself is sync.
    await vi.waitFor(() => expect(useUIStore.getState().density).toBe('compact'));
  });

  it('ignores storage events for unrelated keys', () => {
    window.dispatchEvent(new StorageEvent('storage', { key: 'erp-theme', newValue: 'dark' }));
    expect(useUIStore.getState().density).toBe('comfortable');
  });
});
