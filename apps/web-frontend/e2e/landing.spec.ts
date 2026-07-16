import { test, expect } from '@playwright/test';
import { login } from './helpers.js';
import { PERMISSIONS } from '../src/constants/permissions.js';

test.describe('Public landing page (/)', () => {
  test('an unauthenticated visitor sees the marketing landing page, not a login redirect', async ({
    page,
  }) => {
    await page.goto('/');
    await expect(page).toHaveURL('/');
    await expect(
      page.getByRole('heading', { level: 1, name: /run your whole business/i })
    ).toBeVisible();
    await expect(page.getByRole('button', { name: /start free trial/i }).first()).toBeVisible();
  });

  test('"Sign In" in the landing nav goes to the login page', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: /^sign in$/i }).click();
    await expect(page).toHaveURL(/\/login/);
  });

  test('an authenticated user visiting / is redirected straight into the app, not shown the landing page', async ({
    page,
  }) => {
    await login(page, [PERMISSIONS.DASHBOARD_VIEW]);
    await page.goto('/');
    await expect(page).toHaveURL(/\/dashboard/);
  });
});

test.describe('Public marketing pages smoke', () => {
  for (const path of ['/pricing', '/features', '/about', '/contact']) {
    test(`${path} renders without redirecting to login`, async ({ page }) => {
      await page.goto(path);
      await expect(page).toHaveURL(path);
      await expect(page.locator('body')).not.toContainText(/unexpected application error/i);
    });
  }
});
