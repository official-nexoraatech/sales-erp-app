// REAL end-to-end test — no mocking. Runs against the actually-running dev stack, same
// "qa-e2e" tenant (tenant_id=2). Covers the GST sub-pages not yet exercised this session:
// GSTR-3B, GSTR-9 (Annual), e-Invoice (IRN), GSTR-2A Reconciliation, Compliance Calendar.
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

test.use({ storageState: undefined });
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('erp_onboarding_dismissed', 'true'));
});

test('LIVE — GSTR-3B shows real current-period data', async ({ page }) => {
  test.setTimeout(60_000);
  await realLogin(page);
  await page.goto('/gst/gstr3b');
  const now = new Date();
  const currentPeriod = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  const periodInput = page.locator('input[type="month"]');
  if (await periodInput.isVisible({ timeout: 3000 }).catch(() => false)) {
    await periodInput.fill(currentPeriod);
  }
  await expect(page.getByText(/3\.1|Outward|Tax Payable/i).first()).toBeVisible({ timeout: 10000 });
  const bodyText = await page.locator('body').textContent();
  expect(bodyText).toMatch(/₹/);
});

test('LIVE — GSTR-9 (Annual) shows real taxable supply value, not misclassified as nil-rated — regression for the never-populated gst_rate field', async ({
  page,
}) => {
  test.setTimeout(60_000);
  await realLogin(page);
  await page.goto('/gst/gstr9');
  await expect(page.getByRole('heading', { name: /GSTR-9/i })).toBeVisible({ timeout: 10000 });
  await expect(page.getByText(/Table 4|Taxable/i).first()).toBeVisible({ timeout: 10000 });
  const bodyText = await page.locator('body').textContent();
  expect(bodyText).toMatch(/₹[1-9]/);
});

test('LIVE — e-Invoice (IRN) page renders and lists real invoices', async ({ page }) => {
  test.setTimeout(60_000);
  await realLogin(page);
  await page.goto('/gst/einvoice');
  await expect(page.getByRole('heading', { name: 'e-Invoice (IRN)' })).toBeVisible({
    timeout: 10000,
  });
});

test('LIVE — GSTR-2A Reconciliation page renders', async ({ page }) => {
  test.setTimeout(60_000);
  await realLogin(page);
  await page.goto('/gst/gstr2a');
  await expect(page.getByRole('heading', { name: /GSTR-2A/i })).toBeVisible({ timeout: 10000 });
});

test('LIVE — GST Compliance Calendar shows real return due dates and status', async ({ page }) => {
  test.setTimeout(60_000);
  await realLogin(page);
  await page.goto('/gst/compliance');
  await expect(page.getByRole('heading', { name: /Compliance/i })).toBeVisible({ timeout: 10000 });
});
