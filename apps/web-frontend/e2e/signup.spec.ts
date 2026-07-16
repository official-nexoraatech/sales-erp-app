import { test, expect, type Page } from '@playwright/test';
import { fakeJwt, mockJson } from './helpers.js';

const FORM = {
  name: 'Acme Textiles',
  slug: 'acme-textiles-e2e',
  contactEmail: 'owner@acme-textiles-e2e.example',
  adminFirstName: 'Ada',
  adminLastName: 'Lovelace',
  adminPassword: 'supersecurepassword123',
};

async function fillSignupForm(page: Page) {
  await page.goto('/signup');
  await page.getByLabel(/organization name/i).fill(FORM.name);
  await page.getByLabel(/workspace url/i).fill(FORM.slug);
  await page.getByLabel(/your work email/i).fill(FORM.contactEmail);
  await page.getByLabel(/first name/i).fill(FORM.adminFirstName);
  await page.getByLabel(/last name/i).fill(FORM.adminLastName);
  await page.getByLabel(/^password$/i).fill(FORM.adminPassword);
}

test.describe('Self-serve signup (/signup)', () => {
  test('creates a workspace, logs the new admin in, and lands in the dashboard', async ({
    page,
  }) => {
    const accessToken = fakeJwt({
      sub: '1',
      tenantId: 42,
      roles: ['OWNER'],
      permissions: ['DASHBOARD_VIEW'],
    });

    await page.route('**/public/signup', (route) =>
      mockJson(route, { tenantId: 42, adminUserId: 1, adminEmail: FORM.contactEmail }, 201)
    );
    await page.route('**/auth/login', (route) =>
      mockJson(route, { accessToken, refreshToken: 'fake-refresh-token' })
    );
    await page.route('**/users/me', (route) =>
      mockJson(route, {
        id: 1,
        tenantId: 42,
        email: FORM.contactEmail,
        firstName: FORM.adminFirstName,
        lastName: FORM.adminLastName,
      })
    );
    await page.route('**/organization', (route) => mockJson(route, { orgName: FORM.name }));
    await page.route('**/notifications/unread-count', (route) => mockJson(route, { count: 0 }));
    await page.route('**/notifications/stream**', (route) =>
      route.fulfill({ status: 200, contentType: 'text/event-stream', body: '' })
    );
    await page.route('**/saved-searches', (route) =>
      mockJson(route, { content: [], totalElements: 0 })
    );

    await fillSignupForm(page);
    await page.getByRole('button', { name: /create workspace/i }).click();

    await page.waitForURL('**/dashboard');
    await expect(page).toHaveURL(/\/dashboard/);
  });

  test('shows a clear error when the workspace URL is already taken', async ({ page }) => {
    await page.route('**/public/signup', (route) =>
      route.fulfill({
        status: 409,
        headers: { 'Access-Control-Allow-Origin': '*' },
        json: {
          error: {
            code: 'DUPLICATE_TENANT',
            message: 'A workspace with this URL or email already exists',
          },
        },
      })
    );

    await fillSignupForm(page);
    await page.getByRole('button', { name: /create workspace/i }).click();

    await expect(page.getByText(/already exists/i)).toBeVisible();
    await expect(page).toHaveURL('/signup');
  });

  test('validates required fields client-side before calling the API', async ({ page }) => {
    let called = false;
    await page.route('**/public/signup', (route) => {
      called = true;
      return mockJson(route, {});
    });

    await page.goto('/signup');
    await page.getByRole('button', { name: /create workspace/i }).click();

    await expect(page.getByText(/organization name is required/i)).toBeVisible();
    expect(called).toBe(false);
  });
});
