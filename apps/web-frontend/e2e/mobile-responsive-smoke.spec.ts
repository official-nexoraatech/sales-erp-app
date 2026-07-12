// PG-053 mobile responsiveness smoke checks — verifies the Priority-1 pages this audit
// targeted (dashboard, a detail/view page, an approval-workflow page) render without
// page-level horizontal scroll at phone (375px) and tablet (820px) widths, and that the
// key interactive elements (mobile nav toggle, primary content) stay visible/clickable.
// This is a smoke-level regression guard, not full visual-regression testing — see
// ERP-PLANNING/production-gap-prompts/014-Web/49-mobile-responsiveness-audit.md.
//
// login()/mockJson() live in ./helpers.ts — see that file (and global-search.spec.ts's
// original header comment) for why CORS preflight handling and the {data: ...} envelope
// are both required to mock this app's API from Playwright.
import { test, expect, type Page } from '@playwright/test';
import { login, mockJson } from './helpers.js';

const PERMISSIONS = [
  'DASHBOARD_VIEW',
  'CUSTOMER_VIEW',
  'CRM_INTERACTION_VIEW',
  'CUSTOMER_EDIT',
  'EMPLOYEE_VIEW',
  'LEAVE_VIEW',
  'LEAVE_APPROVE',
];

async function expectNoPageLevelHorizontalScroll(page: Page, viewportWidth: number): Promise<void> {
  const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
  // A couple of px of slack for scrollbar/rounding quirks across browsers.
  expect(scrollWidth).toBeLessThanOrEqual(viewportWidth + 2);
}

const PHONE = { width: 375, height: 812 };
const TABLET = { width: 820, height: 1180 };

