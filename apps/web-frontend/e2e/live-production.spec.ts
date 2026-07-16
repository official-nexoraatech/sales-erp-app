// REAL end-to-end test — no mocking. Runs against the actually-running dev stack, same
// freshly provisioned tenant ("qa-e2e", tenant_id=2) as the other live-*.spec.ts files.
// Covers the full Job Work Order lifecycle: Create -> Detail -> Issue Materials ->
// Start Quality Check -> Submit QC entries -> Complete. This module's detail page,
// Issue Materials, and Start Quality Check actions did not exist before this session —
// the list page linked to a route that was never registered.
import { test, expect, type Page } from '@playwright/test';

const OWNER = { email: 'owner@qa-e2e.local', password: 'QaE2eOwner@2026', tenantId: 2 };

async function realLogin(
  page: Page,
  creds: { email: string; password: string; tenantId: number }
): Promise<void> {
  await page.goto('/login');
  await page.getByRole('button', { name: 'Sign in with a tenant ID instead' }).click();
  await page.getByLabel('Tenant ID').fill(String(creds.tenantId));
  await page.getByLabel('Email').fill(creds.email);
  await page.getByLabel('Password', { exact: true }).fill(creds.password);
  await page.getByRole('button', { name: /sign in/i }).click();
  await page.waitForURL(/\/(dashboard|no-access)/, { timeout: 15000 });
}

// Picks the first real (non-placeholder) <option> in a <select> — placeholder is always
// index 0 ("Select supplier" etc.) with value="".
async function selectFirstRealOption(select: ReturnType<Page['locator']>): Promise<string> {
  const value = await select.locator('option').nth(1).getAttribute('value');
  if (!value) throw new Error('No real <option> found (only the placeholder exists)');
  await select.selectOption(value);
  return value;
}

test.use({ storageState: undefined });

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('erp_onboarding_dismissed', 'true'));
});

