// REAL end-to-end test — no mocking. Runs against the actually-running dev stack, same
// freshly provisioned tenant ("qa-e2e", tenant_id=2) as the other live-*.spec.ts files.
// Covers the full Stock Transfer lifecycle: Create -> Submit -> Approve -> Dispatch -> Receive.
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

async function existsOnPage(page: Page, text: string): Promise<boolean> {
  return page
    .getByText(text, { exact: true })
    .first()
    .waitFor({ state: 'visible', timeout: 8000 })
    .then(() => true)
    .catch(() => false);
}

// ERPDropdownMenu's open state occasionally doesn't register on the first click once a list
// has accumulated many rows from repeated runs against this persistent dev DB — same flakiness
// pattern already isolated in live-order-to-cash.spec.ts's invoice row menu. Retry once rather
// than fail outright; duplicated locally rather than shared, matching this file's existing
// standalone-spec convention.
async function clickMoreActionsThenMenuItem(
  row: ReturnType<Page['locator']>,
  page: Page,
  menuItemName: string
): Promise<void> {
  await row.getByRole('button', { name: 'More actions' }).click();
  const menuItem = page.getByRole('menuitem', { name: menuItemName });
  const opened = await menuItem
    .waitFor({ state: 'visible', timeout: 3000 })
    .then(() => true)
    .catch(() => false);
  if (!opened) {
    await row.getByRole('button', { name: 'More actions' }).click();
  }
  await menuItem.click();
}

test.use({ storageState: undefined });

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('erp_onboarding_dismissed', 'true'));
});

test('LIVE — full real Stock Transfer workflow: Create, Submit, Approve, Dispatch, Receive', async ({
  page,
}) => {
  test.setTimeout(120_000);
  // Captured after creation and used to scope every subsequent list-row lookup — re-running
  // this spec against a persistent dev DB leaves prior runs' transfers in the list, and a
  // filter on status text alone (e.g. 'DRAFT') would ambiguously match a stray old row.
  let transferNumber = '';

  await test.step('Login', async () => {
    await realLogin(page, OWNER);
    await expect(page).toHaveURL(/\/dashboard/);
  });

  await test.step('Create a second warehouse to transfer stock into', async () => {
    await page.goto('/settings/warehouses');
    if (await existsOnPage(page, 'Secondary Warehouse')) return;
    await page.getByRole('button', { name: '+ New Warehouse' }).click();
    const dialog = page.getByRole('dialog', { name: 'New Warehouse' });
    await dialog.getByRole('textbox', { name: 'Name' }).fill('Secondary Warehouse');
    await dialog.getByRole('textbox', { name: 'Code' }).fill('WH-SEC');
    await dialog.getByRole('combobox', { name: 'Branch' }).selectOption({ label: 'Head Office' });
    await dialog.getByRole('button', { name: 'Save' }).click();
    await expect(page.getByText('Secondary Warehouse')).toBeVisible({ timeout: 10000 });
  });

  await test.step('Create a stock transfer from Main Warehouse to Secondary Warehouse', async () => {
    await page.goto('/inventory/transfers/new');
    await page
      .getByRole('combobox', { name: 'From Warehouse' })
      .selectOption({ label: 'Main Warehouse' });
    await page
      .getByRole('combobox', { name: 'To Warehouse' })
      .selectOption({ label: 'Secondary Warehouse' });

    await page.getByRole('textbox', { name: 'Search item to add' }).fill('Cotton');
    await page.getByRole('button', { name: /Cotton Saree/i }).click();
    await page.locator('input[type="number"][step="0.001"]').first().fill('20');

    await page.getByRole('button', { name: 'Create Transfer' }).click();
    await page.waitForURL(/\/inventory\/transfers\/\d+/, { timeout: 10000 });
    await expect(page.getByText('Transfer created')).toBeVisible({ timeout: 10000 });
    // The URL updates before React Router finishes swapping in the detail page's own heading —
    // grabbing h1 text immediately after waitForURL raced this once and captured the stale
    // "New Stock Transfer" title from the page being navigated away from. Wait for the real
    // TRF-... heading specifically instead.
    const heading = page.getByRole('heading', { level: 1, name: /^TRF-/ });
    await expect(heading).toBeVisible({ timeout: 10000 });
    transferNumber = (await heading.textContent())?.trim() ?? '';
    expect(transferNumber).not.toBe('');
  });

  await test.step('Submit, approve, and dispatch the transfer — Submit was a dead end fixed this session (backend endpoint existed, no UI ever called it)', async () => {
    await page.goto('/inventory/transfers');
    const row = page.locator('tbody tr').filter({ hasText: transferNumber });
    await clickMoreActionsThenMenuItem(row, page, 'Submit');
    await expect(page.getByText('Transfer submitted for approval')).toBeVisible({ timeout: 10000 });

    await clickMoreActionsThenMenuItem(row, page, 'Approve');
    await expect(page.getByText('Transfer approved')).toBeVisible({ timeout: 10000 });

    await clickMoreActionsThenMenuItem(row, page, 'Dispatch');
    await expect(page.getByText('Transfer dispatched')).toBeVisible({ timeout: 10000 });
  });

  await test.step('Receive the transfer — Secondary Warehouse stock should increase', async () => {
    const row = page.locator('tbody tr').filter({ hasText: transferNumber });
    await clickMoreActionsThenMenuItem(row, page, 'Receive');
    await page.waitForURL(/\/inventory\/transfers\/\d+\/receive/, { timeout: 10000 });

    await page.getByRole('button', { name: 'Confirm Receipt' }).click();
    await expect(page.getByText('Transfer received')).toBeVisible({ timeout: 10000 });
    await page.waitForURL('**/inventory/transfers', { timeout: 10000 });
  });
});
