// POS search-first redesign, Phase 1 — covers the new omnibox (GET /pos/items/search):
// typed fuzzy search producing a virtualized dropdown, keyboard-only selection (Arrow +
// Enter), and Escape closing the dropdown without losing the typed text. Same mocked-API
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

test.describe('Omnibox fuzzy search', () => {
  test('typing a fuzzy query shows a virtualized dropdown, and Enter adds the highlighted result to the cart', async ({
    page,
  }) => {
    await seedDeviceBranch(page);
    await login(page);

    await page.route('**/pos/items/search**', (route) =>
      mockSearchJson(route, { data: [SEARCH_RESULT], nextCursor: null, tookMs: 4 })
    );

    const omnibox = page.getByRole('combobox');
    await omnibox.fill('popln');

    const option = page.getByRole('option', { name: /Cotton Poplin 2m/i });
    await expect(option).toBeVisible();
    await expect(page.getByText('SKU-1042')).toBeVisible();
    await expect(page.getByText('₹180.00')).toBeVisible();

    // Keyboard-only: Arrow Down keeps the single result highlighted, Enter adds it — no mouse.
    await omnibox.press('ArrowDown');
    await omnibox.press('Enter');

    await expect(page.getByText('Current Sale')).toBeVisible();
    await expect(page.getByText('Cotton Poplin 2m')).toBeVisible();
    // Omnibox clears and the dropdown closes once the item is added.
    await expect(omnibox).toHaveValue('');
    await expect(option).not.toBeVisible();
  });

  test('Escape closes the dropdown without clearing the typed query', async ({ page }) => {
    await seedDeviceBranch(page);
    await login(page);

    await page.route('**/pos/items/search**', (route) =>
      mockSearchJson(route, { data: [SEARCH_RESULT], nextCursor: null, tookMs: 4 })
    );

    const omnibox = page.getByRole('combobox');
    await omnibox.fill('popln');

    const option = page.getByRole('option', { name: /Cotton Poplin 2m/i });
    await expect(option).toBeVisible();

    await omnibox.press('Escape');

    await expect(option).not.toBeVisible();
    await expect(omnibox).toHaveValue('popln');
  });
});
