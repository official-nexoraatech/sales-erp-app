// Order-to-Cash deep-dive coverage for the Quotation lifecycle. Regression tests for two bugs
// found and fixed in this session:
//  1. `/sales/quotations/new` rendered InvoiceFormPage (title "New Invoice", posted to the
//     invoices endpoint) instead of a quotation-creation form — there was no way to create a
//     quotation through the UI at all. See QuotationFormPage.tsx.
//  2. QuotationService.convert() has always required status ACCEPTED, but no endpoint or UI
//     ever let a quotation reach ACCEPTED — SENT/VIEWED quotations were permanently stuck.
//     QuotationsPage.tsx also offered "Convert to Invoice" for SENT/VIEWED rows, which always
//     failed server-side. See accept()/reject() in QuotationService.ts + the routes/UI wiring.
//
// Runs against the mocked-API smoke tier (see helpers.ts) — same approach as
// global-search.spec.ts, no live backend required.
import { test, expect } from '@playwright/test';
import { login, mockJson } from './helpers.js';

// The onboarding checklist (Layout.tsx) is a fixed bottom-right panel shown to every
// fresh session until dismissed — it overlaps this page's bottom-right "Save as Draft"/action
// buttons in a real browser viewport. Pre-dismissing it here matches a real returning user
// and avoids flaky pointer-interception failures unrelated to what these tests assert.
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('erp_onboarding_dismissed', 'true'));
});

const DASHBOARD_VIEW = 'DASHBOARD_VIEW';
const INVOICE_VIEW = 'INVOICE_VIEW';
const INVOICE_CREATE = 'INVOICE_CREATE';
const QUOTATION_CONVERT = 'QUOTATION_CONVERT';

function quotationRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 1,
    quotationNumber: 'QT-1-1000',
    customerId: 42,
    status: 'SENT',
    grandTotal: '11800.00',
    validUntil: new Date(Date.now() + 5 * 86_400_000).toISOString(),
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

test.describe('Quotations list — status-gated row actions', () => {
  test('SENT/VIEWED rows offer Accept/Reject, not Convert to Invoice', async ({ page }) => {
    await login(page, [DASHBOARD_VIEW, INVOICE_VIEW, INVOICE_CREATE, QUOTATION_CONVERT]);

    await page.route('**/quotations?**', (route) =>
      mockJson(route, {
        content: [quotationRow({ status: 'SENT' })],
        totalElements: 1,
        page: 1,
        pageSize: 20,
      })
    );

    await page.goto('/sales/quotations');
    await expect(page.getByText('QT-1-1000')).toBeVisible();

    await page.getByRole('button', { name: 'More actions' }).click();
    const menu = page.getByRole('menu');
    await expect(menu.getByRole('menuitem', { name: 'Accept' })).toBeVisible();
    await expect(menu.getByRole('menuitem', { name: 'Reject' })).toBeVisible();
    await expect(menu.getByRole('menuitem', { name: 'Convert to Invoice' })).toHaveCount(0);
  });

  test('ACCEPTED rows offer Convert to Invoice, not Accept/Reject', async ({ page }) => {
    await login(page, [DASHBOARD_VIEW, INVOICE_VIEW, INVOICE_CREATE, QUOTATION_CONVERT]);

    await page.route('**/quotations?**', (route) =>
      mockJson(route, {
        content: [quotationRow({ status: 'ACCEPTED' })],
        totalElements: 1,
        page: 1,
        pageSize: 20,
      })
    );

    await page.goto('/sales/quotations');
    await page.getByRole('button', { name: 'More actions' }).click();
    const menu = page.getByRole('menu');
    await expect(menu.getByRole('menuitem', { name: 'Convert to Invoice' })).toBeVisible();
    await expect(menu.getByRole('menuitem', { name: 'Accept' })).toHaveCount(0);
    await expect(menu.getByRole('menuitem', { name: 'Reject' })).toHaveCount(0);
  });

  test('Accept action calls the accept endpoint and refreshes the row', async ({ page }) => {
    await login(page, [DASHBOARD_VIEW, INVOICE_VIEW, INVOICE_CREATE, QUOTATION_CONVERT]);

    let acceptCalled = false;
    await page.route('**/quotations?**', (route) =>
      mockJson(route, {
        content: [quotationRow({ status: acceptCalled ? 'ACCEPTED' : 'SENT' })],
        totalElements: 1,
        page: 1,
        pageSize: 20,
      })
    );
    await page.route('**/quotations/1/accept', (route) => {
      acceptCalled = true;
      return mockJson(route, { success: true });
    });

    await page.goto('/sales/quotations');
    await page.getByRole('button', { name: 'More actions' }).click();
    await page.getByRole('menuitem', { name: 'Accept' }).click();

    await expect.poll(() => acceptCalled).toBe(true);
    await expect(page.getByText('Quotation accepted')).toBeVisible();
  });
});

