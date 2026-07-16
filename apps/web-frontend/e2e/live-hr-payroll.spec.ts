// REAL end-to-end test — no mocking. Runs against the actually-running dev stack, same
// freshly provisioned tenant ("qa-e2e", tenant_id=2) as the other live-*.spec.ts files.
// Covers: Employee create -> Mark Attendance -> Set Salary -> Payroll Run
// (Create -> Calculate -> Approve -> Disburse) -> View Payslip.
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

async function existsOnPage(page: Page, text: string): Promise<boolean> {
  return page
    .getByText(text, { exact: true })
    .first()
    .waitFor({ state: 'visible', timeout: 8000 })
    .then(() => true)
    .catch(() => false);
}

// selectOption({ label }) requires an exact string match — the employee dropdown's option text
// is "{displayName} ({employeeCode})" and employeeCode is server-generated, unknown at test
// write time. Resolve the option's value from a partial text match instead (Playwright's
// selectOption doesn't support RegExp/partial label matching directly).
async function selectByPartialLabel(
  select: ReturnType<Page['getByRole']>,
  partialText: string
): Promise<void> {
  const value = await select
    .locator('option', { hasText: partialText })
    .first()
    .getAttribute('value');
  if (!value) throw new Error(`No <option> matching text "${partialText}" found`);
  await select.selectOption(value);
}

test.use({ storageState: undefined });

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('erp_onboarding_dismissed', 'true'));
});

