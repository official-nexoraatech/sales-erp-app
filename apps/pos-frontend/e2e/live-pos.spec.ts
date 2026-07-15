// REAL end-to-end test — no mocking. Runs against the actually-running dev stack (real
// auth-service, tenant-service, inventory-service, sales-service, real Postgres), same
// "qa-e2e" tenant (tenant_id=2) as apps/web-frontend/e2e's live-*.spec.ts files. Covers the
// full real device flow: Login -> Branch/Warehouse select -> Open Shift -> add a real item to
// cart -> Charge (cash) -> Complete Sale -> receipt -> Close Shift -> Shift Summary.
// apps/pos-frontend/e2e/checkout-smoke.spec.ts already covers the checkout path with every
// HTTP call mocked; this spec is the real, unmocked counterpart in the same convention as
// apps/web-frontend/e2e/live-*.spec.ts.
import { test, expect, type Page } from '@playwright/test';

const OWNER = { email: 'owner@qa-e2e.local', password: 'QaE2eOwner@2026', tenantId: 2 };

async function realLogin(page: Page): Promise<void> {
  await page.goto('/login');
  await page.getByLabel('Tenant ID').fill(String(OWNER.tenantId));
  await page.getByLabel('Email').fill(OWNER.email);
  await page.getByLabel('Password').fill(OWNER.password);
  await page.getByRole('button', { name: /sign in/i }).click();
}

test.use({ storageState: undefined });