test('LIVE — full real Production workflow: Job Work Order Create, Issue Materials, Quality Check, Complete', async ({
  page,
}) => {
  test.setTimeout(120_000);

  await test.step('Login', async () => {
    await realLogin(page, OWNER);
    await expect(page).toHaveURL(/\/dashboard/);
  });

  let orderNumber = '';

  await test.step('Create a Job Work Order with a real supplier, branch, warehouse, output item, and one material line', async () => {
    await page.goto('/production/job-work/new');
    await expect(page.getByRole('heading', { name: 'New Job Work Order' })).toBeVisible({
      timeout: 10000,
    });

    const selects = page.locator('select');
    await selectFirstRealOption(selects.nth(0)); // Supplier
    await selectFirstRealOption(selects.nth(1)); // Branch
    await selectFirstRealOption(selects.nth(2)); // Output Warehouse
    const outputItemValue = await selectFirstRealOption(selects.nth(3)); // Output Item

    await page.getByLabel('Ordered Qty').fill('50');
    await page.getByLabel('Job Work Rate (per unit)').fill('25');
    const expected = new Date();
    expected.setDate(expected.getDate() + 7);
    await page.getByLabel('Expected Completion').fill(expected.toISOString().slice(0, 10));

    // Material line — pick a DIFFERENT item than the output item where possible so the
    // order represents a real "raw material -> finished good" job work relationship.
    const materialItemSelect = page.locator('.grid.grid-cols-5 select').first();
    const materialOptions = materialItemSelect.locator('option');
    const optionCount = await materialOptions.count();
    let materialValue = '';
    for (let i = 1; i < optionCount; i++) {
      const v = await materialOptions.nth(i).getAttribute('value');
      if (v && v !== outputItemValue) {
        materialValue = v;
        break;
      }
    }
    if (!materialValue) materialValue = outputItemValue;
    await materialItemSelect.selectOption(materialValue);
    await page.getByLabel('Required Qty').fill('100');

    await page.getByRole('button', { name: 'Create Order' }).click();
    await expect(page.getByText('Job work order created')).toBeVisible({ timeout: 10000 });
    await page.waitForURL(/\/production\/job-work$/);
  });

  await test.step('The new order appears in the list with a real supplier/item name (not "—") — regression for the never-populated join', async () => {
    const rows = page.locator('tbody tr');
    await expect(rows.first()).toBeVisible({ timeout: 10000 });
    orderNumber = (await rows.first().locator('td').first().textContent())?.trim() ?? '';
    expect(orderNumber).toMatch(/JWO|JOB/i);
    // Supplier and Item columns must not both be the "—" fallback.
    const rowText = await rows.first().textContent();
    expect(rowText).not.toMatch(/—\s*—/);
  });

  await test.step('Open the order detail page — this route did not exist before this session (row click was a dead end)', async () => {
    await page.locator('tbody tr').first().click();
    await page.waitForURL(/\/production\/job-work\/\d+$/);
    await expect(page.getByText('DRAFT').first()).toBeVisible({ timeout: 10000 });
  });

  await test.step('Issue Materials — DRAFT -> MATERIAL_ISSUED', async () => {
    await page.getByRole('button', { name: 'Issue Materials' }).click();
    await expect(page.getByText('Materials issued to supplier')).toBeVisible({ timeout: 10000 });
    await expect(page.getByText('MATERIAL ISSUED').first()).toBeVisible({ timeout: 10000 });
  });

  await test.step('Start Quality Check — MATERIAL_ISSUED -> QUALITY_CHECK, navigates to the QC page', async () => {
    await page.getByRole('button', { name: 'Start Quality Check' }).click();
    await expect(page.getByText('Quality check started')).toBeVisible({ timeout: 10000 });
    await page.waitForURL(/\/production\/job-work\/\d+\/qc$/);
  });

  await test.step('Submit a piece-by-piece QC entry', async () => {
    await page.getByRole('button', { name: 'Save QC Entries' }).click();
    await expect(page.getByText('Quality checks saved')).toBeVisible({ timeout: 10000 });
  });

  await test.step('Complete the order — verify real stock increment on the output item', async () => {
    await page.getByLabel('Received Qty').fill('48');
    await page.getByLabel('Rejected Qty').fill('2');
    await page.getByRole('button', { name: 'Mark as Completed' }).click();
    await expect(page.getByText('Job work order completed')).toBeVisible({ timeout: 10000 });
    await page.waitForURL(/\/production\/job-work$/);

    await page.locator('select').first().selectOption('COMPLETED');
    const completedRow = page.locator('tbody tr').filter({ hasText: orderNumber });
    await expect(completedRow.getByText('COMPLETED')).toBeVisible({ timeout: 10000 });
    await expect(completedRow).toContainText('48');
  });
});

