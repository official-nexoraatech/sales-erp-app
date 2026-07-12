// Regression coverage for a bug found in this session's Order-to-Cash deep dive:
// InvoiceFormPage always posted `overrideCreditLimit`/`overridePriceFloor` as their default
// `false` — there was no checkbox or any other UI to set them true, so a manager holding
// CREDIT_LIMIT_OVERRIDE/PRICE_FLOOR_OVERRIDE had no way to complete a sale for a customer over
// their credit limit (or a line below its price floor) through the app at all, even though the
// backend (InvoiceService.confirm()) fully supports the override. See InvoiceFormPage.tsx.
import { test, expect } from '@playwright/test';
import { login, mockJson } from './helpers.js';

const DASHBOARD_VIEW = 'DASHBOARD_VIEW';
const INVOICE_VIEW = 'INVOICE_VIEW';
const INVOICE_CREATE = 'INVOICE_CREATE';
const CREDIT_LIMIT_OVERRIDE = 'CREDIT_LIMIT_OVERRIDE';
const PRICE_FLOOR_OVERRIDE = 'PRICE_FLOOR_OVERRIDE';
const ITEM_VIEW = 'ITEM_VIEW';
const BRANCH_VIEW = 'BRANCH_VIEW';
const WAREHOUSE_VIEW = 'WAREHOUSE_VIEW';

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('erp_onboarding_dismissed', 'true'));
});

test.describe('Invoice creation — credit limit / price floor override', () => {
  test('override checkboxes are hidden without the override permissions', async ({ page }) => {
    await login(page, [DASHBOARD_VIEW, INVOICE_VIEW, INVOICE_CREATE]);
    await page.goto('/sales/invoices/new');

    await expect(page.getByText('Override customer credit limit if exceeded')).toHaveCount(0);
    await expect(
      page.getByText('Override minimum sale price if a line is below floor')
    ).toHaveCount(0);
  });

  test('credit limit override checkbox shows for a holder of CREDIT_LIMIT_OVERRIDE and is off by default', async ({
    page,
  }) => {
    await login(page, [DASHBOARD_VIEW, INVOICE_VIEW, INVOICE_CREATE, CREDIT_LIMIT_OVERRIDE]);
    await page.goto('/sales/invoices/new');

    const checkbox = page.getByRole('checkbox', {
      name: 'Override customer credit limit if exceeded',
    });
    await expect(checkbox).toBeVisible();
    await expect(checkbox).not.toBeChecked();
    await expect(
      page.getByText('Override minimum sale price if a line is below floor')
    ).toHaveCount(0);
  });

  test('price floor override checkbox shows independently for a holder of PRICE_FLOOR_OVERRIDE', async ({
    page,
  }) => {
    await login(page, [DASHBOARD_VIEW, INVOICE_VIEW, INVOICE_CREATE, PRICE_FLOOR_OVERRIDE]);
    await page.goto('/sales/invoices/new');

    await expect(
      page.getByRole('checkbox', { name: 'Override minimum sale price if a line is below floor' })
    ).toBeVisible();
    await expect(page.getByText('Override customer credit limit if exceeded')).toHaveCount(0);
  });

  test('a credit-limit-exceeded error shows a friendly message naming the customer and limit', async ({
    page,
  }) => {
    await login(page, [
      DASHBOARD_VIEW,
      INVOICE_VIEW,
      INVOICE_CREATE,
      ITEM_VIEW,
      BRANCH_VIEW,
      WAREHOUSE_VIEW,
    ]);
    await page.route('**/api/v2/branches', (route) =>
      mockJson(route, { content: [{ id: 1, name: 'Main Branch' }], totalElements: 1 })
    );
    await page.route('**/api/v2/warehouses', (route) =>
      mockJson(route, { content: [{ id: 1, name: 'Main Warehouse' }], totalElements: 1 })
    );
    await page.route('**/search?**', (route) =>
      mockJson(route, {
        hits: [
          {
            id: 42,
            entity: 'customer',
            score: 9,
            source: { name: 'Ramesh Textiles', phone: '9876543210' },
          },
        ],
        total: 1,
        took: 5,
        query: 'ramesh',
      })
    );
    await page.route('**/api/v2/items?**', (route) =>
      mockJson(route, {
        content: [{ id: 7, name: 'Cotton Saree', gstRate: 5, hsnCode: '5407' }],
        totalElements: 1,
      })
    );
    await page.route('**/api/v2/invoices', (route) => {
      if (route.request().method() === 'OPTIONS') {
        return route.fulfill({
          status: 204,
          headers: {
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Methods': 'GET,POST,PUT,PATCH,DELETE,OPTIONS',
            'Access-Control-Allow-Headers': 'Content-Type,Authorization',
          },
        });
      }
      // apiClient reads the error envelope as `{ error: {...} }` at the top level — unlike
      // mockJson()'s success-path `{ data: ... }` wrapping, so this route fulfills directly.
      return route.fulfill({
        status: 422,
        headers: { 'Access-Control-Allow-Origin': '*' },
        contentType: 'application/json',
        body: JSON.stringify({
          error: {
            code: 'CREDIT_LIMIT_EXCEEDED',
            message: 'Credit limit exceeded',
            details: { limit: 50000, newBalance: 62000 },
          },
        }),
      });
    });

    await page.goto('/sales/invoices/new');
    await page.getByRole('combobox', { name: 'Customer' }).fill('ramesh');
    await page.getByRole('option', { name: /Ramesh Textiles/i }).click();
    await page.getByRole('combobox', { name: 'Branch' }).selectOption('1');
    await page.getByRole('combobox', { name: 'Warehouse' }).selectOption('1');

    await page.locator('input[placeholder="Search items to add..."]').fill('cotton');
    await page.getByRole('button', { name: /Cotton Saree/i }).click();

    await page.getByRole('button', { name: 'Save as Draft' }).click();
    await expect(
      page.getByText(/Ramesh Textiles would exceed their credit limit of.*62,000/)
    ).toBeVisible();
  });
});
