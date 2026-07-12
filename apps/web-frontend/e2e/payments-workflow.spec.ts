// Regression coverage for a bug found in this session's Order-to-Cash deep dive: clicking
// "Record Payment" on InvoiceDetailPage navigates to /sales/payments?invoiceId=X, but
// PaymentsPage only ever read that param to decide whether to auto-open the modal — the
// customer, amount, and the eventual payment were never actually linked back to that invoice,
// silently dropping the context. Fixed by prefilling customer/amount from the invoice and
// auto-allocating the new payment to it. See PaymentsPage.tsx.
import { test, expect } from '@playwright/test';
import { login, mockJson } from './helpers.js';

const DASHBOARD_VIEW = 'DASHBOARD_VIEW';
const PAYMENT_VIEW = 'PAYMENT_VIEW';
const PAYMENT_CREATE = 'PAYMENT_CREATE';

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('erp_onboarding_dismissed', 'true'));
});

test.describe('Record Payment from an invoice', () => {
  test('prefills customer and balance due, then allocates the payment to that invoice on submit', async ({
    page,
  }) => {
    await login(page, [DASHBOARD_VIEW, PAYMENT_VIEW, PAYMENT_CREATE]);

    await page.route('**/api/v2/invoices/5', (route) =>
      mockJson(route, { id: 5, invoiceNumber: 'INV-1-5', customerId: 42, balanceDue: '3500.00' })
    );
    await page.route('**/api/v2/payments?**', (route) =>
      mockJson(route, { content: [], totalElements: 0, page: 1, pageSize: 20 })
    );
    await page.route('**/api/v2/customers?**', (route) =>
      mockJson(route, {
        content: [{ id: 42, displayName: 'Ramesh Textiles' }],
        totalElements: 1,
        page: 1,
        size: 20,
      })
    );

    let createBody: Record<string, unknown> | null = null;
    let allocateBody: Record<string, unknown> | null = null;
    let allocatedPaymentId: number | null = null;
    await page.route('**/api/v2/payments', (route) => {
      createBody = route.request().postDataJSON();
      return mockJson(route, { id: 99, paymentNumber: 'PAY-1-99' }, 201);
    });
    await page.route('**/api/v2/payments/99/allocate', (route) => {
      allocatedPaymentId = 99;
      allocateBody = route.request().postDataJSON();
      return mockJson(route, { success: true });
    });

    await page.goto('/sales/payments?invoiceId=5');

    const dialog = page.getByRole('dialog', { name: 'Record Payment' });
    await expect(dialog.getByRole('spinbutton', { name: 'Amount' })).toHaveValue('3500.00');
    await expect(dialog.getByRole('combobox', { name: 'Customer' })).toHaveValue('42');

    await dialog.getByRole('button', { name: 'Record Payment' }).click();

    await expect.poll(() => allocatedPaymentId).toBe(99);
    expect(createBody).toMatchObject({ customerId: 42, amount: 3500 });
    expect(allocateBody).toEqual({ allocations: [{ invoiceId: 5, amount: 3500 }] });
    await expect(page.getByText('Payment recorded and allocated to invoice')).toBeVisible();
    await page.waitForURL('**/sales/invoices/5');
  });
});
