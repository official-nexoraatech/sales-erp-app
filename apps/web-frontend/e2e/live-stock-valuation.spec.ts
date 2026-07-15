// REAL end-to-end test — no mocking. Read-only page (GET + client-side CSV export), same
// freshly provisioned tenant ("qa-e2e", tenant_id=2) as the other live-*.spec.ts files.
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

test.use({ storageState: undefined });

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('erp_onboarding_dismissed', 'true'));
});

test('LIVE — Stock Valuation report shows real, non-zero stock value', async ({ page }) => {
  await realLogin(page, OWNER);
  await page.goto('/inventory/valuation');

  await expect(page.getByRole('heading', { name: 'Stock Valuation Report' })).toBeVisible();
  await expect(page.getByText('Cotton Saree')).toBeVisible({ timeout: 10000 });
  await expect(page.getByText('TOTAL STOCK VALUE')).toBeVisible();

  // Not asserting an exact figure — this DB accumulates state across every live-*.spec.ts run
  // in this session — just that a real, non-zero total rendered (proves the query + WACC/FIFO
  // costing pipeline actually returned data, not an empty/error state).
  const totalCell = page.locator('tfoot td').last();
  const totalText = (await totalCell.textContent()) ?? '';
  const numeric = parseFloat(totalText.replace(/[^0-9.]/g, ''));
  expect(numeric).toBeGreaterThan(0);

  await expect(page.getByRole('button', { name: /export csv/i })).toBeEnabled();
});
