import { test, expect } from '@playwright/test';

test.describe('Pricing page (/pricing)', () => {
  test('renders the three real plans with their actual user/branch limits', async ({ page }) => {
    await page.goto('/pricing');
    await expect(
      page.getByRole('heading', { level: 1, name: /plans that grow with you/i })
    ).toBeVisible();

    await expect(page.getByRole('heading', { name: 'Starter' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Growth' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Enterprise' })).toBeVisible();

    // Real plan_entitlements numbers, not invented ones.
    await expect(page.getByText('5 users', { exact: true })).toBeVisible();
    await expect(page.getByText('1 branch', { exact: true })).toBeVisible();
    await expect(page.getByText('25 users', { exact: true })).toBeVisible();
    await expect(page.getByText('5 branches', { exact: true })).toBeVisible();
  });

  test('the comparison table shows feature availability per plan', async ({ page }) => {
    await page.goto('/pricing');
    await expect(page.getByRole('heading', { name: /compare plans in detail/i })).toBeVisible();
    await expect(page.getByRole('table')).toBeVisible();
    await expect(page.getByText('HR payroll')).toBeVisible();
  });
});
