// PG-054 — pos-frontend's first-ever E2E spec. Covers the single most business-critical
// POS path (quick-sale checkout: add item, charge, complete sale) against the real Vite
// dev server with every HTTP call mocked at the boundary (page.route) — mirrors
// apps/web-frontend/e2e's mocked-API smoke tier exactly, including its CORS-preflight and
// {data: ...} response-wrapping gotchas (see that package's e2e/helpers.ts for the original
// write-up; duplicated here once rather than introducing a shared package for a single
// second consumer — see PG-054 in ERP-PLANNING/production-gap-prompts/015-Testing/ for why).
// Full-stack POS E2E (real offline/sync behaviour) is explicitly out of scope for this spec.
import { test, expect, type Route, type Page } from '@playwright/test';

function fakeJwt(payload: Record<string, unknown>): string {
  const b64 = (obj: unknown) => Buffer.from(JSON.stringify(obj)).toString('base64');
  return `${b64({ alg: 'RS256', typ: 'JWT' })}.${b64(payload)}.unsigned-test-signature`;
}

async function mockJson(route: Route, data: unknown, status = 200): Promise<void> {
  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET,POST,PUT,PATCH,DELETE,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type,Authorization',
  };
  if (route.request().method() === 'OPTIONS') {
    await route.fulfill({ status: 204, headers: corsHeaders });
    return;
  }
  await route.fulfill({ status, headers: corsHeaders, json: { data } });
}

const QUICK_ITEM = {
  id: 1,
  name: 'Test Item',
  salePrice: '100.00',
  gstRate: 18,
  barcode: 'ITEM001',
};

// branchStore/tokenStore are plain device-persisted localStorage (see branchStore.ts's own
// comment) — a real device only goes through /login and /branch-select once during setup.
// Seeding both here keeps this spec focused on checkout rather than re-driving that one-time
// device-provisioning flow, which belongs to its own future spec.
async function seedDeviceBranch(page: Page): Promise<void> {
  await page.addInitScript(() => {
    localStorage.setItem('pos_branch_id', '1');
    localStorage.setItem('pos_warehouse_id', '1');
  });
}

async function login(page: Page): Promise<void> {
  const accessToken = fakeJwt({ sub: '1', tenantId: 1, branchIds: [1], roles: ['CASHIER'] });

  await page.route('**/auth/login', (route) =>
    mockJson(route, { accessToken, refreshToken: 'fake-refresh-token' })
  );
  await page.route('**/pos/sessions/active', (route) =>
    mockJson(route, {
      id: 42,
      sessionNumber: 'SESS-0042',
      branchId: 1,
      warehouseId: 1,
      status: 'OPEN',
      openingCash: '1000.00',
      closingCash: null,
      expectedCash: null,
      cashVariance: null,
      totalSales: '0.00',
      totalTransactions: 0,
      openedAt: new Date().toISOString(),
      closedAt: null,
    })
  );
  await page.route('**/pos/quick-items', (route) => mockJson(route, [QUICK_ITEM]));
  // Reference-data sync (catalog/customers/price lists/tax rates) fires on every POSScreen
  // mount — empty pages keep it a no-op instead of failing and surfacing an error toast.
  for (const path of [
    '**/sync/items',
    '**/sync/customers',
    '**/sync/price-list-items',
    '**/sync/tax-rates',
  ]) {
    await page.route(path, (route) =>
      mockJson(route, { content: [], totalElements: 0, hasMore: false })
    );
  }

  await page.goto('/login');
  await page.getByLabel('Tenant ID').fill('1');
  await page.getByLabel('Email').fill('cashier@example.com');
  // POSInput bakes the required-field asterisk into the <label> text itself ("Password*"),
  // unlike web-frontend's equivalent field — match without exact so the substring still hits.
  await page.getByLabel('Password').fill('correct-horse-battery-staple');
  await page.getByRole('button', { name: /sign in/i }).click();
  await page.waitForURL('http://localhost:5174/');
}

test.describe('Quick-sale checkout smoke', () => {
  test('add item, charge, and complete a sale shows the receipt', async ({ page }) => {
    await seedDeviceBranch(page);
    await login(page);

    await page.route('**/pos/sales', (route) =>
      mockJson(route, { invoiceId: 501, invoiceNumber: 'INV-0501', grandTotal: 118 })
    );

    await expect(page.getByPlaceholder('Scan barcode or type item name…')).toBeVisible();
    await page.getByRole('button', { name: /Test Item/i }).click();

    await page.getByRole('button', { name: 'Charge (F8)' }).click();
    await page.getByPlaceholder('Amount tendered').fill('200');
    await expect(page.getByText('₹82.00')).toBeVisible();

    await page.getByRole('button', { name: 'Complete Sale' }).click();

    await expect(page.getByText('INV-0501')).toBeVisible();
    // "Paid via CASH" is a unique anchor into the receipt's totals block — the plain-text
    // "₹118.00" total otherwise also matches the (still-mounted, now-cleared-elsewhere)
    // cart line and the POS screen's own summary panel behind the overlay.
    const paidViaRow = page.getByText('Paid via CASH');
    await expect(paidViaRow).toBeVisible();
    const totalsBlock = paidViaRow.locator('..').locator('..');
    await expect(totalsBlock.getByText('₹118.00')).toBeVisible();
  });
});