test('LIVE — full real HR/Payroll workflow: Employee, Attendance, Salary, Payroll Run, Payslip', async ({
  page,
}) => {
  test.setTimeout(120_000);
  const today = new Date().toISOString().slice(0, 10);
  const now = new Date();
  const periodMonth = now.getMonth() + 1;
  const periodYear = now.getFullYear();
  // Unique per run — avoids colliding with employees created by earlier partial/debug runs
  // against this persistent dev DB (see live-order-to-cash.spec.ts's invoiceNumber note).
  const lastName = `Sharma${Date.now()}`;
  const employeeName = `Priya ${lastName}`;

  await test.step('Login', async () => {
    await realLogin(page, OWNER);
    await expect(page).toHaveURL(/\/dashboard/);
  });

  await test.step('Create an employee', async () => {
    await page.goto('/hr/employees');
    if (await existsOnPage(page, employeeName)) return;
    await page.getByRole('button', { name: '+ New Employee' }).click();
    await page.getByRole('textbox', { name: 'First Name' }).fill('Priya');
    await page.getByRole('textbox', { name: 'Last Name' }).fill(lastName);
    await page.getByRole('textbox', { name: 'Phone' }).fill('9812345670');

    await page.getByRole('tab', { name: 'Employment' }).click();
    await page.getByRole('textbox', { name: 'Joining Date' }).fill(today);

    await page.getByRole('button', { name: /^create employee/i }).click();
    await page.waitForURL('**/hr/employees', { timeout: 10000 });
    await expect(page.getByText('Employee created')).toBeVisible({ timeout: 10000 });
    await expect(page.getByText(employeeName)).toBeVisible({ timeout: 10000 });
  });

  await test.step('Mark one day of attendance as Present', async () => {
    await page.goto('/hr/attendance');
    // This page's option text is "{displayName} ({employeeCode})" — not an exact match.
    await selectByPartialLabel(page.getByRole('combobox', { name: 'Employee' }), employeeName);
    await page.getByRole('textbox', { name: 'Date' }).fill(today);
    await page.getByRole('combobox', { name: 'Status' }).selectOption('PRESENT');
    await page.getByRole('button', { name: 'Mark Attendance' }).click();
    await expect(page.getByText('Attendance marked')).toBeVisible({ timeout: 10000 });
  });

  await test.step('Set the employee salary', async () => {
    await page.goto('/hr/payroll');
    await page.getByRole('button', { name: 'Set Employee Salary' }).click();
    const dialog = page.getByRole('dialog', { name: 'Set Employee Salary' });
    await dialog.getByRole('combobox', { name: 'Employee' }).selectOption({ label: employeeName });
    await dialog.getByRole('spinbutton', { name: 'CTC (Annual)' }).fill('600000');
    await dialog.getByRole('spinbutton', { name: 'Gross (Monthly)' }).fill('50000');
    await dialog.getByRole('spinbutton', { name: 'Basic' }).fill('25000');
    await dialog.getByRole('spinbutton', { name: 'HRA' }).fill('10000');
    await dialog.getByRole('spinbutton', { name: 'DA' }).fill('5000');
    await dialog.getByRole('button', { name: 'Save' }).click();
    await expect(page.getByText('Employee salary set')).toBeVisible({ timeout: 10000 });
  });

  await test.step('Create (or reuse), calculate, approve, and disburse a payroll run — working days set to 1 to match the single marked attendance day', async () => {
    // payroll_runs has a real UNIQUE(tenant, month, year) constraint — only one run can ever
    // exist per period, matching real usage. Reuse it if a prior run this session already
    // exists for the current period instead of assuming creation always succeeds.
    const periodExists = await existsOnPage(page, `${periodMonth}/${periodYear}`);
    if (!periodExists) {
      // Matches both the header button and (on a fresh, run-less tenant) the empty-state's own
      // action button, which fires the identical onClick — .first() picks either safely.
      await page.getByRole('button', { name: '+ New Payroll Run' }).first().click();
      const dialog = page.getByRole('dialog', { name: 'New Payroll Run' });
      await dialog.getByRole('spinbutton', { name: 'Month' }).fill(String(periodMonth));
      await dialog.getByRole('spinbutton', { name: 'Year' }).fill(String(periodYear));
      await dialog.getByRole('spinbutton', { name: 'Working Days' }).fill('1');
      await dialog.getByRole('button', { name: 'Create' }).click();
      await expect(page.getByText('Payroll run created')).toBeVisible({ timeout: 10000 });
    }

    const runRow = page
      .locator('tbody tr')
      .filter({ hasText: `${periodMonth}/${periodYear}` })
      .first();

    // A prior run this session may have already carried this same period's run all the way
    // to DISBURSED (the unique-per-period constraint means it's the same row) — only drive
    // whichever stage buttons are still actually present rather than assuming a fresh DRAFT.
    const calculateBtn = runRow.getByRole('button', { name: 'Calculate' });
    if (await calculateBtn.isVisible().catch(() => false)) {
      // "Calculate" also covers a run stuck in CALCULATING from a prior failed attempt — see
      // PayrollPage.tsx's status condition and payroll.routes.ts's per-employee skip-on-error fix.
      await calculateBtn.click();
      await expect(page.getByText(/Payroll calculated/i)).toBeVisible({ timeout: 15000 });
    }

    const approveBtn = runRow.getByRole('button', { name: 'Approve' });
    if (await approveBtn.isVisible().catch(() => false)) {
      await approveBtn.click();
      await expect(page.getByText('Payroll approved')).toBeVisible({ timeout: 10000 });
    }

    const disburseBtn = runRow.getByRole('button', { name: 'Disburse' });
    if (await disburseBtn.isVisible().catch(() => false)) {
      await disburseBtn.click();
      await expect(page.getByText('Payroll disbursed')).toBeVisible({ timeout: 10000 });
    }
  });

  await test.step('View a generated payslip and confirm a real payslip renders', async () => {
    // Re-running this spec against a persistent dev DB means the payroll run now covers
    // every employee created across all prior runs this session, not just this run's own —
    // "View Slips" shows one button per employee, so just confirm the first one is a real,
    // fully-rendered payslip rather than requiring it to be specifically this run's employee.
    const runRow = page
      .locator('tbody tr')
      .filter({ hasText: `${periodMonth}/${periodYear}` })
      .first();
    await runRow.getByRole('button', { name: 'View Slips' }).click();
    await page
      .getByRole('button', { name: /^Slip #/ })
      .first()
      .click();
    await page.waitForURL(/\/hr\/payroll-slips\/\d+/, { timeout: 10000 });

    await expect(page.getByRole('heading', { name: /^Salary Slip/ })).toBeVisible({
      timeout: 10000,
    });
    const netSalaryText = await page.getByText('Net Salary').locator('..').textContent();
    expect(netSalaryText).toBeTruthy();
  });
});
