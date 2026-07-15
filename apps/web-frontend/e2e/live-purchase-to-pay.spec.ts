// REAL end-to-end test — no mocking. Runs against the actually-running dev stack
// (web-frontend on :5173, all backend services, real Postgres) using the same freshly
// provisioned tenant ("qa-e2e", tenant_id=2) as live-order-to-cash.spec.ts. Mirrors that
// spec's structure: one login, one test.step per stage, all real API calls.
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

// A synchronous `.count() > 0` right after `goto` races the list's own data fetch — see
// live-order-to-cash.spec.ts for the full rationale. Same helper, duplicated because these
// two spec files are meant to be readable/runnable independently.
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

test('LIVE — full real Purchase-to-Pay workflow: Supplier, PO, GRN (stock receipt), Supplier Payment', async ({
  page,
}) => {
  test.setTimeout(150_000);
  let supplierId = '';
  // Unique per run — poNumber/paymentNumber-adjacent uniqueness constraints exist elsewhere in
  // this app (see live-order-to-cash.spec.ts's invoiceNumber note); avoid the same collision.
  const poNumber = `PO-QA-${Date.now()}`;

  await test.step('Login', async () => {
    await realLogin(page, OWNER);
    await expect(page).toHaveURL(/\/dashboard/);
  });

  await test.step('Create a supplier', async () => {
    await page.goto('/suppliers');
    if (await existsOnPage(page, 'Global Textiles Supplier')) {
      await page.getByRole('button', { name: 'Global Textiles Supplier' }).click();
    } else {
      await page.getByRole('button', { name: /\+ new supplier/i }).click();
      await page.waitForURL('**/suppliers/new');
      await page.getByRole('textbox', { name: 'Display Name' }).fill('Global Textiles Supplier');
      await page.getByRole('combobox', { name: 'Branch' }).selectOption({ label: 'Head Office' });
      await page.getByRole('textbox', { name: 'Phone' }).fill('9123456780');
      await page.getByRole('button', { name: /^create supplier/i }).click();
      await page.waitForURL('**/suppliers', { timeout: 10000 });
      await expect(page.getByText('Global Textiles Supplier')).toBeVisible({ timeout: 10000 });
      await page.getByRole('button', { name: 'Global Textiles Supplier' }).click();
    }
    await page.waitForURL(/\/suppliers\/\d+\/edit/, { timeout: 10000 });
    supplierId = page.url().match(/\/suppliers\/(\d+)\/edit/)?.[1] ?? '';
    expect(supplierId).not.toBe('');
  });

  await test.step('Create a purchase order', async () => {
    await page.goto('/purchase/orders/new');
    await page.getByRole('combobox', { name: 'Supplier' }).fill('Global Textiles');
    await page.getByRole('option', { name: /Global Textiles Supplier/i }).click();
    await page.getByRole('combobox', { name: 'Branch' }).selectOption({ label: 'Head Office' });
    await page
      .getByRole('combobox', { name: 'Warehouse' })
      .selectOption({ label: 'Main Warehouse' });

    await page.locator('input[placeholder="Search items to add…"]').fill('Cotton');
    await page.getByRole('button', { name: /Cotton Saree/i }).click();
    // Cotton Saree has no purchasePrice recorded (created with only a sale price in the Sales
    // module test) — the addItem prefill has nothing to prefill from, same as a real first PO
    // for an item that's never been bought before. Fill it manually, as a real buyer would.
    await page.locator('input[type="number"][step="0.001"]').first().fill('50');
    await page.locator('input[type="number"][step="0.01"]').first().fill('700');

    await page.getByRole('button', { name: 'Save as Draft' }).click();
    await page.waitForURL('**/purchase/orders', { timeout: 10000 });
    await expect(page.getByText('Purchase order created as DRAFT')).toBeVisible({ timeout: 10000 });
  });

  await test.step('Submit and approve the purchase order', async () => {
    const row = page.locator('tbody tr').filter({ hasText: 'Draft' }).first();
    await clickMoreActionsThenMenuItem(row, page, 'Submit');
    await expect(page.getByText('PO submitted for approval')).toBeVisible({ timeout: 10000 });

    const submittedRow = page.locator('tbody tr').filter({ hasText: 'SUBMITTED' }).first();
    await clickMoreActionsThenMenuItem(submittedRow, page, 'Approve');
    const approveDialog = page.getByRole('dialog', { name: 'Approve Purchase Order' });
    await approveDialog.getByRole('textbox', { name: 'PO Number' }).fill(poNumber);
    await approveDialog.getByRole('button', { name: 'Approve' }).click();
    await expect(page.getByText('PO approved')).toBeVisible({ timeout: 10000 });
  });

  await test.step('Receive goods against the PO (GRN) and approve it — stock should increase', async () => {
    const approvedRow = page.locator('tbody tr').filter({ hasText: poNumber });
    await clickMoreActionsThenMenuItem(approvedRow, page, 'Receive');
    await page.waitForURL(/\/purchase\/grns\/new\?poId=\d+/, { timeout: 10000 });
    const poId = new URL(page.url()).searchParams.get('poId');
    expect(poId).not.toBeNull();

    await expect(page.getByText(poNumber)).toBeVisible({ timeout: 10000 });
    await page.getByRole('button', { name: 'Create GRN' }).click();
    await page.waitForURL('**/purchase/grns', { timeout: 10000 });
    await expect(page.getByText(/GRN created/i)).toBeVisible({ timeout: 10000 });

    // A zero-price-variance GRN (this one — the GRN rate matches the PO rate exactly) is
    // created straight into DRAFT, not PENDING_APPROVAL — it must still be explicitly
    // approved before stock is posted or the item's WACC cost updates. This was a real dead
    // end (fixed this session): the row action for Approve only used to show for
    // PENDING_APPROVAL, even though the backend always accepted DRAFT too.
    const grnRow = page.locator('tbody tr').filter({ hasText: `PO-${poId}` });
    await clickMoreActionsThenMenuItem(grnRow, page, 'Approve');
    const approveDialog = page.getByRole('dialog', { name: 'Approve GRN' });
    await approveDialog.getByRole('textbox', { name: 'GRN Number' }).fill(`GRN-QA-${Date.now()}`);
    await approveDialog.getByRole('button', { name: 'Approve & Add Stock' }).click();
    await expect(page.getByText('GRN approved — stock updated')).toBeVisible({ timeout: 10000 });
  });

  await test.step('Record a payment to the supplier', async () => {
    await page.goto('/purchase/payments');
    await page.getByRole('button', { name: '+ Record Payment' }).click();
    const dialog = page.getByRole('dialog', { name: 'Record Supplier Payment' });
    // This form hardcodes "Field *" directly into the label string instead of using Input's
    // `required` prop (which renders the asterisk in a separate aria-hidden span) — the literal
    // " *" is part of the accessible name here, unlike every other form in this app.
    await dialog.getByRole('spinbutton', { name: 'Supplier ID *', exact: true }).fill(supplierId);
    await dialog.getByRole('spinbutton', { name: 'Amount *', exact: true }).fill('35000');
    await dialog.getByRole('button', { name: 'Record Payment' }).click();
    await expect(page.getByText('Payment recorded')).toBeVisible({ timeout: 10000 });
  });
});
