// Shared helpers for the mocked-API Playwright smoke tier. Extracted from
// global-search.spec.ts (this repo's first Playwright suite) once a second spec
// (mobile-responsive-smoke.spec.ts) needed the same login/mocking plumbing — see that
// file's original header comment for the full rationale behind each gotcha below.
import type { Route, Page } from '@playwright/test';

export function fakeJwt(payload: Record<string, unknown>): string {
  const b64 = (obj: unknown) => Buffer.from(JSON.stringify(obj)).toString('base64');
  return `${b64({ alg: 'RS256', typ: 'JWT' })}.${b64(payload)}.unsigned-test-signature`;
}

// The dev server (localhost:5173) and the mocked services (localhost:3010/3017) are different
// origins, so every POST with a JSON body triggers a real CORS preflight (OPTIONS) before the
// browser will send it — this must be answered, and the actual response needs an
// Access-Control-Allow-Origin header, or the browser blocks it as a network error before our
// mock body is ever seen by application code. apiClient (client.ts) also unwraps every
// response as `data.data`, so payloads must be wrapped accordingly.
export async function mockJson(route: Route, data: unknown, status = 200): Promise<void> {
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

export async function login(page: Page, permissions: string[]): Promise<void> {
  const accessToken = fakeJwt({ sub: '1', tenantId: 1, roles: ['OWNER'], permissions });

  await page.route('**/auth/login', (route) =>
    mockJson(route, { accessToken, refreshToken: 'fake-refresh-token' })
  );
  await page.route('**/users/me', (route) =>
    mockJson(route, {
      id: 1,
      tenantId: 1,
      email: 'owner@example.com',
      firstName: 'Test',
      lastName: 'Owner',
    })
  );
  await page.route('**/saved-searches', (route) =>
    mockJson(route, { content: [], totalElements: 0 })
  );

  // Layout.tsx fires these on every authenticated page (organization branding, notification
  // badge/stream) regardless of which permissions a test grants. Left unmocked they 401 against
  // the real backend, which trips apiClient's blanket 401 -> /auth/refresh -> (also 401) ->
  // force-logout path and silently bounces the page back to /login mid-test. Fast tests can
  // finish before that cascade completes, but it's a real flake risk for any test — mocked here
  // for every login() caller rather than per-spec.
  await page.route('**/organization', (route) => mockJson(route, { orgName: 'Test Org' }));
  await page.route('**/notifications/unread-count', (route) => mockJson(route, { count: 0 }));
  await page.route('**/notifications/stream**', (route) =>
    route.fulfill({ status: 200, contentType: 'text/event-stream', body: '' })
  );

  await page.goto('/login');
  await page.getByRole('button', { name: 'Sign in with a tenant ID instead' }).click();
  await page.getByLabel('Tenant ID').fill('1');
  await page.getByLabel('Email').fill('owner@example.com');
  await page.getByLabel('Password', { exact: true }).fill('correct-horse-battery-staple');
  await page.getByRole('button', { name: /sign in|log in/i }).click();
  await page.waitForURL('**/dashboard');
}
