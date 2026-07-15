// REAL end-to-end test — no mocking. Runs against the actually-running dev stack
// (web-frontend on :5173, all backend services, real Postgres) using a freshly
// provisioned tenant ("qa-e2e", tenant_id=2) created via the real onboarding API
// specifically for this test run. Every action here hits real Fastify routes and
// writes real rows to the real database — this is intentionally the opposite of the
// mocked-API tier used by every other spec in this directory.
//
// One test, many steps, ONE login — exactly how a real user would work through the
// whole flow in a single session, and (practically) avoids re-tripping the real
// LOGIN_RATE_LIMIT_MAX/WINDOW_MS on every step the way 11 separate per-step logins did.
import { test, expect, type Page } from '@playwright/test';

const OWNER = { email: 'owner@qa-e2e.local', password: 'QaE2eOwner@2026', tenantId: 2 };

async function realLogin(
  page: Page,
  creds: { email: string; password: string; tenantId: number }
): Promise<void> {
  await page.goto('/login');
  await page.getByLabel('Tenant ID').fill(String(creds.tenantId));
  await page.getByLabel('Email').fill(creds.email);
  await page.getByLabel('Password', { exact: true }).fill(creds.password);
  await page.getByRole('button', { name: /sign in/i }).click();
  await page.waitForURL(/\/(dashboard|no-access)/, { timeout: 15000 });
}

// A synchronous `.count() > 0` right after `goto` races the list's own data fetch — it can
// read the DOM before React Query's request has even resolved, always reporting "not found"
// even when the row will render 100ms later. `waitFor` polls with Playwright's real auto-wait
// semantics instead, so it's the correct way to do a "does this already exist" soft-check.
async function existsOnPage(page: Page, text: string): Promise<boolean> {
  return page
    .getByText(text, { exact: true })
    .first()
    .waitFor({ state: 'visible', timeout: 8000 })
    .then(() => true)
    .catch(() => false);
}

test.use({ storageState: undefined });

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('erp_onboarding_dismissed', 'true'));
});

