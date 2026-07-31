// POS dashboard redesign — the omnibox no longer shows a live autocomplete dropdown while
// typing. Enter now runs a single search: a unique match is added directly, no match falls back
// to the barcode/quick-item resolution path, and multiple matches point the cashier at Browse
// Catalog instead of guessing. Same mocked-API tier/conventions as checkout-smoke.spec.ts (see
// that file's header comment for why the login/mock helpers are duplicated here rather than
// shared).
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

// Wraps the given payload as `{ data: payload }` — the envelope every other POS/sales-service
// route in this app uses.
async function mockJson(route: Route, data: unknown, status = 200): Promise<void> {
  if (route.request().method() === 'OPTIONS') {
    await route.fulfill({ status: 204, headers: CORS_HEADERS });
    return;
  }
  await route.fulfill({ status, headers: CORS_HEADERS, json: { data } });
}

// GET /pos/items/search's response has sibling top-level fields (nextCursor, tookMs)
// alongside `data`, so it can't reuse mockJson's single-field envelope — fulfills the exact
// body verbatim instead.
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
  // hasPermission() (auth.ts) reads the JWT's `permissions` claim, not `roles` — see the
  // same fix in checkout-smoke.spec.ts's login() helper.
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

const SEARCH_RESULT = {
  itemId: 99,
  name: 'Cotton Poplin 2m',
  sku: 'SKU-1042',
  barcode: '8901234567890',
  alias: null,
  supplierCode: null,
  customCode: null,
  price: 180,
  gstRate: 5,
  stock: { qty: 42 },
  matchedOn: 'name',
};

test.describe('Omnibox search (no live suggestions)', () => {
  test('typing a query shows no dropdown until Enter is pressed', async ({ page }) => {
    await seedDeviceBranch(page);
    await login(page);

    await page.route('**/pos/items/search**', (route) =>
      mockSearchJson(route, { data: [SEARCH_RESULT], nextCursor: null, tookMs: 4 })
    );

    const omnibox = page.getByPlaceholder(/Scan barcode, or type name/i);
    await omnibox.fill('popln');

    // No live dropdown/listbox appears while typing.
    await expect(page.getByRole('listbox')).toHaveCount(0);
    await expect(page.getByText('Cotton Poplin 2m')).not.toBeVisible();
  });

  test('Enter with a unique match adds it straight to the cart', async ({ page }) => {
    await seedDeviceBranch(page);
    await login(page);

    await page.route('**/pos/items/search**', (route) =>
      mockSearchJson(route, { data: [SEARCH_RESULT], nextCursor: null, tookMs: 4 })
    );

    const omnibox = page.getByPlaceholder(/Scan barcode, or type name/i);
    await omnibox.fill('cotton poplin');
    await omnibox.press('Enter');

    await expect(page.getByText('Current Sale')).toBeVisible();
    await expect(page.getByText('Cotton Poplin 2m')).toBeVisible();
    // Omnibox clears and refocuses once the item is added.
    await expect(omnibox).toHaveValue('');
    await expect(omnibox).toBeFocused();
  });

  test('Enter with multiple matches points the cashier at Browse Catalog instead of guessing', async ({
    page,
  }) => {
    await seedDeviceBranch(page);
    await login(page);

    await page.route('**/pos/items/search**', (route) =>
      mockSearchJson(route, {
        data: [SEARCH_RESULT, { ...SEARCH_RESULT, itemId: 100, name: 'Cotton Poplin 3m' }],
        nextCursor: null,
        tookMs: 4,
      })
    );

    const omnibox = page.getByPlaceholder(/Scan barcode, or type name/i);
    await omnibox.fill('cotton poplin');
    await omnibox.press('Enter');

    await expect(page.getByText(/use Browse Catalog \(F3\) to pick one/i)).toBeVisible();
    // Nothing was added to the cart on an ambiguous match.
    await expect(page.getByText('Cotton Poplin 2m')).not.toBeVisible();
  });
});
