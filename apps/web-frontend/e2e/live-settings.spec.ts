// REAL end-to-end test — no mocking. Runs against the actually-running dev stack, same
// "qa-e2e" tenant (tenant_id=2). Covers the Settings nav group: Organization, Branches,
// Warehouses, Users, SSO Config, Security Settings (2FA entry point + Sessions), Feature Flags.
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

test('LIVE — Organization Settings save, real update persisted', async ({ page }) => {
  test.setTimeout(60_000);
  await realLogin(page);
  await page.goto('/settings/organization');

  await expect(page.getByRole('heading', { name: 'Organization Settings' })).toBeVisible({
    timeout: 10000,
  });
  const legalName = `QA E2E Legal Name ${Date.now()}`;
  await page.getByLabel('Legal Name').fill(legalName);
  await page.getByRole('button', { name: 'Save Changes' }).click();
  await expect(page.getByText('Organization updated')).toBeVisible({ timeout: 10000 });

  await page.reload();
  await expect(page.getByLabel('Legal Name')).toHaveValue(legalName, { timeout: 10000 });
});

test('LIVE — Branch create, edit and delete, real DB row', async ({ page }) => {
  test.setTimeout(60_000);
  await realLogin(page);
  await page.goto('/settings/branches');

  const code = `QAB${Date.now().toString().slice(-6)}`;
  await page.getByRole('button', { name: '+ New Branch' }).click();
  await page.getByLabel('Branch Name').fill('QA E2E Branch');
  // Playwright's getByLabel({exact:true}) matches the <label>'s raw textContent, which
  // includes the aria-hidden required-asterisk span ("Code*") — so exact:true never matches
  // literal "Code". getByRole computes the real accessible name (asterisk correctly excluded
  // per the aria-hidden spec), so use that instead when disambiguating from "PIN Code".
  await page.getByRole('textbox', { name: 'Code', exact: true }).fill(code);
  await page.getByLabel('Address Line 1').fill('123 QA Street');
  await page.getByLabel('City').fill('Mumbai');
  await page.getByLabel('State').fill('Maharashtra');
  await page.getByLabel('PIN Code').fill('400001');
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByText('Branch created')).toBeVisible({ timeout: 10000 });

  const row = page.locator('tbody tr').filter({ hasText: code });
  await expect(row).toBeVisible({ timeout: 10000 });

  await row.getByRole('button', { name: 'More actions' }).click();
  await page.getByRole('menuitem', { name: 'Edit' }).click();
  await page.getByLabel('Branch Name').fill('QA E2E Branch Renamed');
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByText('Branch updated')).toBeVisible({ timeout: 10000 });

  const renamedRow = page.locator('tbody tr').filter({ hasText: code });
  await renamedRow.getByRole('button', { name: 'More actions' }).click();
  await page.getByRole('menuitem', { name: 'Delete' }).click();
  await page
    .getByRole('dialog', { name: 'Delete Branch' })
    .getByRole('button', { name: 'Delete' })
    .click();
  await expect(page.getByText('Branch deleted')).toBeVisible({ timeout: 10000 });
  await expect(page.locator('tbody tr').filter({ hasText: code })).not.toBeVisible({
    timeout: 10000,
  });
});

test('LIVE — Warehouse create, edit and delete, real DB row', async ({ page }) => {
  test.setTimeout(60_000);
  await realLogin(page);
  await page.goto('/settings/warehouses');

  const code = `QAW${Date.now().toString().slice(-6)}`;
  await page.getByRole('button', { name: '+ New Warehouse' }).click();
  await page.getByLabel('Name').fill('QA E2E Warehouse');
  await page.getByRole('textbox', { name: 'Code', exact: true }).fill(code);
  await page.getByLabel('Branch').selectOption({ index: 1 });
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByText('Saved')).toBeVisible({ timeout: 10000 });

  const row = page.locator('tbody tr').filter({ hasText: code });
  await expect(row).toBeVisible({ timeout: 10000 });

  await row.getByRole('button', { name: 'More actions' }).click();
  await page.getByRole('menuitem', { name: 'Edit' }).click();
  await page.getByLabel('Name').fill('QA E2E Warehouse Renamed');
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByText('Saved')).toBeVisible({ timeout: 10000 });

  const renamedRow = page.locator('tbody tr').filter({ hasText: code });
  await renamedRow.getByRole('button', { name: 'More actions' }).click();
  await page.getByRole('menuitem', { name: 'Delete' }).click();
  await page
    .getByRole('dialog', { name: 'Delete Warehouse' })
    .getByRole('button', { name: 'Delete' })
    .click();
  await expect(page.getByText('Deleted')).toBeVisible({ timeout: 10000 });
  await expect(page.locator('tbody tr').filter({ hasText: code })).not.toBeVisible({
    timeout: 10000,
  });
});

