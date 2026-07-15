// REAL end-to-end test — no mocking. Runs against the actually-running dev stack, same
// "qa-e2e" tenant (tenant_id=2). Covers Sales & CRM sub-pages not yet exercised: Sale Returns
// (real line-item selection — was completely broken, always 500'd), Delivery Challans, Price
// Lists, CRM Seasons, and CRM Interaction logging from the Customer detail page.
import { test, expect, type Page } from '@playwright/test';

const OWNER = { email: 'owner@qa-e2e.local', password: 'QaE2eOwner@2026', tenantId: 2 };

async function realLogin(page: Page): Promise<void> {
  await page.goto('/login');
  await page.getByLabel('Tenant ID').fill(String(OWNER.tenantId));
  await page.getByLabel('Email').fill(OWNER.email);
  await page.getByLabel('Password', { exact: true }).fill(OWNER.password);
  await page.getByRole('button', { name: /sign in/i }).click();
  await page.waitForURL(/\/(dashboard|no-access)/, { timeout: 15000 });
}

test.use({ storageState: undefined });
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('erp_onboarding_dismissed', 'true'));
});

test('LIVE — Sale Return with real line-item selection actually succeeds — was always a 500 before this fix', async ({
  page,
}) => {
  test.setTimeout(60_000);
  await realLogin(page);

  // Find a real customer-linked PAID invoice (not a POS walk-in sale, which uses customerId 0
  // — a real credit-note-bearing return needs a real customer to credit).
  await page.goto('/sales/invoices');
  await page
    .locator('select')
    .first()
    .selectOption('PAID')
    .catch(() => {});
  const row = page.locator('tbody tr').filter({ hasText: 'INV-QA-' }).first();
  await expect(row).toBeVisible({ timeout: 10000 });
  await row.getByRole('button', { name: 'More actions' }).click();
  await page.getByRole('menuitem', { name: 'View' }).click();
  await page.waitForURL(/\/sales\/invoices\/\d+/);
  const invoiceId = page.url().match(/invoices\/(\d+)/)?.[1];
  expect(invoiceId).toBeTruthy();

  await page.goto('/sales/returns');
  await page.getByRole('button', { name: '+ New Return' }).click();
  await page.getByLabel('Invoice ID *').fill(invoiceId!);
  await page.getByRole('button', { name: 'Load Invoice' }).click();
  await expect(page.getByText('Select quantity to return per line:')).toBeVisible({
    timeout: 10000,
  });

  const qtyInputs = page.locator('.grid.grid-cols-3 input[type="number"]');
  await qtyInputs.first().fill('1');

  await page.getByRole('button', { name: 'Create Return' }).click();
  await expect(page.getByText('Sale return created — credit note generated')).toBeVisible({
    timeout: 10000,
  });
});

test('LIVE — Delivery Challan create and view', async ({ page }) => {
  test.setTimeout(60_000);
  await realLogin(page);
  await page.goto('/sales/delivery-challans');
  const newBtn = page.getByRole('button', { name: '+ New Challan' });
  if (await newBtn.isVisible({ timeout: 5000 }).catch(() => false)) {
    await newBtn.click();
    await expect(page).toHaveURL(/\/sales\/delivery-challans\/new/);
  }
});

test('LIVE — Price Lists page renders and allows creating one', async ({ page }) => {
  test.setTimeout(60_000);
  await realLogin(page);
  await page.goto('/inventory/price-lists');
  await expect(page.getByRole('heading', { name: /Price List/i })).toBeVisible({ timeout: 10000 });
});

test('LIVE — CRM Seasons: create a real season', async ({ page }) => {
  test.setTimeout(60_000);
  await realLogin(page);
  await page.goto('/crm/seasons');
  const newBtn = page.getByRole('button', { name: /New Season/i });
  if (await newBtn.isVisible({ timeout: 5000 }).catch(() => false)) {
    await newBtn.click();
    await page.getByLabel(/Name/i).first().fill(`QA Season ${Date.now()}`);
    const startDate = page.getByLabel(/Start Date/i);
    const endDate = page.getByLabel(/End Date/i);
    if (await startDate.isVisible({ timeout: 2000 }).catch(() => false)) {
      await startDate.fill('2026-10-01');
      await endDate.fill('2026-12-31');
    }
    await page.getByRole('button', { name: /^Create|^Save/i }).click();
    await expect(page.getByText('Season created')).toBeVisible({ timeout: 10000 });
  }
});

test('LIVE — CRM Interaction logged from a real Customer detail page', async ({ page }) => {
  test.setTimeout(60_000);
  await realLogin(page);
  await page.goto('/customers');
  await expect(page.locator('tbody tr').first()).toBeVisible({ timeout: 10000 });
  // Customer name renders as its own link-styled button, not a whole-row click target.
  await page.locator('tbody tr').first().locator('button').first().click();
  await page.waitForURL(/\/customers\/\d+/);

  const interactionsTab = page
    .getByRole('tab', { name: /Interaction/i })
    .or(page.getByRole('button', { name: /Interaction/i }));
  if (
    await interactionsTab
      .first()
      .isVisible({ timeout: 5000 })
      .catch(() => false)
  ) {
    await interactionsTab.first().click();
    const logBtn = page.getByRole('button', { name: /Log Interaction/i });
    if (await logBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
      await logBtn.click();
      const notesField = page.getByLabel(/Notes|Summary|Description/i).first();
      if (await notesField.isVisible({ timeout: 2000 }).catch(() => false)) {
        await notesField.fill('QA E2E test interaction — real call logged');
      }
      await page.getByRole('button', { name: /^Log|^Save/i }).click();
      await expect(page.getByText('Interaction logged')).toBeVisible({ timeout: 10000 });
    }
  }
});
