// REAL end-to-end test — no mocking. Runs against the actually-running dev stack, same
// "qa-e2e" tenant (tenant_id=2). Covers Inventory sub-pages not yet exercised: Stock
// Adjustments full create-to-approve lifecycle, Fabric Rolls receive/cut.
import { test, expect, type Page } from '@playwright/test';

const OWNER = { email: 'owner@qa-e2e.local', password: 'QaE2eOwner@2026', tenantId: 2 };

async function realLogin(page: Page): Promise<void> {
  await page.goto('/login');
  await page.getByRole('button', { name: 'Sign in with a tenant ID instead' }).click();
  await page.getByLabel('Tenant ID').fill(String(OWNER.tenantId));
  await page.getByLabel('Email').fill(OWNER.email);
  await page.getByLabel('Password', { exact: true }).fill(OWNER.password);
  await page.getByRole('button', { name: /sign in/i }).click();
  await page.waitForURL(/\/(dashboard|no-access)/, { timeout: 15000 });
}

async function selectFirstRealOption(select: ReturnType<Page['locator']>): Promise<void> {
  const value = await select.locator('option').nth(1).getAttribute('value');
  if (!value) throw new Error('No real <option> found');
  await select.selectOption(value);
}

test.use({ storageState: undefined });
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('erp_onboarding_dismissed', 'true'));
});

test('LIVE — full real Stock Adjustment workflow: Create, Approve, stock updated', async ({
  page,
}) => {
  test.setTimeout(60_000);
  await realLogin(page);

  await page.goto('/inventory/adjustments/new');
  await selectFirstRealOption(page.getByLabel('Warehouse')); // Warehouse select
  await page.getByLabel('Search item').fill('Cotton');
  await page
    .getByRole('button', { name: /Cotton Saree/i })
    .first()
    .click();
  // Line row's Quantity input is a bare, unlabelled <input> in the item table.
  await page.locator('table input[type="number"]').first().fill('5');
  await page.getByLabel('Notes').fill('QA E2E test adjustment');
  await page.getByRole('button', { name: /^Create|^Submit|^Save/i }).click();
  await expect(page.getByText(/created|submitted/i).first()).toBeVisible({ timeout: 10000 });
  await page.waitForURL(/\/inventory\/adjustments$/, { timeout: 10000 }).catch(() => {});

  // New adjustments start DRAFT — Submit first, then Approve becomes available.
  const firstRow = page.locator('tbody tr').first();
  await firstRow.getByRole('button', { name: 'More actions' }).click();
  await page.getByRole('menuitem', { name: 'Submit' }).click();
  await expect(page.getByText('Adjustment submitted')).toBeVisible({ timeout: 10000 });

  await firstRow.getByRole('button', { name: 'More actions' }).click();
  await page.getByRole('menuitem', { name: 'Approve' }).click();
  await expect(page.getByText('Adjustment approved — stock updated')).toBeVisible({
    timeout: 10000,
  });
});

test('LIVE — Fabric Rolls: receive a real roll and cut it', async ({ page }) => {
  test.setTimeout(60_000);
  await realLogin(page);
  await page.goto('/inventory/fabric-rolls');

  await page.getByRole('button', { name: '+ Receive Roll' }).click();
  const dialog = page.getByRole('dialog', { name: 'Receive Fabric Roll' });
  const rollNumber = `ROLL-QA-${Date.now()}`;
  await dialog.getByLabel('Roll Number').fill(rollNumber);
  await selectFirstRealOption(dialog.getByLabel('Item'));
  await selectFirstRealOption(dialog.getByLabel('Warehouse'));
  await dialog.getByLabel('Meters').fill('50');
  await dialog.getByRole('button', { name: 'Receive' }).click();
  await expect(page.getByText('Roll received')).toBeVisible({ timeout: 10000 });

  // Cut the roll we just received.
  const row = page.locator('tbody tr').filter({ hasText: rollNumber });
  await expect(row).toBeVisible({ timeout: 10000 });
  await row
    .getByRole('button', { name: /more actions|cut/i })
    .first()
    .click();
  const cutMenuItem = page.getByRole('menuitem', { name: /Cut/i });
  if (await cutMenuItem.isVisible({ timeout: 2000 }).catch(() => false)) {
    await cutMenuItem.click();
  }
  await expect(page.getByRole('heading', { name: `Cut Roll ${rollNumber}` })).toBeVisible({
    timeout: 10000,
  });
  await page.getByLabel('Meters to Cut').fill('10');
  await page.getByLabel('Purpose').fill('QA E2E test cut');
  await page.getByRole('button', { name: 'Record Cut' }).click();
  await expect(page.getByText('Cut recorded')).toBeVisible({ timeout: 10000 });
});
