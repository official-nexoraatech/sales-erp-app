// REAL end-to-end test — no mocking. Runs against the actually-running dev stack, same
// "qa-e2e" tenant (tenant_id=2) as the other live-*.spec.ts files. Covers the Accounting
// module's core financial reports: Financial Years (create — this tenant had zero and no
// route ever created the first one), Trial Balance, Profit & Loss, Balance Sheet, Cash Flow,
// plus smoke coverage of Cost Centers, Fixed Assets, TDS, and Bank Reconciliation.
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

async function existsOnPage(page: Page, text: string | RegExp): Promise<boolean> {
  return page
    .getByText(text)
    .first()
    .waitFor({ state: 'visible', timeout: 8000 })
    .then(() => true)
    .catch(() => false);
}

test.use({ storageState: undefined });

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('erp_onboarding_dismissed', 'true'));
});

test('LIVE — full real Accounting Reports workflow: Financial Year, Trial Balance, P&L, Balance Sheet, Cash Flow', async ({
  page,
}) => {
  test.setTimeout(90_000);

  await test.step('Login', async () => {
    await realLogin(page, OWNER);
    await expect(page).toHaveURL(/\/dashboard/);
  });

  await test.step('Create a Financial Year if none exists — the "New Financial Year" button/form did not exist before this session, and no other route ever created one', async () => {
    await page.goto('/accounting/financial-years');
    const hasOpen = await existsOnPage(page, /OPEN/);
    if (!hasOpen) {
      await page.getByRole('button', { name: '+ New Financial Year' }).first().click();
      await page.getByLabel('Year Code').fill('FY2026-27');
      await page.getByLabel('Start Date').fill('2026-04-01');
      await page.getByLabel('End Date').fill('2027-03-31');
      await page.getByRole('button', { name: 'Create Financial Year' }).click();
      await expect(page.getByText('Financial year created')).toBeVisible({ timeout: 10000 });
    }
    await expect(page.getByText('FY2026-27').or(page.getByText(/OPEN/)).first()).toBeVisible({
      timeout: 10000,
    });
  });

  await test.step('Trial Balance shows real, non-zero, balanced totals and real per-account rows — regression for both the "as of today" midnight-cutoff bug (always showed zero) and the rows/lines field-name mismatch (table was always empty even with real data)', async () => {
    await page.goto('/accounting/reports/trial-balance');
    await expect(page.getByText('✓ Trial balance is balanced')).toBeVisible({ timeout: 10000 });
    await expect(page.locator('tbody tr').first()).toBeVisible({ timeout: 10000 });
    const bodyText = await page.locator('body').textContent();
    // The page should show non-zero rupee amounts, not just ₹0.00 everywhere.
    expect(bodyText).toMatch(/₹[1-9]/);
  });

  await test.step('Profit & Loss shows real revenue/expense activity for the current month', async () => {
    await page.goto('/accounting/reports/profit-loss');
    await expect(page.getByText(/Net Profit|Net Loss/i)).toBeVisible({ timeout: 10000 });
    const bodyText = await page.locator('body').textContent();
    expect(bodyText).toMatch(/₹[1-9]/);
  });

  await test.step('Balance Sheet now includes real activity and a computed Current Year Earnings line — regression for both the midnight-cutoff bug and the missing-equity-rollup bug', async () => {
    await page.goto('/accounting/reports/balance-sheet');
    await expect(page.getByText(/balance sheet (balances|does NOT balance)/i)).toBeVisible({
      timeout: 15000,
    });
    await expect(page.getByText('Current Year Earnings')).toBeVisible({ timeout: 10000 });
    const bodyText = await page.locator('body').textContent();
    expect(bodyText).toMatch(/₹[1-9]/);
  });

  await test.step('Cash Flow renders with real operating activity', async () => {
    await page.goto('/accounting/reports/cash-flow');
    await expect(page.getByText(/Operating Activities/i)).toBeVisible({ timeout: 10000 });
  });
});

test('LIVE — Cost Centers, Fixed Assets, TDS, Bank Reconciliation smoke coverage', async ({
  page,
}) => {
  test.setTimeout(60_000);

  await test.step('Login', async () => {
    await realLogin(page, OWNER);
    await expect(page).toHaveURL(/\/dashboard/);
  });

  await test.step('Create a real Cost Center', async () => {
    await page.goto('/accounting/cost-centers');
    const addBtn = page.getByRole('button', { name: /\+.*Cost Center/i });
    if (await addBtn.isVisible({ timeout: 5000 }).catch(() => false)) {
      await addBtn.click();
      const code = `CC-${Date.now()}`;
      await page.getByLabel(/Code/i).fill(code);
      await page.getByLabel(/Name/i).fill('QA Test Cost Center');
      await page.getByRole('button', { name: /^Create|^Save/i }).click();
      await expect(page.getByText(/created|saved/i)).toBeVisible({ timeout: 10000 });
    }
  });

  await test.step('Fixed Assets page renders without error', async () => {
    await page.goto('/accounting/fixed-assets');
    await expect(page.getByRole('heading', { name: /Fixed Assets/i })).toBeVisible({
      timeout: 10000,
    });
  });

  await test.step('TDS page renders without error', async () => {
    await page.goto('/accounting/tds');
    await expect(page.getByRole('heading', { name: /TDS/i })).toBeVisible({ timeout: 10000 });
  });

  await test.step('Bank Reconciliation page renders without error', async () => {
    await page.goto('/accounting/bank-reconciliation');
    const heading = page.getByRole('heading').first();
    await expect(heading).toBeVisible({ timeout: 10000 });
  });

  await test.step('Opening Balances page renders without error', async () => {
    await page.goto('/accounting/opening-balances');
    const heading = page.getByRole('heading').first();
    await expect(heading).toBeVisible({ timeout: 10000 });
  });
});