test.describe('Mobile/tablet responsiveness smoke checks (PG-053)', () => {
  test.describe('Dashboard', () => {
    async function mockDashboard(page: Page): Promise<void> {
      await page.route('**/api/v2/dashboard/kpis', (route) =>
        mockJson(route, {
          today: {
            today_sales: 0,
            today_collection: 0,
            today_purchase: 0,
            today_expense: 0,
            month_sales: 0,
            month_collection: 0,
            month_profit: 0,
            month_invoices: 0,
          },
          balances: { total_receivable: 0, total_payable: 0 },
        })
      );
      await page.route('**/api/v2/dashboard/charts', (route) =>
        mockJson(route, {
          salesTrend: [],
          salesByCategory: [],
          paymentModes: [],
          stockByCategory: [],
          monthlyComparison: { current_sales: 0, prev_sales: 0, current_profit: 0, prev_profit: 0 },
          topCustomers: [],
          receivablesAgeing: [],
          purchaseTrend: [],
        })
      );
      await page.route('**/api/v2/dashboard/alerts', (route) =>
        mockJson(route, {
          lowStock: { count: 0 },
          overdueReceivables: { count: 0, total_amount: 0 },
          pendingPurchaseOrders: { count: 0 },
          pendingGRNs: { count: 0 },
          overduePayables: { count: 0, total_amount: 0 },
        })
      );
      await page.route('**/dashboard/sales-summary', (route) =>
        mockJson(route, { pendingQuotations: 0, overdueInvoices: 0, collectedToday: 0 })
      );
    }

    test('phone (375px): no horizontal scroll, mobile nav toggle visible and clickable', async ({
      page,
    }) => {
      await page.setViewportSize(PHONE);
      await mockDashboard(page);
      await login(page, PERMISSIONS);
      await expect(page.getByRole('heading', { name: /dashboard/i })).toBeVisible();

      await expectNoPageLevelHorizontalScroll(page, PHONE.width);

      const navToggle = page.getByRole('button', { name: 'Open navigation menu' });
      await expect(navToggle).toBeVisible();
      await navToggle.click();
      await expect(page.getByRole('button', { name: 'Close navigation menu' })).toBeVisible();
    });

    test('tablet (820px): no horizontal scroll', async ({ page }) => {
      await page.setViewportSize(TABLET);
      await mockDashboard(page);
      await login(page, PERMISSIONS);
      await expect(page.getByRole('heading', { name: /dashboard/i })).toBeVisible();

      await expectNoPageLevelHorizontalScroll(page, TABLET.width);
    });
  });

  test.describe('Customer detail page (representative detail/view page)', () => {
    const CUSTOMER = {
      id: 123,
      displayName: 'Ramesh Textiles',
      customerCode: 'CUST-0123',
      phone: '9876543210',
      email: 'ramesh@example.com',
      gstin: '27AAAAA0000A1Z5',
      pan: 'AAAAA0000A',
      customerType: 'RETAIL',
      dateOfBirth: null,
      status: 'ACTIVE',
      loyaltyCardNumber: 'LC-001',
      creditLimit: 50000,
      creditDays: 30,
      loyaltyPoints: 120,
      openingBalance: 0,
      billingAddress: { line1: '', city: '', state: '', pincode: '' },
      healthScore: 80,
      healthSegment: 'HEALTHY',
    };

    async function mockCustomer(page: Page): Promise<void> {
      // Anchored to the sales-service origin (localhost:3013) rather than a bare '**/customers/123'
      // wildcard — the frontend's own SPA route is also literally '/customers/123', so an
      // unanchored pattern intercepts the client-side page navigation itself, not just the API call.
      await page.route('http://localhost:3013/**/customers/123', (route) =>
        mockJson(route, CUSTOMER)
      );
      await page.route('http://localhost:3013/**/customers/123/interactions', (route) =>
        mockJson(route, [])
      );
      await page.route('http://localhost:3013/**/customers/123/activity**', (route) =>
        mockJson(route, { items: [], total: 0 })
      );
    }

    test('phone (375px): no horizontal scroll', async ({ page }) => {
      await page.setViewportSize(PHONE);
      await mockCustomer(page);
      await login(page, PERMISSIONS);
      await page.goto('/customers/123');
      await expect(page.getByRole('heading', { name: 'Ramesh Textiles' })).toBeVisible();

      await expectNoPageLevelHorizontalScroll(page, PHONE.width);
    });

    test('tablet (820px): no horizontal scroll', async ({ page }) => {
      await page.setViewportSize(TABLET);
      await mockCustomer(page);
      await login(page, PERMISSIONS);
      await page.goto('/customers/123');
      await expect(page.getByRole('heading', { name: 'Ramesh Textiles' })).toBeVisible();

      await expectNoPageLevelHorizontalScroll(page, TABLET.width);
    });
  });

  test.describe('Leave approvals (representative approval-workflow page)', () => {
    async function mockLeaves(page: Page): Promise<void> {
      // Anchored to the hr-service origin (localhost:3021) — same SPA-route-collision reason as
      // the customer mocks above ('/hr/employees' is also a real frontend route).
      await page.route('http://localhost:3021/**/leave-types', (route) =>
        mockJson(route, { content: [{ id: 1, name: 'Casual Leave', daysPerYear: '12' }] })
      );
      await page.route('http://localhost:3021/**/employees**', (route) =>
        mockJson(route, { content: [{ id: 1, displayName: 'Test Employee' }] })
      );
      await page.route('http://localhost:3021/**/approvals/leaves/pending', (route) =>
        mockJson(route, {
          content: [
            {
              id: 1,
              employeeId: 1,
              leaveTypeId: 1,
              startDate: '2026-07-15',
              endDate: '2026-07-16',
              days: '2',
              status: 'PENDING',
              reason: 'Personal',
            },
          ],
        })
      );
    }

    test('phone (375px): no horizontal scroll, approve action visible and clickable', async ({
      page,
    }) => {
      await page.setViewportSize(PHONE);
      await mockLeaves(page);
      await login(page, PERMISSIONS);
      await page.goto('/hr/leaves');
      await expect(page.getByRole('heading', { name: /leave management/i })).toBeVisible();

      await expectNoPageLevelHorizontalScroll(page, PHONE.width);

      const approveButton = page.getByRole('button', { name: /approve/i }).first();
      await expect(approveButton).toBeVisible();
    });

    test('tablet (820px): no horizontal scroll', async ({ page }) => {
      await page.setViewportSize(TABLET);
      await mockLeaves(page);
      await login(page, PERMISSIONS);
      await page.goto('/hr/leaves');
      await expect(page.getByRole('heading', { name: /leave management/i })).toBeVisible();

      await expectNoPageLevelHorizontalScroll(page, TABLET.width);
    });
  });
});
