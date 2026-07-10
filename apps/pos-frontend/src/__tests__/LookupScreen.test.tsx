/**
 * OFFLINE-09 (rescoped to pos-frontend) had no component test for its read-only counter
 * lookup screen — this covers its two verification-checklist requirements: cached data
 * displays correctly offline, and a staleness/offline indicator is shown alongside it.
 */
import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { db } from '../db.js';
import { setSyncMeta } from '../localStore.js';
import LookupScreen from '../LookupScreen.js';
import { runAxe, formatViolations } from '../testUtils/axe.js';

function renderLookup() {
  return render(<MemoryRouter><LookupScreen /></MemoryRouter>);
}

beforeEach(async () => {
  await db.catalogItems.clear();
  await db.customers.clear();
  await db.syncMeta.clear();
  await db.catalogItems.bulkPut([
    { id: 1, tenantId: 1, name: 'Amul Milk 1L', barcode: '111', hsnCode: '0401', gstRate: 5, cessRate: 0, mrp: 65, salePrice: 60, unitId: 1, status: 'ACTIVE', updatedAt: new Date().toISOString() },
  ]);
  await db.customers.bulkPut([
    { id: 1, tenantId: 1, branchId: 1, displayName: 'Walk-in Customer', phone: '9000000001', customerType: 'RETAIL', updatedAt: new Date().toISOString() },
  ]);
});

afterEach(() => {
  Object.defineProperty(navigator, 'onLine', { value: true, configurable: true });
});

describe('LookupScreen', () => {
  it('displays cached catalog items from Dexie on the Items tab', async () => {
    renderLookup();
    expect(await screen.findByText('Amul Milk 1L')).toBeInTheDocument();
    expect(screen.getByText('65')).toBeInTheDocument();
  });

  it('displays cached customers from Dexie on the Customers tab', async () => {
    renderLookup();
    fireEvent.click(screen.getByText('Customers'));
    expect(await screen.findByText('Walk-in Customer')).toBeInTheDocument();
  });

  it('shows a per-tab last-sync staleness indicator sourced from syncMeta', async () => {
    await setSyncMeta({ store: 'catalogItems', lastSyncedAt: Date.now() - 5 * 60_000 });
    renderLookup();
    expect(await screen.findByText('Last sync: 5m ago')).toBeInTheDocument();

    fireEvent.click(screen.getByText('Customers'));
    // No sync ever recorded for customers in this test's setup.
    expect(await screen.findByText('Last sync: never')).toBeInTheDocument();
  });

  it('shows an offline indicator, and cached data remains visible, when the browser is offline', async () => {
    Object.defineProperty(navigator, 'onLine', { value: false, configurable: true });
    renderLookup();
    expect(await screen.findByText('Offline')).toBeInTheDocument();
    // Cached data is unaffected by connectivity state — it's read from Dexie either way.
    expect(await screen.findByText('Amul Milk 1L')).toBeInTheDocument();
  });

  // ERP-PLANNING/07_ERP_IMPLEMENTATION_PLAN.md Phase 7.
  it('has no axe accessibility violations with data loaded', async () => {
    const { container } = renderLookup();
    await screen.findByText('Amul Milk 1L');

    const violations = await runAxe(container);
    expect(violations, formatViolations(violations)).toHaveLength(0);
  });
});