test('LIVE — full real Order-to-Cash workflow: Owner onboarding through Quotation, Invoice, Payment, and Journal', async ({
  page,
}) => {
  test.setTimeout(150_000);
  let quotationUrl = '';
  // Unique per run — invoiceNumber has a real uniqueness constraint, and re-running this spec
  // against a persistent dev DB means a fixed literal collides with a prior run's confirmed row.
  const invoiceNumber = `INV-QA-${Date.now()}`;

  await test.step('Login', async () => {
    await realLogin(page, OWNER);
    await expect(page).toHaveURL(/\/dashboard/);
  });

  // Re-running this spec against a persistent dev DB (not reset between runs) must not fail
  // just because a prior run's data is still there — a real user re-visiting these pages
  // would see the same "already exists" state. Each master-data step checks the list first
  // and only creates when genuinely absent.
  await test.step('Create a warehouse', async () => {
    await page.goto('/settings/warehouses');
    if (await existsOnPage(page, 'Main Warehouse')) return;
    await page.getByRole('button', { name: '+ New Warehouse' }).click();
    const dialog = page.getByRole('dialog', { name: 'New Warehouse' });
    await dialog.getByRole('textbox', { name: 'Name' }).fill('Main Warehouse');
    await dialog.getByRole('textbox', { name: 'Code' }).fill('WH-MAIN');
    await dialog.getByRole('combobox', { name: 'Branch' }).selectOption({ label: 'Head Office' });
    await dialog.getByRole('button', { name: 'Save' }).click();
    await expect(page.getByText('Main Warehouse')).toBeVisible({ timeout: 10000 });
  });

  await test.step('Create a unit of measure', async () => {
    await page.goto('/inventory/units');
    if (await existsOnPage(page, 'Metre')) return;
    await page.getByRole('button', { name: '+ New Unit' }).click();
    const dialog = page.getByRole('dialog', { name: 'New Unit' });
    await dialog.getByRole('textbox', { name: 'Name' }).fill('Metre');
    await dialog.getByRole('textbox', { name: 'Symbol' }).fill('m');
    await dialog.getByRole('button', { name: 'Save' }).click();
    await expect(page.getByText('Metre')).toBeVisible({ timeout: 10000 });
  });

  await test.step('Create an item', async () => {
    await page.goto('/inventory/items');
    if (await existsOnPage(page, 'Cotton Saree')) return;
    await page.goto('/inventory/items/new');
    await page.getByRole('textbox', { name: 'Item Name' }).fill('Cotton Saree');
    await page.getByRole('textbox', { name: 'HSN Code' }).fill('5407');
    await page.getByRole('combobox', { name: 'GST Rate' }).selectOption('5');
    await page
      .getByRole('combobox', { name: 'Unit of Measure' })
      .selectOption({ label: 'Metre (m)' });
    await page.getByRole('spinbutton', { name: 'Sale Price (₹)', exact: true }).fill('1000');
    await page.getByRole('button', { name: /^create item/i }).click();
    await page.waitForURL('**/inventory/items', { timeout: 10000 });
    await expect(page.getByText('Cotton Saree')).toBeVisible({ timeout: 10000 });
  });

  await test.step('Create a customer', async () => {
    await page.goto('/customers');
    if (await existsOnPage(page, 'Ramesh Textiles')) return;
    await page.goto('/customers/new');
    await page.getByRole('textbox', { name: 'Display Name' }).fill('Ramesh Textiles');
    await page.getByRole('combobox', { name: 'Customer Type' }).selectOption('RETAIL');
    await page.getByRole('textbox', { name: 'Phone' }).fill('9876543210');
    await page.getByRole('button', { name: /^create customer/i }).click();
    await page.waitForURL('**/customers', { timeout: 10000 });
    await expect(page.getByText('Ramesh Textiles')).toBeVisible({ timeout: 10000 });
  });

  await test.step('Create a quotation — the exact flow that was a dead link before this session', async () => {
    await page.goto('/sales/quotations/new');
    await expect(page.getByText('New Quotation', { exact: true })).toBeVisible();

    await page.getByRole('combobox', { name: 'Customer' }).fill('Ramesh');
    await page.getByRole('option', { name: /Ramesh Textiles/i }).click();
    await page.getByRole('combobox', { name: 'Branch' }).selectOption({ label: 'Head Office' });

    await page.locator('input[placeholder="Search items to add..."]').fill('Cotton');
    await page.getByRole('button', { name: /Cotton Saree/i }).click();
    await page.locator('input[type="number"][step="0.001"]').first().fill('5');

    await page.getByRole('button', { name: 'Save as Draft' }).click();
    await page.waitForURL(/\/sales\/quotations\/\d+/, { timeout: 10000 });
    await expect(page.getByRole('heading', { name: /^QT-/ })).toBeVisible({ timeout: 10000 });
    quotationUrl = page.url();
  });

  await test.step('Send, accept, and convert the quotation — the exact bug fixed this session', async () => {
    await page.getByRole('button', { name: 'Send' }).click();
    await expect(page.getByText('Quotation sent')).toBeVisible({ timeout: 10000 });

    await page.getByRole('button', { name: 'Accept' }).click();
    await expect(page.getByText('Quotation accepted')).toBeVisible({ timeout: 10000 });

    await page.getByRole('button', { name: 'Convert to Order' }).click();
    await page
      .getByRole('dialog', { name: 'Convert Quotation to Order' })
      .getByRole('button', { name: 'Convert to Order' })
      .click();
    await expect(page.getByText('Quotation converted')).toBeVisible({ timeout: 10000 });
  });

  await test.step('Receive opening stock for Cotton Saree — a fresh item has zero stock until this deliberate step, otherwise invoice confirm hits INSUFFICIENT_STOCK', async () => {
    await page.goto('/inventory/adjustments/new');
    await page
      .getByRole('combobox', { name: 'Warehouse' })
      .selectOption({ label: 'Main Warehouse' });
    await page.getByRole('textbox', { name: 'Search item' }).fill('Cotton');
    await page.getByRole('button', { name: /Cotton Saree/i }).click();
    const row = page.locator('tbody tr').filter({ hasText: 'Cotton Saree' });
    await row.locator('select').selectOption('IN');
    await row.locator('input[type="number"]').first().fill('100');
    await page.getByRole('button', { name: 'Create Adjustment' }).click();
    await page.waitForURL('**/inventory/adjustments', { timeout: 10000 });
    await expect(page.getByText('Adjustment created')).toBeVisible({ timeout: 10000 });

    await page.getByRole('button', { name: 'More actions' }).first().click();
    await page.getByRole('menuitem', { name: 'Submit' }).click();
    await expect(page.getByText('Adjustment submitted')).toBeVisible({ timeout: 10000 });

    await page.getByRole('button', { name: 'More actions' }).first().click();
    await page.getByRole('menuitem', { name: 'Approve' }).click();
    await expect(page.getByText('stock updated')).toBeVisible({ timeout: 10000 });
  });

  await test.step('Create and confirm an invoice from the converted quotation', async () => {
    // The stock-adjustment step above navigated away from the quotation detail page — the
    // "Create Invoice" button only exists there, so we must return to it first.
    await page.goto(quotationUrl);
    await page.getByRole('button', { name: 'Create Invoice' }).click();
    await page.waitForURL(/\/sales\/invoices\/new/);

    // InvoiceFormPage's quotation-prefill effect sets customer/lines/placeOfSupply but not
    // branchId — the user must still pick a branch even when arriving from a quotation.
    await page.getByRole('combobox', { name: 'Branch' }).selectOption({ label: 'Head Office' });
    await page
      .getByRole('combobox', { name: 'Warehouse' })
      .selectOption({ label: 'Main Warehouse' });
    await page.getByRole('button', { name: 'Save as Draft' }).click();
    await page.waitForURL(/\/sales\/invoices\/\d+/, { timeout: 10000 });

    await page.getByRole('button', { name: 'Confirm Invoice' }).click();
    const confirmDialog = page.getByRole('dialog', { name: 'Confirm Invoice' });
    await confirmDialog.getByRole('textbox', { name: 'Invoice Number' }).fill(invoiceNumber);
    await confirmDialog.getByRole('button', { name: 'Confirm Invoice' }).click();
    await expect(page.getByRole('dialog', { name: 'Confirm Invoice' })).toHaveCount(0, {
      timeout: 10000,
    });
  });

  await test.step('Seed the default Chart of Accounts — a fresh tenant has zero accounts until this deliberate, explicit step', async () => {
    await page.goto('/accounting/chart-of-accounts');
    // The seed button only renders inside the empty-state once the accounts query resolves
    // with zero rows — a synchronous `.count()` right after goto races that fetch and was
    // silently skipping seeding on every run (same class of bug as existsOnPage above).
    const seedButton = page.getByRole('button', { name: /seed default coa/i }).first();
    const hasSeedButton = await seedButton
      .waitFor({ state: 'visible', timeout: 8000 })
      .then(() => true)
      .catch(() => false);
    if (hasSeedButton) {
      await seedButton.click();
      await expect(page.getByText('Default accounts seeded')).toBeVisible({ timeout: 10000 });
    }
  });

  await test.step('Record a payment against the invoice — the exact bug fixed this session', async () => {
    await page.goto('/sales/invoices');
    // InvoicesPage's rows have no row-click navigation — the invoice number renders as a
    // plain <span>, and ERPDataGrid isn't given an onRowClick handler. The only way to reach
    // the detail page is "More actions" -> "View", same convention as stock adjustments.
    // Scope to the confirmed invoice specifically: earlier partial runs left stray unconfirmed
    // "Draft" rows in this list.
    const invoiceRow = page.locator('tbody tr').filter({ hasText: invoiceNumber });
    await invoiceRow.scrollIntoViewIfNeeded();
    await invoiceRow.getByRole('button', { name: 'More actions' }).click();
    const viewItem = page.getByRole('menuitem', { name: 'View' });
    // The dropdown's open state occasionally doesn't register on the first click once the
    // list has accumulated many rows from repeated runs — retry once rather than fail outright.
    const opened = await viewItem
      .waitFor({ state: 'visible', timeout: 3000 })
      .then(() => true)
      .catch(() => false);
    if (!opened) {
      await invoiceRow.getByRole('button', { name: 'More actions' }).click();
    }
    await viewItem.click();
    await page.waitForURL(/\/sales\/invoices\/\d+/);

    await page.getByRole('button', { name: 'Record Payment' }).click();
    await page.waitForURL(/\/sales\/payments/);

    const paymentDialog = page.getByRole('dialog', { name: 'Record Payment' });
    await expect(
      paymentDialog.getByRole('combobox', { name: 'Customer', exact: true })
    ).toHaveValue(/\d+/);
    const amountValue = await paymentDialog
      .getByRole('spinbutton', { name: 'Amount', exact: true })
      .inputValue();
    expect(Number(amountValue)).toBeGreaterThan(0);

    await paymentDialog.getByRole('button', { name: 'Record Payment' }).click();
    await expect(page.getByText(/payment recorded/i)).toBeVisible({ timeout: 10000 });
    await page.waitForURL(/\/sales\/invoices\/\d+/, { timeout: 10000 });
  });

  await test.step('Post a manual journal — the exact bug fixed this session', async () => {
    await page.goto('/accounting/journals/new');
    await expect(page.getByText('New Manual Journal', { exact: true })).toBeVisible();

    await page
      .getByRole('textbox', { name: 'Description' })
      .fill('QA E2E manual journal — opening cash adjustment');

    const rows = page.locator('tbody tr');
    const rowCount = await rows.count();
    expect(rowCount).toBeGreaterThanOrEqual(2);

    // Each row has two <select>s (Account, then Cost Center) — .first() picks Account.
    // Each row has two <select>s (Account, then Cost Center) — .first() picks Account.
    await rows.nth(0).locator('select').first().selectOption({ index: 1 });
    await rows.nth(0).locator('input[type="number"]').nth(0).fill('500');
    await rows.nth(1).locator('select').first().selectOption({ index: 2 });
    await rows.nth(1).locator('input[type="number"]').nth(1).fill('500');

    await expect(page.getByText('Balanced', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Post Journal' }).click();
    await expect(page.getByText('Journal posted')).toBeVisible({ timeout: 10000 });
    await page.waitForURL(/\/accounting\/journals\/.+/, { timeout: 10000 });
  });
});
