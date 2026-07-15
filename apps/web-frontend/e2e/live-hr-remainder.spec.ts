// REAL end-to-end test — no mocking. Runs against the actually-running dev stack, same
// "qa-e2e" tenant (tenant_id=2). Covers HR sub-pages not yet exercised: Leave apply/approve,
// Alteration Orders receive/track, Form 16 generation, and the brand-new Employee Loans UI
// (backend existed since PG-045 but had zero frontend surface before this session).
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

test('LIVE — Employee Loan disburse and close, previously had zero UI at all', async ({ page }) => {
  test.setTimeout(60_000);
  await realLogin(page);

  await page.goto('/hr/employees/1');
  await expect(page.getByRole('heading', { name: 'Loans' })).toBeVisible({ timeout: 10000 });

  await page.getByRole('button', { name: '+ Disburse Loan' }).click();
  await page.getByLabel('Principal Amount').fill('6000');
  await page.getByLabel('Tenure (months)').fill('6');
  await page.getByRole('button', { name: 'Disburse' }).click();
  await expect(page.getByText('Loan disbursed')).toBeVisible({ timeout: 10000 });

  // Reruns against the same tenant leave prior loans (some already CLOSED) for this employee —
  // scope to rows that are still ACTIVE and take the newest (last in table order) to target the
  // one just disbursed above, not an older row from a previous run.
  const loanRow = page
    .locator('tbody tr')
    .filter({ hasText: 'SALARY ADVANCE' })
    .filter({ hasText: 'ACTIVE' })
    .last();
  await expect(loanRow).toBeVisible({ timeout: 10000 });
  await expect(loanRow.getByText('₹1000')).toBeVisible(); // 6000 / 6 months flat EMI

  await loanRow.getByRole('button', { name: 'Close' }).click();
  await expect(page.getByText('Loan closed')).toBeVisible({ timeout: 10000 });
});

test('LIVE — Leave apply and approve, real workflow end to end', async ({ page }) => {
  test.setTimeout(60_000);
  await realLogin(page);
  await page.goto('/hr/leaves');

  const seedBtn = page.getByRole('button', { name: 'Seed Default Leave Types' });
  const seedVisible = await seedBtn
    .waitFor({ state: 'visible', timeout: 5000 })
    .then(() => true)
    .catch(() => false);
  if (seedVisible) {
    await seedBtn.click();
    await expect(page.getByText('Default leave types seeded')).toBeVisible({ timeout: 10000 });
  }

  await page.getByLabel('Employee').selectOption({ label: 'Priya Sharma' });
  await page.getByLabel('Leave Type').selectOption({ index: 1 });
  const today = new Date();
  const start = new Date(today.getTime() + 7 * 86400000).toISOString().slice(0, 10);
  const end = new Date(today.getTime() + 8 * 86400000).toISOString().slice(0, 10);
  await page.getByLabel('Start Date').fill(start);
  await page.getByLabel('End Date').fill(end);
  await page.getByLabel('Reason').fill('QA E2E leave test');
  await page.getByRole('button', { name: 'Submit Application' }).click();
  await expect(page.getByText('Leave application submitted')).toBeVisible({ timeout: 10000 });

  const pendingItem = page.locator('li', { hasText: 'Priya Sharma' }).first();
  await expect(pendingItem).toBeVisible({ timeout: 10000 });
  await pendingItem.getByRole('button', { name: 'Approve' }).click();
  await expect(page.getByText('Leave approved')).toBeVisible({ timeout: 10000 });
});

test('LIVE — Alteration Order receive, real record, and detail view', async ({ page }) => {
  test.setTimeout(60_000);
  await realLogin(page);
  await page.goto('/hr/alterations/new');

  // Unique phone per run — reruns against the same tenant would otherwise leave duplicate
  // "QA E2E Customer" rows and make row-text lookups ambiguous.
  const uniquePhone = `98${Date.now().toString().slice(-8)}`;
  await page.getByLabel('Customer Name').fill('QA E2E Customer');
  await page.getByLabel('Customer Phone').fill(uniquePhone);
  const promised = new Date(Date.now() + 3 * 86400000).toISOString().slice(0, 10);
  await page.getByLabel('Promised Date').fill(promised);
  await page.getByLabel('Description').fill('Hem trousers');
  await page.getByLabel('Qty').fill('1');
  await page.getByLabel('Rate').fill('150');
  await page.getByRole('button', { name: 'Receive Order' }).click();
  await expect(page.getByText('Alteration order received')).toBeVisible({ timeout: 10000 });
  await page.waitForURL('**/hr/alterations', { timeout: 10000 });

  // Resolve the real id via a fresh API lookup rather than clicking the list row — this app's
  // list doesn't expose a numeric id directly, and duplicate customer names across reruns make
  // text-based row targeting unreliable.
  const orderId = await page.evaluate(
    async ({ phone, email, password, tenantId }) => {
      const loginRes = await fetch('http://localhost:3010/api/v2/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tenantId, email, password }),
      });
      const loginBody = await loginRes.json();
      const token = loginBody.data.accessToken;
      const res = await fetch('http://localhost:3021/api/v2/alterations?status=', {
        headers: { Authorization: `Bearer ${token}` },
      });
      const body = await res.json();
      const found = (body.data?.content ?? []).find(
        (a: { customerPhone: string }) => a.customerPhone === phone
      );
      return found?.id;
    },
    { phone: uniquePhone, email: OWNER.email, password: OWNER.password, tenantId: OWNER.tenantId }
  );
  expect(orderId).toBeTruthy();

  await page.goto(`/hr/alterations/${orderId}`);
  await expect(page.getByText(uniquePhone)).toBeVisible({ timeout: 10000 });
});

test('LIVE — Form 16 generation shows real non-zero TDS from an actual disbursed payroll run', async ({
  page,
}) => {
  test.setTimeout(60_000);
  await realLogin(page);
  await page.goto('/hr/form16');

  await page.getByLabel('Employee').selectOption({ value: '3' });
  await page.getByLabel('Financial Year').selectOption('2026-27');
  await page.getByRole('button', { name: 'Generate' }).click();

  await expect(page.getByText(/Summary \(FY 2026-27\)/)).toBeVisible({ timeout: 10000 });
  const tdsValue = page
    .locator('dt', { hasText: 'Total TDS' })
    .locator('xpath=following-sibling::dd');
  await expect(tdsValue).not.toHaveText('₹0.00', { timeout: 10000 });
});
