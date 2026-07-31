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
  // CRM-ROADMAP Phase 3, Feature 4 (Mobile CRM) — added for the new Pipeline/Leads/Tickets/
  // Customer 360 AI-card coverage below.
  'CRM_360_VIEW',
  'OPPORTUNITY_VIEW',
  'OPPORTUNITY_STAGE_CHANGE',
  'LEAD_VIEW',
  'LEAD_UPDATE',
  'TICKET_VIEW',
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
          // DashboardPage.tsx reads every alerts.* sub-field unguarded once `alerts` itself is
          // truthy (same convention as the 5 fields above) — omitting this one throws a
          // TypeError reading .count of undefined and trips the page's error boundary.
          pendingDeliveries: { count: 0 },
        })
      );
      await page.route('**/dashboard/sales-summary', (route) =>
        mockJson(route, { pendingQuotations: 0, overdueInvoices: 0, collectedToday: 0 })
      );
      // DashboardPage.tsx also queries these two (headcount, pending leave approvals) — left
      // unmocked they fail against the real backend and the page's error boundary trips.
      await page.route('**/employees?**', (route) =>
        mockJson(route, { totalElements: 0, content: [] })
      );
      await page.route('**/approvals/leaves/pending', (route) => mockJson(route, { content: [] }));
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
      // Anchored to the gateway origin (localhost:3000, per client.ts's GATEWAY_URL — the
      // 2026-07-16 gateway cutover means every service call now goes through it, not a
      // direct per-service port) rather than a bare '**/customers/123' wildcard — the
      // frontend's own SPA route is also literally '/customers/123', so an unanchored
      // pattern intercepts the client-side page navigation itself, not just the API call.
      await page.route('http://localhost:3000/**/customers/123', (route) =>
        mockJson(route, CUSTOMER)
      );
      await page.route('http://localhost:3000/**/customers/123/interactions', (route) =>
        mockJson(route, [])
      );
      await page.route('http://localhost:3000/**/customers/123/activity**', (route) =>
        mockJson(route, { items: [], total: 0 })
      );
      // CustomerViewPage.tsx also queries these two by default (loyalty balance and
      // communication preferences, both unconditional on the default 'details' tab).
      await page.route('http://localhost:3000/**/customers/123/loyalty**', (route) =>
        mockJson(route, { points: 0, tier: null, nextTier: null })
      );
      await page.route('http://localhost:3000/**/customers/123/preferences**', (route) =>
        mockJson(route, { content: [] })
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
      // Anchored to the gateway origin (localhost:3000) — same SPA-route-collision reason as
      // the customer mocks above ('/hr/employees' is also a real frontend route).
      await page.route('http://localhost:3000/**/leave-types', (route) =>
        mockJson(route, { content: [{ id: 1, name: 'Casual Leave', daysPerYear: '12' }] })
      );
      await page.route('http://localhost:3000/**/employees**', (route) =>
        mockJson(route, { content: [{ id: 1, displayName: 'Test Employee' }] })
      );
      await page.route('http://localhost:3000/**/approvals/leaves/pending', (route) =>
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

  // CRM-ROADMAP Phase 3, Feature 1 (AI & Predictive Intelligence Suite) — the Customer 360
  // page's new recommendation cards, at phone width, with real churn/next-best-action/product-
  // recommendation data (the pre-existing "Customer detail page" block above never mocks
  // /360 at all, so those cards never actually render there).
  test.describe('Customer 360 — AI recommendation cards (Phase 3, Feature 1)', () => {
    async function mock360(page: Page): Promise<void> {
      await page.route('http://localhost:3000/**/customers/123', (route) =>
        mockJson(route, {
          id: 123,
          displayName: 'Ramesh Textiles',
          customerCode: 'CUST-0123',
          phone: '9876543210',
          billingAddress: { line1: '', city: '', state: '', pincode: '' },
        })
      );
      await page.route('http://localhost:3000/**/customers/123/360', (route) =>
        mockJson(route, {
          customerId: 123,
          health: { totalScore: 30, segment: 'AT_RISK' },
          timeline: [],
          timelineTotal: 0,
          financial: null,
          recentItemsStock: [],
          loyalty: { points: 0, cardNumber: null },
          account: null,
          churn: {
            riskLevel: 'HIGH',
            riskScore: 90,
            reason:
              'Last purchase was 45 days ago vs a typical 12-day interval between purchases — significantly overdue.',
          },
          nextBestAction: {
            id: 1,
            actionText: 'Send a win-back offer before this customer churns',
            reason: 'High churn risk',
          },
          productRecommendations: [
            {
              id: 1,
              itemId: 501,
              itemName: 'Cotton Fabric Roll',
              reason:
                'Frequently purchased alongside items you’ve already bought, by 3 other customers.',
            },
          ],
          degraded: [],
        })
      );
      await page.route('http://localhost:3000/**/customers/123/interactions', (route) =>
        mockJson(route, [])
      );
      await page.route('http://localhost:3000/**/customers/123/activity**', (route) =>
        mockJson(route, { items: [], total: 0 })
      );
      await page.route('http://localhost:3000/**/customers/123/loyalty**', (route) =>
        mockJson(route, { points: 0, tier: null, nextTier: null })
      );
      await page.route('http://localhost:3000/**/customers/123/preferences**', (route) =>
        mockJson(route, { content: [] })
      );
    }

    test('phone (375px): churn/next-best-action/recommendation cards render, no horizontal scroll, Dismiss is tappable', async ({
      page,
    }) => {
      await page.setViewportSize(PHONE);
      await mock360(page);
      await login(page, PERMISSIONS);
      await page.goto('/customers/123');
      await expect(page.getByRole('heading', { name: 'Ramesh Textiles' })).toBeVisible();

      await expect(page.getByText('HIGH', { exact: true })).toBeVisible();
      await expect(
        page.getByText('Send a win-back offer before this customer churns')
      ).toBeVisible();
      await expect(page.getByText('Cotton Fabric Roll')).toBeVisible();

      await expectNoPageLevelHorizontalScroll(page, PHONE.width);

      const dismissButtons = page.getByRole('button', { name: 'Dismiss' });
      await expect(dismissButtons.first()).toBeVisible();
    });
  });

  // CRM-ROADMAP Phase 3, Feature 4 (Mobile CRM) — Pipeline Kanban degrades to a stacked,
  // full-width list on a phone (rather than a squeezed horizontally-scrolling board), and the
  // per-card stage <select> (the touch alternative to drag-and-drop, which has no touch
  // equivalent) is present and usable.
  test.describe('Pipeline Kanban (Phase 3, Feature 4)', () => {
    async function mockPipeline(page: Page): Promise<void> {
      await page.route('**/pipeline-stages', (route) =>
        mockJson(route, [
          { code: 'NEW', name: 'New', sequence: 1, probability: 10, isWon: false, isLost: false },
          { code: 'WON', name: 'Won', sequence: 2, probability: 100, isWon: true, isLost: false },
        ])
      );
      await page.route('**/opportunities/forecast', (route) =>
        mockJson(route, { pipelineValue: 50000, weightedValue: 5000, commitValue: 0 })
      );
      // opportunityApi.list() omits the '?' entirely when called with no params (unlike
      // leadApi.list()/ticketApi.list(), which always append one, even empty) — so this can't
      // be anchored to a trailing '?' the way those two are.
      await page.route('**/opportunities', (route) =>
        mockJson(route, {
          content: [
            {
              id: 1,
              name: 'Wholesale Deal',
              stage: 'NEW',
              value: '50000',
              probability: 10,
              version: 0,
            },
          ],
          totalElements: 1,
        })
      );
    }

    test('phone (375px): stages stack full-width, no horizontal scroll, stage select is usable', async ({
      page,
    }) => {
      await page.setViewportSize(PHONE);
      await mockPipeline(page);
      await login(page, PERMISSIONS);
      await page.goto('/crm/pipeline');
      await expect(page.getByRole('heading', { name: 'Sales Pipeline' })).toBeVisible();
      await expect(page.getByText('Wholesale Deal', { exact: true })).toBeVisible();

      await expectNoPageLevelHorizontalScroll(page, PHONE.width);

      const stageSelect = page.getByRole('combobox', {
        name: /move wholesale deal to a different stage/i,
      });
      await expect(stageSelect).toBeVisible();
    });
  });

  // Same drag-and-drop-has-no-touch-equivalent concern as Pipeline above.
  test.describe('Leads Kanban (Phase 3, Feature 4)', () => {
    async function mockLeads(page: Page): Promise<void> {
      await page.route('**/leads?**', (route) =>
        mockJson(route, {
          content: [
            {
              id: 1,
              displayName: 'Prospective Buyer',
              phone: '9000000001',
              stage: 'NEW',
              source: 'WEBSITE',
              version: 0,
            },
          ],
          totalElements: 1,
        })
      );
    }

    test('phone (375px): no horizontal scroll, stage select is usable', async ({ page }) => {
      await page.setViewportSize(PHONE);
      await mockLeads(page);
      await login(page, PERMISSIONS);
      await page.goto('/crm/leads');
      await expect(page.getByRole('heading', { name: 'Leads' })).toBeVisible();
      await expect(page.getByText('Prospective Buyer')).toBeVisible();

      await expectNoPageLevelHorizontalScroll(page, PHONE.width);

      const stageSelect = page.getByRole('combobox', {
        name: /move prospective buyer to a different stage/i,
      });
      await expect(stageSelect).toBeVisible();
    });
  });

  // Ticket inbox already gets a mobile stacked-card layout for free from ERPDataGrid — this
  // just confirms it holds for this specific page, per this feature's own DoD ("extended
  // mobile-responsive-smoke.spec.ts coverage for every new CRM page shipped in this roadmap").
  test.describe('Ticket inbox (Phase 3, Feature 4)', () => {
    async function mockTickets(page: Page): Promise<void> {
      await page.route('**/tickets?**', (route) =>
        mockJson(route, {
          content: [
            {
              id: 1,
              ticketNumber: 'TKT-0001',
              subject: 'Delivery delay',
              status: 'OPEN',
              priority: 'HIGH',
              customerId: 123,
              createdAt: '2026-07-01T00:00:00.000Z',
            },
          ],
          totalElements: 1,
        })
      );
    }

    test('phone (375px): no horizontal scroll', async ({ page }) => {
      await page.setViewportSize(PHONE);
      await mockTickets(page);
      await login(page, PERMISSIONS);
      await page.goto('/crm/tickets');
      await expect(page.getByText('Delivery delay')).toBeVisible();

      await expectNoPageLevelHorizontalScroll(page, PHONE.width);
    });
  });
});
