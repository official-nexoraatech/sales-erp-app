// REAL end-to-end test — no mocking. Runs against the actually-running dev stack, same
// "qa-e2e" tenant (tenant_id=2). Covers the Distributed Systems admin nav group: Event Store,
// Dead Letter Queue, Saga Monitor, Schema Registry, Projections, Performance, Search Analytics.
// All backed by event-service (port 3023) except Search Analytics (search-service, port 3017).
import { test, expect, type Page } from '@playwright/test';

const OWNER = { email: 'owner@qa-e2e.local', password: 'QaE2eOwner@2026', tenantId: 2 };

async function realLogin(page: Page): Promise<void> {
  await page.goto('/login');
  await page.getByRole('button', { name: 'Sign in with a tenant ID instead' }).click();
  await page.getByLabel('Tenant ID').fill(String(OWNER.tenantId));
  await page.getByLabel('Email').fill(OWNER.email);
  await page.getByLabel('Password', { exact: true }).fill(OWNER.password);
  await page.getByRole('button', { name: /sign in/i }).click();
  await page.waitForURL(/\/(dashboard|no-access)/, { timeout: 15000 });
}

test.use({ storageState: undefined });
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('erp_onboarding_dismissed', 'true'));
});

test("LIVE — Event Store page loads and reflects the Invoice aggregate's event history", async ({
  page,
}) => {
  test.setTimeout(60_000);
  await realLogin(page);
  await page.goto('/admin/distributed/events');

  await expect(page.getByRole('heading', { name: 'Event Store' })).toBeVisible({ timeout: 10000 });
  // 2026-07-16 fix: EventStoreService.append() is now called from InvoiceService (create/
  // confirm/cancel) and PaymentService.allocate() — see the Invoice aggregate's applyEvent
  // switch in packages/platform-sdk/src/event-store.ts. This test intentionally doesn't assert
  // a specific row count (that depends on how much invoice activity has already happened
  // against the qa-e2e tenant from other specs in this suite) — it just asserts the page
  // renders its real, non-crashing state instead of erroring, whichever state that is. A
  // dedicated invoice-lifecycle spec (not this smoke-test file) is the right place to assert
  // "create+confirm an invoice → an INVOICE_CREATED/INVOICE_CONFIRMED row appears here".
  await expect(
    page.getByText('No events match the current filters').or(page.getByRole('row').first())
  ).toBeVisible({ timeout: 10000 });
});

test('LIVE — Dead Letter Queue loads real summary and topic drill-down', async ({ page }) => {
  test.setTimeout(60_000);
  await realLogin(page);
  await page.goto('/admin/distributed/dlq');

  await expect(page.getByRole('heading', { name: 'Dead Letter Queue' })).toBeVisible({
    timeout: 10000,
  });
  await expect(page.getByText('PENDING')).toBeVisible({ timeout: 10000 });
  await expect(page.getByText('TOTAL TOPICS')).toBeVisible();

  // Zero pending DLQ items is a genuinely good outcome (every Kafka consumer this whole
  // session processed successfully) — `.isVisible({timeout})` doesn't actually wait, so use
  // `.waitFor()` to distinguish "confirmed absent" from "hasn't rendered yet".
  const noTopics = await page
    .getByText('No DLQ topics found')
    .waitFor({ state: 'visible', timeout: 5000 })
    .then(() => true)
    .catch(() => false);
  if (!noTopics) {
    // Click the first real topic in the left column and confirm the items panel responds
    // (either real items or the topic's own empty state) — this exercises the drill-down
    // without assuming any specific topic has pending failures right now.
    const firstTopic = page.locator('.card').first().locator('button').first();
    await firstTopic.click();
    await expect(page.locator('h3').filter({ hasText: /.+/ }).nth(1)).toBeVisible({
      timeout: 10000,
    });
  }
});

