// REAL end-to-end test — no mocking. Runs against the actually-running dev stack, same
// freshly provisioned tenant ("qa-e2e", tenant_id=2) as the other live-*.spec.ts files.
// Covers the full Physical Verification lifecycle: Start -> Start Counting (snapshot) ->
// Save Counts -> Approve (auto-generates a stock adjustment).
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

test.use({ storageState: undefined });

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('erp_onboarding_dismissed', 'true'));
});

test('LIVE — full real Physical Verification workflow: Start, Count, Approve', async ({ page }) => {
  test.setTimeout(120_000);

  await test.step('Login', async () => {
    await realLogin(page, OWNER);
    await expect(page).toHaveURL(/\/dashboard/);
  });

  await test.step('Start a physical verification for Main Warehouse', async () => {
    await page.goto('/inventory/physical-verifications');
    await page.getByRole('button', { name: '+ Start Verification' }).click();
    const dialog = page.getByRole('dialog', { name: 'New Physical Verification' });
    await dialog
      .getByRole('combobox', { name: 'Warehouse' })
      .selectOption({ label: 'Main Warehouse' });
    await dialog.getByRole('button', { name: 'Create' }).click();
    await expect(page.getByText('Verification created')).toBeVisible({ timeout: 10000 });
    await page.waitForURL(/\/inventory\/physical-verifications\/\d+/, { timeout: 10000 });
  });

  await test.step('Start counting (takes a snapshot of current system stock)', async () => {
    await page.getByRole('button', { name: 'Start Counting (Take Snapshot)' }).click();
    await expect(page.getByText('Counting started')).toBeVisible({ timeout: 10000 });
  });

  await test.step('Enter physical counts matching system quantity (zero variance) and approve', async () => {
    const rows = page.locator('tbody tr');
    await expect(rows.first()).toBeVisible({ timeout: 10000 });
    const rowCount = await rows.count();
    expect(rowCount).toBeGreaterThan(0);

    for (let i = 0; i < rowCount; i++) {
      const systemQtyText = await rows.nth(i).locator('td').nth(1).textContent();
      const systemQty = systemQtyText?.trim() ?? '0';
      await rows.nth(i).locator('input[type="number"]').fill(systemQty);
    }

    await page.getByRole('button', { name: 'Save Counts' }).click();
    await expect(page.getByText('Counts saved')).toBeVisible({ timeout: 10000 });

    await page.getByRole('button', { name: 'Approve & Generate Adjustment' }).click();
    // Both the toast and the in-page "APPROVED" status paragraph legitimately say
    // "Verification approved" simultaneously — match the toast's distinguishing suffix.
    await expect(page.getByText(/Verification approved — adjustments created/i)).toBeVisible({
      timeout: 10000,
    });
    await page.waitForURL('**/inventory/physical-verifications', { timeout: 10000 });
  });
});