test('LIVE — full real POS workflow: Login, Branch/Warehouse, Open Shift, Checkout, Close Shift', async ({
  page,
}) => {
  test.setTimeout(90_000);

  await test.step('Login with a real account against the real auth-service', async () => {
    await realLogin(page);
    // Lands on branch/warehouse select, shift-open, or the till itself depending on what's
    // already persisted on this "device" (fresh browser context here, so branch select first).
    await page.waitForURL(/http:\/\/localhost:5174\//, { timeout: 15000 });
  });

  await test.step('Select branch/warehouse — tenant 2 has one branch but two real warehouses, so the picker renders', async () => {
    const warehouseHeading = page.getByRole('heading', { name: 'Select Warehouse' });
    const isWarehousePicker = await warehouseHeading
      .waitFor({ state: 'visible', timeout: 8000 })
      .then(() => true)
      .catch(() => false);
    if (isWarehousePicker) {
      const select = page.locator('#branch-select-warehouse');
      await select.selectOption({ label: 'Main Warehouse' });
    }
  });

  await test.step('Open the shift with a real opening cash float', async () => {
    const openShiftHeading = page.getByRole('heading', { name: 'Open Shift' });
    const needsShiftOpen = await openShiftHeading
      .waitFor({ state: 'visible', timeout: 8000 })
      .then(() => true)
      .catch(() => false);
    if (needsShiftOpen) {
      await page.getByLabel('Opening Cash').fill('2000');
      await page.getByRole('button', { name: 'Open Shift' }).click();
      await expect(page.getByText('Shift opened')).toBeVisible({ timeout: 10000 });
    }
  });

  let invoiceNumber = '';

  await test.step('Add a real item to the cart from the real quick-items list', async () => {
    await expect(page.getByPlaceholder('Scan barcode or type item name…')).toBeVisible({
      timeout: 10000,
    });
    // The real /pos/quick-items endpoint returns the tenant's first 20 ACTIVE items —
    // "Cotton Saree" (seeded/used by the rest of this session's live specs) is one of them.
    await page
      .getByRole('button', { name: /Cotton Saree/i })
      .first()
      .click();
    await expect(page.getByText('Current Sale')).toBeVisible();
  });

  await test.step('Charge with cash and complete the real sale', async () => {
    await page.getByRole('button', { name: 'Charge (F8)' }).click();
    await page.getByPlaceholder('Amount tendered').fill('5000');
    await page.getByRole('button', { name: 'Complete Sale' }).click();

    // Receipt overlay shows the real receipt number (POS-{tenantId}-{timestamp}) returned by
    // sales-service — a different numbering scheme from the regular sales-flow INV- prefix.
    const receiptNumber = page.locator('text=/POS-\\d+-\\d+/').first();
    await expect(receiptNumber).toBeVisible({ timeout: 15000 });
    invoiceNumber = (await receiptNumber.textContent())?.trim() ?? '';
    expect(invoiceNumber).toMatch(/POS-/);
    await expect(page.getByText('Paid via CASH')).toBeVisible();
    await expect(page.getByText('₹1050.00', { exact: true }).first()).toBeVisible();
    await page.getByRole('button', { name: 'New Sale' }).click();
  });

  await test.step('Close the shift and see a real shift summary', async () => {
    await page.getByRole('link', { name: 'End Shift' }).click();
    await expect(page.getByRole('heading', { name: 'End Shift' })).toBeVisible({ timeout: 10000 });
    await expect(page.getByText('Expected cash')).toBeVisible({ timeout: 10000 });

    await page.getByLabel('Closing Cash Counted').fill('7118');
    await page.getByRole('button', { name: 'Close Shift' }).click();
    await expect(page.getByText('Shift closed')).toBeVisible({ timeout: 10000 });
    await page.waitForURL(/\/shift\/summary/, { timeout: 10000 });
  });
});

async function goPastSetup(page: Page): Promise<void> {
  await realLogin(page);
  await page.waitForURL(/http:\/\/localhost:5174\//, { timeout: 15000 });

  const warehouseHeading = page.getByRole('heading', { name: 'Select Warehouse' });
  if (
    await warehouseHeading
      .waitFor({ state: 'visible', timeout: 8000 })
      .then(() => true)
      .catch(() => false)
  ) {
    await page.locator('#branch-select-warehouse').selectOption({ label: 'Main Warehouse' });
  }

  const openShiftHeading = page.getByRole('heading', { name: 'Open Shift' });
  if (
    await openShiftHeading
      .waitFor({ state: 'visible', timeout: 8000 })
      .then(() => true)
      .catch(() => false)
  ) {
    await page.getByLabel('Opening Cash').fill('1000');
    await page.getByRole('button', { name: 'Open Shift' }).click();
    await expect(page.getByText('Shift opened')).toBeVisible({ timeout: 10000 });
  }

  await expect(page.getByPlaceholder('Scan barcode or type item name…')).toBeVisible({
    timeout: 10000,
  });
}

test('LIVE — Hold a real sale, see it in Held Sales, resume it, and complete it', async ({
  page,
}) => {
  test.setTimeout(90_000);

  await test.step('Reach the till (login, branch/warehouse, shift already open or opened fresh)', async () => {
    await goPastSetup(page);
  });

  await test.step('Add an item and Hold the sale instead of charging', async () => {
    await page
      .getByRole('button', { name: /Cotton Saree/i })
      .first()
      .click();
    await expect(page.getByText('Current Sale')).toBeVisible();
    await page.getByRole('button', { name: 'Hold' }).click();
    // Cart clears once the sale is genuinely held.
    await expect(page.getByText('Cart is empty')).toBeVisible({ timeout: 10000 });
  });

  await test.step('The held sale shows up in Held Sales and can be resumed', async () => {
    await page.getByRole('button', { name: 'Held Sales' }).click();
    await expect(page.getByRole('heading', { name: 'Held Sales' })).toBeVisible();
    await expect(page.getByText('1 item')).toBeVisible({ timeout: 10000 });
    await page.getByRole('button', { name: 'Resume' }).first().click();
    // Resuming repopulates the cart with the real held line.
    await expect(page.getByText('Cotton Saree')).toBeVisible({ timeout: 10000 });
    await expect(page.getByText('Cart is empty')).not.toBeVisible();
  });

  await test.step('Complete the resumed sale for real', async () => {
    await page.getByRole('button', { name: 'Charge (F8)' }).click();
    await page.getByPlaceholder('Amount tendered').fill('5000');
    await page.getByRole('button', { name: 'Complete Sale' }).click();
    await expect(page.locator('text=/POS-\\d+-\\d+/').first()).toBeVisible({ timeout: 15000 });
  });
});