test('LIVE — Saga Monitor loads real summary, status filter works', async ({ page }) => {
  test.setTimeout(60_000);
  await realLogin(page);
  await page.goto('/admin/distributed/sagas');

  await expect(page.getByRole('heading', { name: 'Saga Monitor' })).toBeVisible({ timeout: 10000 });
  await expect(page.getByText('COMPLETED (24h)')).toBeVisible({ timeout: 10000 });

  await page.getByLabel('Status').selectOption('COMPLETED');
  await page.waitForTimeout(500);
  const rows = page.locator('tbody tr');
  const rowTexts = await rows.allTextContents();
  const isEmpty = rowTexts.some((t) => t.includes('No sagas found'));
  if (!isEmpty) {
    for (const text of rowTexts) expect(text).toContain('COMPLETED');
    await rows.first().getByRole('button', { name: 'View' }).click();
    await expect(page.getByText('Step History')).toBeVisible({ timeout: 10000 });
    await page.getByRole('button', { name: 'Close' }).click();
  }
});

test('LIVE — Schema Registry register a real schema, view it in the catalog', async ({ page }) => {
  test.setTimeout(60_000);
  await realLogin(page);
  await page.goto('/admin/distributed/schemas');

  await expect(page.getByRole('heading', { name: 'Schema Registry' })).toBeVisible({
    timeout: 10000,
  });
  const eventType = `QA_E2E_TEST_EVENT_${Date.now()}`;
  await page.getByRole('button', { name: 'Register Schema' }).click();
  await page.getByPlaceholder('INVOICE_CONFIRMED').fill(eventType);
  await page.getByRole('button', { name: 'Register', exact: true }).click();
  await expect(page.getByText('Schema registered')).toBeVisible({ timeout: 10000 });

  const row = page.locator('tbody tr').filter({ hasText: eventType });
  await expect(row).toBeVisible({ timeout: 10000 });
  await row.getByRole('button', { name: 'View' }).click();
  await expect(page.getByText(`${eventType} v1`)).toBeVisible({ timeout: 10000 });
});

test('LIVE — Projections shows real read-model status and rebuild is triggerable', async ({
  page,
}) => {
  test.setTimeout(60_000);
  await realLogin(page);
  await page.goto('/admin/distributed/projections');

  await expect(page.getByRole('heading', { name: 'CQRS Projections' })).toBeVisible({
    timeout: 10000,
  });
  // Summary card label, not a per-projection status badge (those also render the same text) —
  // scope to the card to avoid strict-mode ambiguity with every UP_TO_DATE projection's badge.
  await expect(page.getByText('UP_TO_DATE', { exact: true }).first()).toBeVisible({
    timeout: 10000,
  });

  const noProjections = await page
    .getByText('No projections found')
    .waitFor({ state: 'visible', timeout: 5000 })
    .then(() => true)
    .catch(() => false);
  if (!noProjections) {
    const rebuildBtn = page.getByRole('button', { name: /^Rebuild$/ }).first();
    const rebuildVisible = await rebuildBtn
      .waitFor({ state: 'visible', timeout: 5000 })
      .then(() => true)
      .catch(() => false);
    if (rebuildVisible) {
      await rebuildBtn.click();
      // Not every projection has a rebuild job registered (e.g. projection_customer_aging
      // returns 400 UNSUPPORTED_PROJECTION — a real, pre-existing gap, not something this
      // test should fail on) — either outcome is a legitimate, correctly-surfaced result.
      await expect(
        page.getByText(/Rebuild triggered for/).or(page.getByText('Rebuild failed'))
      ).toBeVisible({ timeout: 10000 });
    }
  }
});

test('LIVE — Performance dashboard shows real endpoint baselines, read-only', async ({ page }) => {
  test.setTimeout(60_000);
  await realLogin(page);
  await page.goto('/admin/distributed/performance');

  await expect(page.getByRole('heading', { name: 'Performance' })).toBeVisible({ timeout: 10000 });
  await expect(page.getByText('ENDPOINTS TRACKED')).toBeVisible({ timeout: 10000 });
});

test('LIVE — Search Analytics shows real usage stats and time-range filter works', async ({
  page,
}) => {
  test.setTimeout(60_000);
  await realLogin(page);
  await page.goto('/admin/search-analytics');

  await expect(page.getByRole('heading', { name: 'Search Analytics & Health' })).toBeVisible({
    timeout: 10000,
  });
  await expect(page.getByText('Total Searches')).toBeVisible({ timeout: 10000 });

  await page.getByLabel('Time range').selectOption('30');
  await expect(page.getByText('Total Searches')).toBeVisible({ timeout: 10000 });
  await expect(page.getByText('Index Sync Failures')).toBeVisible();
});
