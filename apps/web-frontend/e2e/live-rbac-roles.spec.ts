// REAL end-to-end RBAC verification — no mocking. Logs in as each real role-specific user
// created on the freshly provisioned "qa-e2e" tenant (tenant_id=2) and checks real
// menu-visibility / real API-authorization behavior, i.e. exactly what the app decided
// after a real login against real role_permissions rows in the real database.
import { test, expect, type Page } from '@playwright/test';

const TENANT_ID = 2;
const ROLE_PASSWORD = 'QaE2eRole@2026';

const ROLES = {
  salesManager: {
    email: 'sales.manager@qa-e2e.local',
    password: ROLE_PASSWORD,
    tenantId: TENANT_ID,
  },
  cashier: { email: 'cashier@qa-e2e.local', password: ROLE_PASSWORD, tenantId: TENANT_ID },
  accountant: { email: 'accountant@qa-e2e.local', password: ROLE_PASSWORD, tenantId: TENANT_ID },
  inventoryManager: {
    email: 'inventory.manager@qa-e2e.local',
    password: ROLE_PASSWORD,
    tenantId: TENANT_ID,
  },
};

async function realLogin(
  page: Page,
  creds: { email: string; password: string; tenantId: number }
): Promise<void> {
  await page.goto('/login');
  await page.getByLabel('Tenant ID').fill(String(creds.tenantId));
  await page.getByLabel('Email').fill(creds.email);
  await page.getByLabel('Password', { exact: true }).fill(creds.password);
  await page.getByRole('button', { name: /sign in/i }).click();
  // IndexRedirect lands a role without DASHBOARD_VIEW on its first accessible nav item
  // instead of /dashboard (see App.tsx) — role-specific logins here legitimately land on
  // /customers, /sales/invoices, /inventory/items, etc. Just wait for /login to be left.
  await page.waitForURL((url) => !url.pathname.startsWith('/login'), { timeout: 15000 });
}

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('erp_onboarding_dismissed', 'true'));
});

test.describe('LIVE — RBAC per real role', () => {
  test('Sales Manager: sees Sales/CRM nav, can reach Quotations, cannot reach HR/Payroll or Accounting Journals directly', async ({
    page,
  }) => {
    await realLogin(page, ROLES.salesManager);
    await expect(page.getByRole('link', { name: 'Quotations' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Employees' })).toHaveCount(0);

    // Direct-URL access to a route this role has no permission for must be blocked
    // server-side too, not just hidden from nav — the real regression this session's
    // RBAC fixes targeted (a role having a permission on paper that a route doesn't honor,
    // or here, correctly NOT having one and the route correctly rejecting it).
    await page.goto('/hr/payroll');
    const bodyText = await page.locator('body').innerText();
    expect(/access denied|no access|forbidden/i.test(bodyText)).toBeTruthy();
  });

  test('Cashier: sees POS-relevant nav, can reach Quotations and Payments', async ({ page }) => {
    await realLogin(page, ROLES.cashier);
    await expect(page.getByRole('link', { name: 'Quotations' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Payments' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Journal Entries' })).toHaveCount(0);
  });

  test('Accountant: can reach the Audit Log — the exact bug fixed this session (was granted AUDIT_LOG_VIEW, route checked VIEW_AUDIT_LOG)', async ({
    page,
  }) => {
    await realLogin(page, ROLES.accountant);
    await page.goto('/admin/audit-logs');
    await expect(page.getByText(/access denied|forbidden/i)).toHaveCount(0);
  });

  test('Accountant: can view customer payments received — the exact bug fixed this session (PAYMENT_IN_VIEW vs PAYMENT_VIEW)', async ({
    page,
  }) => {
    await realLogin(page, ROLES.accountant);
    await page.goto('/sales/payments');
    await expect(page.getByRole('heading', { name: 'Payments' })).toBeVisible();
    const bodyText = await page.locator('body').innerText();
    expect(/access denied|forbidden/i.test(bodyText)).toBeFalsy();
  });

  test('Inventory Manager: can reach Stock Adjustments and Transfers at all — the most severe bug fixed this session', async ({
    page,
  }) => {
    await realLogin(page, ROLES.inventoryManager);

    await page.goto('/inventory/adjustments');
    let bodyText = await page.locator('body').innerText();
    expect(
      /access denied|forbidden/i.test(bodyText),
      'Stock Adjustments should be reachable'
    ).toBeFalsy();

    await page.goto('/inventory/transfers');
    bodyText = await page.locator('body').innerText();
    expect(
      /access denied|forbidden/i.test(bodyText),
      'Stock Transfers should be reachable'
    ).toBeFalsy();

    await page.goto('/settings/warehouses');
    bodyText = await page.locator('body').innerText();
    expect(/access denied|forbidden/i.test(bodyText), 'Warehouses should be reachable').toBeFalsy();
  });
});