test('LIVE — User create, then lock/unlock, real record', async ({ page }) => {
  test.setTimeout(60_000);
  await realLogin(page);
  await page.goto('/users/new');

  const email = `qa-e2e-user-${Date.now()}@example.com`;
  await page.getByLabel('First Name').fill('QA');
  await page.getByLabel('Last Name').fill('E2EUser');
  await page.getByRole('textbox', { name: 'Email', exact: true }).fill(email);
  await page.locator('input[type="password"]').fill('QaE2eTestUser@2026');
  await page.getByLabel('Role').selectOption({ index: 1 });
  await page.getByRole('button', { name: 'Create User' }).click();
  await page.waitForURL('**/users', { timeout: 10000 });

  const row = page.locator('tbody tr').filter({ hasText: email });
  await expect(row).toBeVisible({ timeout: 10000 });

  await row.getByRole('button', { name: 'More actions' }).click();
  await page.getByRole('menuitem', { name: 'Lock' }).click();
  await expect(page.getByText(/user locked|locked successfully/i).first()).toBeVisible({
    timeout: 10000,
  });
  await expect(row.getByText('Locked')).toBeVisible({ timeout: 10000 });

  await row.getByRole('button', { name: 'More actions' }).click();
  await page.getByRole('menuitem', { name: 'Unlock' }).click();
  await expect(page.getByText(/user unlocked|unlocked successfully/i).first()).toBeVisible({
    timeout: 10000,
  });
});

test('LIVE — SSO Config save and remove, real DB row', async ({ page }) => {
  test.setTimeout(60_000);
  await realLogin(page);
  await page.goto('/settings/sso');

  await expect(page.getByRole('heading', { name: /sso/i })).toBeVisible({ timeout: 10000 });
  await page.getByLabel('Issuer URL').fill('https://qa-e2e.okta.com');
  await page.getByLabel('Client ID').fill('qa-e2e-client-id');
  await page.getByLabel('Client Secret').fill('qa-e2e-client-secret-value');
  await page.getByRole('button', { name: 'Save Changes' }).click();
  await expect(page.getByText('SSO configuration saved')).toBeVisible({ timeout: 10000 });

  await page.reload();
  await expect(page.getByLabel('Issuer URL')).toHaveValue('https://qa-e2e.okta.com', {
    timeout: 10000,
  });

  page.once('dialog', (dialog) => dialog.accept());
  await page.getByRole('button', { name: 'Remove SSO' }).click();
  await expect(page.getByText('SSO configuration removed')).toBeVisible({ timeout: 10000 });
});

test('LIVE — Security Settings: 2FA enrollment shows real QR + backup codes, Sessions list is real', async ({
  page,
}) => {
  test.setTimeout(60_000);
  await realLogin(page);
  await page.goto('/security');

  await expect(page.getByRole('heading', { name: 'Security Settings' })).toBeVisible({
    timeout: 10000,
  });
  // Deliberately do NOT confirm enrollment here — this is the shared QA owner account used by
  // every other test in this suite; completing 2FA would require every future realLogin() in
  // this session to pass a TOTP challenge it doesn't implement, breaking the whole suite.
  // enrollTOTP() only writes a pending secret (totpEnabled stays false until confirm), so this
  // is safe to exercise without side effects. Confirm/disable/login-with-2FA server logic is
  // covered by apps/auth-service/src/__tests__/mfa.test.ts (18/18 passing).
  await page.getByRole('button', { name: 'Enable 2FA' }).click();
  await expect(page.getByAltText('2FA QR code')).toBeVisible({ timeout: 10000 });
  await expect(page.getByText(/backup codes/i)).toBeVisible();

  await page.goto('/security');
  await expect(page.getByRole('heading', { name: 'Active Sessions' })).toBeVisible({
    timeout: 10000,
  });
  await expect(page.locator('.divide-y > div').first()).toBeVisible({ timeout: 10000 });
});

test('LIVE — Feature Flags toggle, real persisted state', async ({ page }) => {
  test.setTimeout(60_000);
  await realLogin(page);
  await page.goto('/admin/feature-flags');

  await expect(page.getByRole('heading', { name: /feature flags/i })).toBeVisible({
    timeout: 10000,
  });
  const toggle = page.getByRole('switch').first();
  const before = await toggle.getAttribute('aria-checked');
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-checked', before === 'true' ? 'false' : 'true', {
    timeout: 10000,
  });

  // Flip it back so the run is idempotent across reruns.
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-checked', before ?? 'false', { timeout: 10000 });
});