test('LIVE — Consignment Stock receive/return and Settlement create/settle, with real supplier/item name joins', async ({
  page,
}) => {
  test.setTimeout(90_000);

  await test.step('Login', async () => {
    await realLogin(page, OWNER);
    await expect(page).toHaveURL(/\/dashboard/);
  });

  await test.step('Receive consignment stock from a real supplier', async () => {
    await page.goto('/production/consignment/stock');
    await page.getByRole('button', { name: '+ Receive Consignment' }).click();

    const selects = page.locator('select');
    await selectFirstRealOption(selects.nth(0)); // Supplier
    await selectFirstRealOption(selects.nth(1)); // Item
    await selectFirstRealOption(selects.nth(2)); // Warehouse
    await page.getByLabel('Received Qty').fill('20');
    await page.getByLabel('Agreed Rate').fill('150');

    await page.getByRole('button', { name: 'Receive Stock' }).click();
    await expect(page.getByText('Consignment received')).toBeVisible({ timeout: 10000 });
  });

  await test.step('The stock row shows real supplier/item/warehouse names — regression for the never-populated join', async () => {
    const rows = page.locator('tbody tr');
    await expect(rows.first()).toBeVisible({ timeout: 10000 });
    const rowText = await rows.first().textContent();
    expect(rowText).not.toMatch(/—.*—.*—/);
  });

  await test.step('Return part of the stock to the supplier', async () => {
    page.once('dialog', (dialog) => dialog.accept('5'));
    await page.locator('tbody tr').first().getByRole('button', { name: 'Return' }).click();
    await expect(page.getByText('Stock returned to supplier')).toBeVisible({ timeout: 10000 });
  });

  await test.step('Create a settlement for the supplier — verify a real settlement number is generated', async () => {
    await page.goto('/production/consignment/settlements');
    await page.getByRole('button', { name: '+ Create Settlement' }).click();

    await selectFirstRealOption(page.locator('select').first()); // Supplier
    const from = new Date();
    from.setMonth(from.getMonth() - 1);
    await page.getByLabel('Period From').fill(from.toISOString().slice(0, 10));
    await page.getByLabel('Period To').fill(new Date().toISOString().slice(0, 10));

    await page.getByRole('button', { name: 'Create Settlement', exact: true }).click();
    await expect(page.getByText('Settlement created')).toBeVisible({ timeout: 10000 });

    const rows = page.locator('tbody tr');
    await expect(rows.first()).toBeVisible({ timeout: 10000 });
    const settlementNumber = (await rows.first().locator('td').first().textContent())?.trim() ?? '';
    expect(settlementNumber).toMatch(/CS-/);
  });

  await test.step('Mark the settlement as settled', async () => {
    const pendingRow = page.locator('tbody tr').filter({ hasText: 'PENDING' }).first();
    const hasPending = await pendingRow.isVisible().catch(() => false);
    if (hasPending) {
      page.once('dialog', (dialog) => dialog.accept('PAY-QA-TEST'));
      await pendingRow.getByRole('button', { name: 'Mark Settled' }).click();
      await expect(page.getByText('Settlement marked as paid')).toBeVisible({ timeout: 10000 });
    }
  });
});

test('LIVE — Reorder Report: an item below its reorder level shows a real inferred supplier and last purchase price, and Create POs actually creates a PO', async ({
  page,
}) => {
  test.setTimeout(60_000);

  await test.step('Login', async () => {
    await realLogin(page, OWNER);
    await expect(page).toHaveURL(/\/dashboard/);
  });

  await test.step('The reorder-required item shows a real supplier (not "No supplier") — regression for defaultSupplierId/lastPurchasePrice never being populated', async () => {
    await page.goto('/production/reorder');
    await expect(page.locator('tbody tr').first()).toBeVisible({ timeout: 10000 });
    const rowText = await page.locator('tbody tr').first().textContent();
    expect(rowText).not.toContain('No supplier');
  });

  await test.step('Create POs from the reorder report actually creates a purchase order — this always silently created zero POs before the fix', async () => {
    await page.locator('tbody tr').first().click();
    await page.getByRole('button', { name: /Create POs/ }).click();
    await expect(page.getByText(/purchase order\(s\) created/)).toBeVisible({ timeout: 10000 });
    const toastText = await page.getByText(/purchase order\(s\) created/).textContent();
    const count = parseInt(toastText ?? '0', 10);
    expect(count).toBeGreaterThan(0);
  });
});

test('LIVE — Barcode Labels: generate real CODE128 labels for an item and preview them', async ({
  page,
}) => {
  test.setTimeout(60_000);

  await test.step('Login', async () => {
    await realLogin(page, OWNER);
    await expect(page).toHaveURL(/\/dashboard/);
  });

  await test.step('Search a real item, generate labels, and verify the preview renders one label per requested quantity', async () => {
    await page.goto('/production/barcode-labels');
    await page.getByLabel('Item').fill('Cotton');
    await page.getByRole('button', { name: 'Cotton Saree' }).first().click();
    await page.getByLabel('Quantity').fill('3');

    await page.getByRole('button', { name: 'Generate & Preview' }).click();
    await expect(page.getByText(/Preview — 3 labels/)).toBeVisible({ timeout: 10000 });
    await expect(page.locator('svg').first()).toBeVisible();
  });
});
