// Regression coverage for a bug flagged (but left unfixed) in an earlier PG-037 session and
// confirmed still live at the start of this QA pass: JournalsPage.tsx's "+ Manual Journal"
// button navigated to /accounting/journals/new, but no <Route> for that path (or a detail page
// at /accounting/journals/:id) was ever registered in App.tsx, and no form component existed —
// both were dead links. The backend (POST /journals, GET /journals/:id, POST
// /journals/:id/reverse) was already fully implemented. See JournalFormPage.tsx /
// JournalDetailPage.tsx.
import { test, expect } from '@playwright/test';
import { login, mockJson } from './helpers.js';

const DASHBOARD_VIEW = 'DASHBOARD_VIEW';
const JOURNAL_VIEW = 'JOURNAL_VIEW';
const JOURNAL_CREATE = 'JOURNAL_CREATE';
const CANCEL_POSTED_JOURNAL = 'CANCEL_POSTED_JOURNAL';

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('erp_onboarding_dismissed', 'true'));
});

test.describe('Manual journal creation', () => {
  test('"+ Manual Journal" opens a real form, not a dead route', async ({ page }) => {
    await login(page, [DASHBOARD_VIEW, JOURNAL_VIEW, JOURNAL_CREATE]);
    await page.route('**/api/v2/journals?**', (route) =>
      mockJson(route, { content: [], totalElements: 0, page: 0, size: 20 })
    );
    await page.route('**/api/v2/accounts', (route) => mockJson(route, { content: [] }));
    await page.route('**/api/v2/cost-centers', (route) => mockJson(route, []));

    await page.goto('/accounting/journals');
    await page.getByRole('button', { name: '+ Manual Journal' }).first().click();
    await page.waitForURL('**/accounting/journals/new');

    await expect(page.getByText('New Manual Journal', { exact: true })).toBeVisible();
    await expect(page.getByRole('textbox', { name: 'Description' })).toBeVisible();
  });

  test('an unbalanced journal cannot be posted', async ({ page }) => {
    await login(page, [DASHBOARD_VIEW, JOURNAL_VIEW, JOURNAL_CREATE]);
    await page.route('**/api/v2/accounts', (route) =>
      mockJson(route, {
        content: [
          { id: 1, accountCode: '1000', name: 'Cash' },
          { id: 2, accountCode: '4000', name: 'Sales' },
        ],
      })
    );
    await page.route('**/api/v2/cost-centers', (route) => mockJson(route, []));

    let createCalled = false;
    await page.route('**/api/v2/journals', (route) => {
      if (route.request().method() === 'POST') createCalled = true;
      return mockJson(route, { journalId: 'J1' }, 201);
    });

    await page.goto('/accounting/journals/new');
    await page.getByRole('textbox', { name: 'Description' }).fill('Test entry');

    const rows = page.locator('tbody tr');
    await rows.nth(0).locator('select').first().selectOption('1');
    await rows.nth(0).locator('input[type="number"]').first().fill('100');
    await rows.nth(1).locator('select').first().selectOption('2');
    await rows.nth(1).locator('input[type="number"]').nth(1).fill('50');

    await expect(page.getByText('Unbalanced')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Post Journal' })).toBeDisabled();
    expect(createCalled).toBe(false);
  });

  test('a balanced journal posts and navigates to the detail page', async ({ page }) => {
    await login(page, [DASHBOARD_VIEW, JOURNAL_VIEW, JOURNAL_CREATE]);
    await page.route('**/api/v2/accounts', (route) =>
      mockJson(route, {
        content: [
          { id: 1, accountCode: '1000', name: 'Cash' },
          { id: 2, accountCode: '4000', name: 'Sales' },
        ],
      })
    );
    await page.route('**/api/v2/cost-centers', (route) => mockJson(route, []));

    let createBody: Record<string, unknown> | null = null;
    await page.route('**/api/v2/journals', (route) => {
      if (route.request().method() === 'POST') createBody = route.request().postDataJSON();
      return mockJson(route, { journalId: 'J1' }, 201);
    });
    await page.route('**/api/v2/journals/J1', (route) =>
      mockJson(route, {
        journalId: 'J1',
        description: 'Test entry',
        status: 'POSTED',
        isReversal: false,
        postedAt: new Date().toISOString(),
        createdAt: new Date().toISOString(),
        lines: [
          {
            id: 1,
            accountId: 1,
            accountCode: '1000',
            accountName: 'Cash',
            debitAmount: '100.00',
            creditAmount: '0.00',
          },
          {
            id: 2,
            accountId: 2,
            accountCode: '4000',
            accountName: 'Sales',
            debitAmount: '0.00',
            creditAmount: '100.00',
          },
        ],
      })
    );

    await page.goto('/accounting/journals/new');
    await page.getByRole('textbox', { name: 'Description' }).fill('Test entry');

    const rows = page.locator('tbody tr');
    await rows.nth(0).locator('select').first().selectOption('1');
    await rows.nth(0).locator('input[type="number"]').first().fill('100');
    await rows.nth(1).locator('select').first().selectOption('2');
    await rows.nth(1).locator('input[type="number"]').nth(1).fill('100');

    await expect(page.getByText('Balanced', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Post Journal' }).click();

    await expect.poll(() => createBody).not.toBeNull();
    await page.waitForURL('**/accounting/journals/J1');
    await expect(page.getByRole('heading', { name: 'J1' })).toBeVisible();
  });
});

test.describe('Journal detail — reverse action', () => {
  function detailPayload(status: string, isReversal = false) {
    return {
      journalId: 'J1',
      description: 'Test entry',
      status,
      isReversal,
      postedAt: new Date().toISOString(),
      createdAt: new Date().toISOString(),
      lines: [
        {
          id: 1,
          accountId: 1,
          accountCode: '1000',
          accountName: 'Cash',
          debitAmount: '100.00',
          creditAmount: '0.00',
        },
        {
          id: 2,
          accountId: 2,
          accountCode: '4000',
          accountName: 'Sales',
          debitAmount: '0.00',
          creditAmount: '100.00',
        },
      ],
    };
  }

  test('POSTED journal shows Reverse to a holder of CANCEL_POSTED_JOURNAL', async ({ page }) => {
    await login(page, [DASHBOARD_VIEW, JOURNAL_VIEW, CANCEL_POSTED_JOURNAL]);
    await page.route('**/api/v2/journals/J1', (route) => mockJson(route, detailPayload('POSTED')));

    await page.goto('/accounting/journals/J1');
    await expect(page.getByRole('button', { name: 'Reverse' })).toBeVisible();
  });

  test('REVERSED journal does not show Reverse', async ({ page }) => {
    await login(page, [DASHBOARD_VIEW, JOURNAL_VIEW, CANCEL_POSTED_JOURNAL]);
    await page.route('**/api/v2/journals/J1', (route) =>
      mockJson(route, detailPayload('REVERSED'))
    );

    await page.goto('/accounting/journals/J1');
    await expect(page.getByRole('button', { name: 'Reverse' })).toHaveCount(0);
  });

  test('user without CANCEL_POSTED_JOURNAL does not see Reverse on a POSTED journal', async ({
    page,
  }) => {
    await login(page, [DASHBOARD_VIEW, JOURNAL_VIEW]);
    await page.route('**/api/v2/journals/J1', (route) => mockJson(route, detailPayload('POSTED')));

    await page.goto('/accounting/journals/J1');
    await expect(page.getByRole('heading', { name: 'J1' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Reverse' })).toHaveCount(0);
  });
});
