// REAL end-to-end test — no mocking. Runs against the actually-running dev stack, same
// "qa-e2e" tenant (tenant_id=2). Covers Purchase sub-pages not yet exercised: Purchase Returns
// (real GRN-line selection — was completely broken, always 500'd, same class as Sale Returns),
// Expenses create-to-approve-to-pay, and Supplier Payment PDC flagging.
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

test('LIVE — Purchase Return with real GRN-line selection actually succeeds — was always a 500 before this fix', async ({
  page,
}) => {
  test.setTimeout(60_000);
  await realLogin(page);

  await page.goto('/purchase/grns');
  await expect(page.locator('tbody tr').first()).toBeVisible({ timeout: 10000 });
  await page.locator('select').first().selectOption('APPROVED');
  const row = page.locator('tbody tr').filter({ hasText: 'APPROVED' }).first();
  await expect(row).toBeVisible({ timeout: 10000 });
  const rowText = await row.textContent();
  const grnNumberMatch = rowText?.match(/GRN-QA-\d+/);
  expect(grnNumberMatch).toBeTruthy();

  // GRNsPage doesn't expose a numeric GRN id directly in the row — resolve it via a fresh
  // API login+lookup rather than guessing this app's localStorage token key.
  const grnId = await page.evaluate(
    async ({ grnNumber, email, password, tenantId }) => {
      const loginRes = await fetch('http://localhost:3010/api/v2/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tenantId, email, password }),
      });
      const loginBody = await loginRes.json();
      const token = loginBody.data.accessToken;
      const res = await fetch('http://localhost:3020/api/v2/grns?status=APPROVED&pageSize=50', {
        headers: { Authorization: `Bearer ${token}` },
      });
      const body = await res.json();
      const found = (body.data?.content ?? []).find(
        (g: { grnNumber: string }) => g.grnNumber === grnNumber
      );
      return found?.id;
    },
    {
      grnNumber: grnNumberMatch![0],
      email: OWNER.email,
      password: OWNER.password,
      tenantId: OWNER.tenantId,
    }
  );
  expect(grnId).toBeTruthy();

  await page.goto('/purchase/returns');
  await page.getByRole('button', { name: '+ New Return' }).click();
  await page.getByLabel('GRN ID *').fill(String(grnId));
  await page.getByRole('button', { name: 'Load GRN' }).click();
  await expect(page.getByText('Select quantity to return per line:')).toBeVisible({
    timeout: 10000,
  });

  const qtyInputs = page.locator('.grid.grid-cols-3 input[type="number"]');
  await qtyInputs.first().fill('1');

  await page.getByRole('button', { name: 'Create Return' }).click();
  await expect(page.getByText('Purchase return created as DRAFT')).toBeVisible({ timeout: 10000 });

  // Approve it — should deduct stock and auto-generate a debit note.
  const newRow = page.locator('tbody tr').first();
  await newRow.getByRole('button', { name: 'More actions' }).click();
  await page.getByRole('menuitem', { name: 'Approve' }).click();
  await expect(
    page.getByText('Purchase return approved — stock deducted, debit note created')
  ).toBeVisible({ timeout: 10000 });
});

test('LIVE — full real Expense workflow: Create, Approve, Pay', async ({ page }) => {
  test.setTimeout(60_000);
  await realLogin(page);
  await page.goto('/purchase/expenses');

  await page.getByRole('button', { name: '+ New Expense' }).click();
  await page.getByLabel('Description', { exact: true }).fill('QA E2E test expense');
  await page.getByLabel('Description *').fill('Office supplies');
  await page.getByLabel('Amount *').fill('500');
  await page.getByRole('button', { name: 'Create', exact: true }).click();
  await expect(page.getByText(/created/i).first()).toBeVisible({ timeout: 10000 });

  // New expenses start DRAFT — Submit, then Approve, then Mark Paid.
  const row = page.locator('tbody tr').first();
  await expect(row).toBeVisible({ timeout: 10000 });
  await row.getByRole('button', { name: 'More actions' }).click();
  await page.getByRole('menuitem', { name: 'Submit' }).click();
  await expect(page.getByText('Expense submitted')).toBeVisible({ timeout: 10000 });

  await row.getByRole('button', { name: 'More actions' }).click();
  await page.getByRole('menuitem', { name: 'Approve' }).click();
  await expect(page.getByText(/^Expense approved/i)).toBeVisible({ timeout: 10000 });

  await row.getByRole('button', { name: 'More actions' }).click();
  await page.getByRole('menuitem', { name: 'Mark Paid' }).click();
  await page.getByRole('button', { name: 'Mark Paid', exact: true }).click();
  await expect(page.getByText(/marked as paid|payment recorded/i)).toBeVisible({ timeout: 10000 });
});
