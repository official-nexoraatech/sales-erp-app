// POS search-first redesign, Phase 2 — covers the new keyboard-first billing shortcuts added
// to POSScreen.tsx: F4 (hold), F5/F6/F7 (jump straight to a payment mode), Ctrl+Z (undo last
// line), and Ctrl+F (refocus the omnibox from anywhere). Same mocked-API tier/conventions as
// checkout-smoke.spec.ts (see that file's header comment for why the login/mock helpers are
// duplicated here rather than shared).
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
  await page.route('**/pos/quick-items', (route) => mockJson(route, [QUICK_ITEM]));
  await page.route('**/pos/held-sales', (route) => mockJson(route, { id: 1 }, 201));
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

test.describe('Keyboard-first billing shortcuts', () => {
  test('F6 jumps straight to the payment panel with Card preselected', async ({ page }) => {
    await seedDeviceBranch(page);
    await login(page);

    await page.getByRole('button', { name: /Test Item/i }).click();
    await page.keyboard.press('F6');

    await expect(page.getByRole('button', { name: 'Complete Sale' })).toBeVisible();
    await expect(page.getByRole('button', { name: /^CARD$/ })).toHaveClass(/border-focus/);
    // Cash-only "Amount tendered" field must not show while Card is the active mode.
    await expect(page.getByPlaceholder('Amount tendered')).not.toBeVisible();
  });

  test('Ctrl+Z undoes the last item added, one unit at a time', async ({ page }) => {
    await seedDeviceBranch(page);
    await login(page);

    const itemButton = page.getByRole('button', { name: /Test Item/i });
    await itemButton.click();
    await itemButton.click();
    await expect(page.getByText('₹100.00 × 2')).toBeVisible();

    await page.keyboard.press('Control+z');
    await expect(page.getByText('₹100.00 × 1')).toBeVisible();

    await page.keyboard.press('Control+z');
    await expect(page.getByText('Cart is empty')).toBeVisible();
  });

  test('F4 holds the sale, clearing the cart', async ({ page }) => {
    await seedDeviceBranch(page);
    await login(page);

    await page.getByRole('button', { name: /Test Item/i }).click();
    await expect(page.getByText('Current Sale')).toBeVisible();

    await page.keyboard.press('F4');
    await expect(page.getByText('Cart is empty')).toBeVisible({ timeout: 10000 });
  });

  test('Ctrl+F refocuses the omnibox from anywhere on the screen', async ({ page }) => {
    await seedDeviceBranch(page);
    await login(page);

    const customerSearch = page.getByPlaceholder('Customer search (name or phone)…');
    await customerSearch.click();
    await expect(customerSearch).toBeFocused();

    await page.keyboard.press('Control+f');
    await expect(page.getByRole('combobox')).toBeFocused();
  });
});
