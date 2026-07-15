// REAL end-to-end test — no mocking. Runs against the actually-running dev stack, same
// "qa-e2e" tenant (tenant_id=2). Covers the Analytics group: Owner Dashboard KPIs, Reports
// Browser (sync + async report execution against the real report-service), and Report Schedules.
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

test('LIVE — Owner Dashboard renders real KPIs, charts and alerts with no crash', async ({
  page,
}) => {
  test.setTimeout(60_000);
  await realLogin(page);
  await page.goto('/dashboard');

  await expect(page.getByRole('heading', { name: 'Owner Dashboard' })).toBeVisible({
    timeout: 10000,
  });
  await expect(page.getByText("Today's Sales")).toBeVisible();
  await expect(page.getByText('Total Receivable')).toBeVisible();
  await expect(page.getByText('Sales Trend (Last 30 Days)')).toBeVisible();
  // Action-required section should render either real alert widgets or the all-clear message —
  // never nothing, and never a raw "Loading alerts..." left hanging.
  await expect(page.getByText(/action required/i)).toBeVisible();
  await expect(page.getByText('Loading alerts...')).not.toBeVisible({ timeout: 15000 });
});

test('LIVE — Reports Browser runs a real sync report against real invoice data', async ({
  page,
}) => {
  test.setTimeout(60_000);
  await realLogin(page);
  await page.goto('/reports');

  await expect(page.getByRole('heading', { name: 'Reports Browser' })).toBeVisible({
    timeout: 10000,
  });
  await page.getByRole('button', { name: 'Sales by Category' }).click();
  await page.waitForURL('**/reports/sales-by-category', { timeout: 10000 });

  await page.getByRole('button', { name: /run report/i }).click();
  await expect(page.getByText(/rows · generated in/i)).toBeVisible({ timeout: 15000 });
});

test('LIVE — Reports Browser runs a real async report and polls it to completion', async ({
  page,
}) => {
  test.setTimeout(60_000);
  await realLogin(page);
  await page.goto('/reports/sales-register');

  await expect(page.getByRole('heading', { name: 'Sales Register' })).toBeVisible({
    timeout: 10000,
  });
  await page.getByRole('button', { name: /run report/i }).click();
  // Async reports queue a background job — the transitional "generating" state may be too
  // brief to reliably catch (worker can finish before the next assertion polls), so just
  // confirm the end state: real result rows, not the queued placeholder.
  await expect(page.getByText(/rows · generated in/i)).toBeVisible({ timeout: 30000 });
});

test('LIVE — Report Schedule create and delete, real DB row', async ({ page }) => {
  test.setTimeout(60_000);
  await realLogin(page);
  await page.goto('/reports/schedules');

  await expect(page.getByRole('heading', { name: 'Report Schedules' })).toBeVisible({
    timeout: 10000,
  });
  await page.getByRole('button', { name: 'New Schedule' }).click();
  await page.locator('select').first().selectOption({ label: 'Sales by Category' });
  // Unique recipient per run — reruns against the same tenant would otherwise leave duplicate
  // schedule rows, and a generic `div` text filter also matches the wrapping list container
  // (which holds every row's Delete button), not just one card.
  const uniqueEmail = `qa-e2e-${Date.now()}@example.com`;
  await page.getByPlaceholder('user@company.com, manager@company.com').fill(uniqueEmail);
  await page.getByRole('button', { name: 'Create Schedule' }).click();

  const row = page.locator('.bg-surface-card.border.border-default.rounded-xl', {
    hasText: uniqueEmail,
  });
  await expect(row).toBeVisible({ timeout: 10000 });

  await row.getByTitle('Delete schedule').click();
  await expect(row).not.toBeVisible({ timeout: 10000 });
});
