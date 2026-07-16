// REAL end-to-end test — no mocking. Runs against the actually-running dev stack, same
// "qa-e2e" tenant (tenant_id=2). Covers the Security nav group: Security Audit Log
// (impersonation/2FA/session events) and Audit Logs (business-entity change history).
// This session alone has generated plenty of real audit data (user creates/locks, branch/
// warehouse edits, 2FA enrollment) to assert against without seeding anything extra.
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

test('LIVE — Security Audit Log shows real events and the action filter works', async ({
  page,
}) => {
  test.setTimeout(60_000);
  await realLogin(page);
  await page.goto('/admin/security-audit-log');

  await expect(page.getByRole('heading', { name: 'Security Audit Log' })).toBeVisible({
    timeout: 10000,
  });
  await expect(page.locator('tbody tr').first()).toBeVisible({ timeout: 10000 });
  const unfilteredCount = await page.locator('tbody tr').count();
  expect(unfilteredCount).toBeGreaterThan(0);

  // This session never terminated a session or completed a real 2FA enrollment (see
  // live-settings.spec.ts's Security Settings test — deliberately left MFA unconfirmed to
  // avoid locking the shared QA account out of every other test's login), so there's no
  // guaranteed real data for any specific action type. Assert the filter mechanism itself
  // works: it must produce either a real subset that all match, or a genuine empty state —
  // never a stale/unfiltered list.
  await page.getByLabel('Action Type').selectOption('SESSION_TERMINATED');
  await page.waitForTimeout(500);
  const rows = page.locator('tbody tr');
  const rowTexts = await rows.allTextContents();
  const isEmptyState = rowTexts.some((t) => t.includes('No audit log entries'));
  if (!isEmptyState) {
    for (const text of rowTexts) expect(text).toContain('SESSION_TERMINATED');
  } else {
    expect(rowTexts.length).toBe(1);
  }
});

test('LIVE — Audit Logs shows real business-entity changes with before/after expand', async ({
  page,
}) => {
  test.setTimeout(60_000);
  await realLogin(page);
  await page.goto('/admin/audit-logs');

  await expect(page.getByRole('heading', { name: 'Audit Log' })).toBeVisible({ timeout: 10000 });
  await expect(page.locator('tbody tr').first()).toBeVisible({ timeout: 10000 });

  const firstRow = page.locator('tbody tr').first();
  await firstRow.click();
  await expect(page.getByText(/before/i).first()).toBeVisible({ timeout: 10000 });
  await expect(page.getByText(/after/i).first()).toBeVisible({ timeout: 10000 });

  await page.getByLabel('Entity Type').selectOption('customer');
  await page.waitForTimeout(500);
  const rows = page.locator('tbody tr');
  const rowCount = await rows.count();
  if (rowCount > 0) {
    const rowTexts = await rows.allTextContents();
    for (const text of rowTexts) expect(text.toLowerCase()).toContain('customer');
  }
});
