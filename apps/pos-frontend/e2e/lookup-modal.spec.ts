// POS search-first redesign, Phase 3 — covers the full-screen item lookup modal: opening via
// F3, browsing by filter with no typed query, and keyboard-only selection. Same mocked-API
// tier/conventions as checkout-smoke.spec.ts (see that file's header comment for why the
// login/mock helpers are duplicated here rather than shared).
import { test, expect, type Route, type Page } from '@playwright/test';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET,POST,PUT,PATCH,DELETE,OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type,Authorization',
};

function fakeJwt(payload: Record<string, unknown>): string {
  const b64 = (obj: unknown) => Buffer.from(JSON.stringify(obj)).toString('base64');
  return `${b64({ alg: 'RS256', typ: 'JWT' })}.${b64(payload)}.unsigned-test-signature`;
}

async function mockJson(route: Route, data: unknown, status = 200): Promise<void> {
  if (route.request().method() === 'OPTIONS') {
    await route.fulfill({ status: 204, headers: CORS_HEADERS });
    return;
  }
  await route.fulfill({ status, headers: CORS_HEADERS, json: { data } });
}

async function mockSearchJson(route: Route, body: unknown): Promise<void> {
  if (route.request().method() === 'OPTIONS') {
    await route.fulfill({ status: 204, headers: CORS_HEADERS });
    return;
  }
  await route.fulfill({ status: 200, headers: CORS_HEADERS, json: body });
}

async function seedDeviceBranch(page: Page): Promise<void> {
  await page.addInitScript(() => {
    localStorage.setItem('pos_branch_id', '1');
    localStorage.setItem('pos_warehouse_id', '1');
  });
}

async function login(page: Page): Promise<void> {
  const accessToken = fakeJwt({
    sub: '1',
    tenantId: 1,
    branchIds: [1],
    roles: ['CASHIER'],
    permissions: ['POS_ACCESS'],
  });

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
  await page.route('**/pos/quick-items', (route) => mockJson(route, []));
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
  await page.getByLabel('Password').fill('correct-horse-battery-staple');
  await page.getByRole('button', { name: /sign in/i }).click();
  await page.waitForURL('http://localhost:5174/');
}

const CATEGORY_RESULT = {
  itemId: 501,
  name: 'Cotton Saree Blue',
  sku: 'SKU-5501',
  barcode: '8801234567890',
  alias: null,
  supplierCode: null,
  customCode: null,
  price: 950,
  gstRate: 5,
  stock: { qty: 12 },
  matchedOn: 'name',
};

test.describe('Full-screen item lookup modal', () => {
  test('F3 opens the modal; it browses by filter alone (no typed query) and Enter adds the highlighted item', async ({
    page,
  }) => {
    await seedDeviceBranch(page);
    await login(page);

    await page.route('**/pos/lookup-filters', (route) =>
      mockJson(route, {
        categories: [{ id: 10, name: 'Sarees' }],
        brands: [{ id: 20, name: 'Generic' }],
        priceLists: [{ id: 30, name: 'Retail' }],
        warehouses: [{ id: 1, name: 'Main Warehouse' }],
      })
    );
    let lastSearchUrl: URL | null = null;
    await page.route('**/pos/items/search**', (route) => {
      lastSearchUrl = new URL(route.request().url());
      return mockSearchJson(route, { data: [CATEGORY_RESULT], nextCursor: null, tookMs: 3 });
    });

    // Wait for the app to actually be interactive (the omnibox autofocuses on mount) before
    // sending a global key — otherwise this races React's effects attaching the F3 listener.
    await expect(page.getByRole('combobox')).toBeFocused();
    await page.keyboard.press('F3');
    await expect(page.getByRole('heading', { name: 'Item Lookup' })).toBeVisible();

    await page.getByLabel('Category').selectOption('10');

    const option = page.getByRole('option', { name: /Cotton Saree Blue/i });
    await expect(option).toBeVisible();

    // Filtered by category alone — no typed query needed to browse.
    expect(lastSearchUrl?.searchParams.get('category')).toBe('10');
    expect(lastSearchUrl?.searchParams.get('q') ?? '').toBe('');

    // Move focus off the <select> (Enter on a focused native select is browser-handled, not a
    // page-level keydown a listbox can react to) before using Enter to add the highlighted
    // result — matches the real flow of picking a filter, then acting on the result list.
    await page.getByPlaceholder(/Search within these filters/).click();
    await page.keyboard.press('Enter');

    await expect(page.getByRole('heading', { name: 'Item Lookup' })).not.toBeVisible();
    await expect(page.getByText('Current Sale')).toBeVisible();
    await expect(page.getByText('Cotton Saree Blue')).toBeVisible();
  });

  test('Esc closes the modal and returns focus to the omnibox', async ({ page }) => {
    await seedDeviceBranch(page);
    await login(page);

    await page.route('**/pos/lookup-filters', (route) =>
      mockJson(route, { categories: [], brands: [], priceLists: [], warehouses: [] })
    );
    await page.route('**/pos/items/search**', (route) =>
      mockSearchJson(route, { data: [], nextCursor: null, tookMs: 2 })
    );

    // Wait for the app to actually be interactive (the omnibox autofocuses on mount) before
    // sending a global key — otherwise this races React's effects attaching the F3 listener.
    await expect(page.getByRole('combobox')).toBeFocused();
    await page.keyboard.press('F3');
    await expect(page.getByRole('heading', { name: 'Item Lookup' })).toBeVisible();

    await page.keyboard.press('Escape');

    await expect(page.getByRole('heading', { name: 'Item Lookup' })).not.toBeVisible();
    await expect(page.getByRole('combobox')).toBeFocused();
  });
});
