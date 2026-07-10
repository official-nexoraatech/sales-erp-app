// Phase 9 smoke suite for Enterprise Global Search. This is the first Playwright test
// anywhere in this repo — scoped deliberately narrow per the approved plan: prove the palette
// really opens via the documented shortcut, really calls the search endpoint, and really
// navigates on selection. It runs against the real Vite dev server with the auth/search
// network calls mocked at the HTTP boundary (page.route) rather than a live backend — there
// is no docker-compose'd Postgres/Elasticsearch/Kafka stack in CI for this suite to hit, and a
// true end-to-end run belongs in a separate, full-stack integration pipeline, not this smoke
// test. What's still "real" here: DOM rendering, the Ctrl+K hook, debounced query state,
// TanStack Query, and react-router navigation.
import { test, expect, type Route, type Page } from '@playwright/test';

const SEARCH_GLOBAL = 'SEARCH_GLOBAL';
const DASHBOARD_VIEW = 'DASHBOARD_VIEW';

function fakeJwt(payload: Record<string, unknown>): string {
  const b64 = (obj: unknown) => Buffer.from(JSON.stringify(obj)).toString('base64');
  return `${b64({ alg: 'RS256', typ: 'JWT' })}.${b64(payload)}.unsigned-test-signature`;
}

// The dev server (localhost:5173) and the mocked services (localhost:3010/3017) are different
// origins, so every POST with a JSON body triggers a real CORS preflight (OPTIONS) before the
// browser will send it — this must be answered, and the actual response needs an
// Access-Control-Allow-Origin header, or the browser blocks it as a network error before our
// mock body is ever seen by application code. apiClient (client.ts) also unwraps every
// response as `data.data`, so payloads must be wrapped accordingly.
async function mockJson(route: Route, data: unknown, status = 200): Promise<void> {
  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET,POST,PUT,PATCH,DELETE,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type,Authorization',
  };
  if (route.request().method() === 'OPTIONS') {
    await route.fulfill({ status: 204, headers: corsHeaders });
    return;
  }
  await route.fulfill({ status, headers: corsHeaders, json: { data } });
}

async function login(page: Page): Promise<void> {
  const accessToken = fakeJwt({ sub: '1', tenantId: 1, roles: ['OWNER'], permissions: [DASHBOARD_VIEW, SEARCH_GLOBAL] });

  await page.route('**/auth/login', (route) => mockJson(route, { accessToken, refreshToken: 'fake-refresh-token' }));
  await page.route('**/users/me', (route) =>
    mockJson(route, { id: 1, tenantId: 1, email: 'owner@example.com', firstName: 'Test', lastName: 'Owner' })
  );
  await page.route('**/saved-searches', (route) => mockJson(route, { content: [], totalElements: 0 }));

  await page.goto('/login');
  await page.getByLabel('Tenant ID').fill('1');
  await page.getByLabel('Email').fill('owner@example.com');
  await page.getByLabel('Password', { exact: true }).fill('correct-horse-battery-staple');
  await page.getByRole('button', { name: /sign in|log in/i }).click();
  await page.waitForURL('**/dashboard');
}

test.describe('Global search command palette', () => {
  test('Ctrl+K opens the palette, searching calls the search API, and selecting a result navigates there', async ({ page }) => {
    await login(page);

    let capturedQuery: string | null = null;
    await page.route('**/search?**', (route) => {
      capturedQuery = new URL(route.request().url()).searchParams.get('q');
      return mockJson(route, {
        hits: [
          {
            id: '123',
            entity: 'customer',
            score: 9.4,
            source: { name: 'Ramesh Textiles', phone: '9876543210' },
          },
        ],
        total: 1,
        took: 12,
        query: capturedQuery ?? '',
      });
    });

    // The login form's submit button is still focused right after the redirect, and the
    // Ctrl+K keydown doesn't reach the document-level listener from that stale focus target —
    // clicking a plain, non-interactive element first reproduces the focus state a real user
    // would be in (having already clicked somewhere on the page).
    await page.getByText('Test Owner').click();
    await page.keyboard.press('Control+K');
    const dialog = page.getByRole('dialog', { name: 'Global search' });
    await expect(dialog).toBeVisible();

    // ERPCommandPalette moves focus into the search input via a deferred setTimeout(0) rather
    // than synchronously on open — waiting for that focus (as a real user implicitly would,
    // by watching for the cursor) avoids a race where a following keypress fires before the
    // panel's onKeyDown scope has a focused descendant to bubble through.
    const searchInput = page.getByLabel('Search', { exact: true });
    await expect(searchInput).toBeFocused();
    await searchInput.fill('ramesh');
    await expect.poll(() => capturedQuery).toBe('ramesh');

    const resultRow = dialog.getByRole('button', { name: /Ramesh Textiles/i });
    await expect(resultRow).toBeVisible();
    await resultRow.click();

    await expect(dialog).not.toBeVisible();
    await page.waitForURL('**/customers/123');
  });

  test('Escape closes the palette without navigating', async ({ page }) => {
    await login(page);

    await page.getByText('Test Owner').click();
    await page.keyboard.press('Control+K');
    const dialog = page.getByRole('dialog', { name: 'Global search' });
    await expect(dialog).toBeVisible();
    await expect(page.getByLabel('Search', { exact: true })).toBeFocused();

    await page.keyboard.press('Escape');
    await expect(dialog).not.toBeVisible();
    expect(page.url()).toContain('/dashboard');
  });
});