test.describe('Quotation detail — status-gated actions', () => {
  function detailPayload(status: string) {
    return {
      id: 1,
      quotationNumber: 'QT-1-1000',
      customerId: 42,
      status,
      validUntil: new Date(Date.now() + 5 * 86_400_000).toISOString(),
      createdAt: new Date().toISOString(),
      placeOfSupply: '27',
      subtotal: '10000.00',
      discountAmount: '0.00',
      taxableAmount: '10000.00',
      cgstAmount: '900.00',
      sgstAmount: '900.00',
      igstAmount: '0.00',
      grandTotal: '11800.00',
      lines: [],
    };
  }

  test('SENT quotation shows Accept and Reject, not Convert to Order', async ({ page }) => {
    await login(page, [DASHBOARD_VIEW, INVOICE_VIEW, INVOICE_CREATE, QUOTATION_CONVERT]);
    await page.route('**/api/v2/quotations/1', (route) => mockJson(route, detailPayload('SENT')));

    await page.goto('/sales/quotations/1');
    await expect(page.getByRole('button', { name: 'Accept' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Reject' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Convert to Order' })).toHaveCount(0);
  });

  test('ACCEPTED quotation shows Convert to Order, not Accept/Reject', async ({ page }) => {
    await login(page, [DASHBOARD_VIEW, INVOICE_VIEW, INVOICE_CREATE, QUOTATION_CONVERT]);
    await page.route('**/api/v2/quotations/1', (route) =>
      mockJson(route, detailPayload('ACCEPTED'))
    );

    await page.goto('/sales/quotations/1');
    await expect(page.getByRole('button', { name: 'Convert to Order' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Accept' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Reject' })).toHaveCount(0);
  });

  test('user without QUOTATION_CONVERT permission sees no Accept/Reject/Convert actions', async ({
    page,
  }) => {
    await login(page, [DASHBOARD_VIEW, INVOICE_VIEW, INVOICE_CREATE]);
    await page.route('**/api/v2/quotations/1', (route) => mockJson(route, detailPayload('SENT')));

    await page.goto('/sales/quotations/1');
    await expect(page.getByRole('heading', { name: 'QT-1-1000' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Accept' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Reject' })).toHaveCount(0);
  });
});

test.describe('Quotation creation', () => {
  test('"+ New Quotation" opens the quotation form, not the invoice form', async ({ page }) => {
    await login(page, [DASHBOARD_VIEW, INVOICE_VIEW, INVOICE_CREATE]);
    await page.route('**/quotations?**', (route) =>
      mockJson(route, { content: [], totalElements: 0, page: 1, pageSize: 20 })
    );

    await page.goto('/sales/quotations');
    await page.getByRole('button', { name: '+ New Quotation' }).click();
    await page.waitForURL('**/sales/quotations/new');

    await expect(page.getByText('New Quotation', { exact: true })).toBeVisible();
    await expect(page.getByText('Create a new customer quotation')).toBeVisible();
    await expect(page.getByLabel('Valid Until')).toBeVisible();
    await expect(page.getByText('New Invoice', { exact: true })).toHaveCount(0);
  });

  test('submitting without required fields shows a validation error and does not call the API', async ({
    page,
  }) => {
    await login(page, [DASHBOARD_VIEW, INVOICE_VIEW, INVOICE_CREATE]);

    let createCalled = false;
    await page.route('**/quotations', (route) => {
      if (route.request().method() === 'POST') createCalled = true;
      return mockJson(route, { id: 1, quotationNumber: 'QT-1-1000' }, 201);
    });

    await page.goto('/sales/quotations/new');
    await page.getByRole('button', { name: 'Save as Draft' }).click();

    await expect(
      page.getByText('Fill all required fields and add at least one item')
    ).toBeVisible();
    expect(createCalled).toBe(false);
  });
});
