// REAL end-to-end tests — no mocking. Runs against the actually-running dev stack (web-frontend
// on :5173, all backend services including automation-service/ai-copilot-service, real
// Postgres/Kafka) using the "qa-e2e" tenant (tenant_id=2) that already exists for this
// codebase's live-* spec tier. Exercises the three new enterprise engines (Business Rules,
// Workflow Automation, AI Copilot) plus WorkflowEngine's approval-chain UI (My Approvals) as
// real business workflows, not mocked API boundaries — see enterprise-engines.spec.ts for the
// mocked-boundary tier covering the same pages' basic rendering/interaction.
import { test, expect, type Page, type APIRequestContext } from '@playwright/test';

const GATEWAY_URL = 'http://localhost:3000';
const OWNER = { email: 'owner@qa-e2e.local', password: 'QaE2eOwner@2026', tenantId: 2 };
const SALES_MANAGER = {
  email: 'sales.manager@qa-e2e.local',
  password: 'QaE2eRole@2026',
  tenantId: 2,
};

async function realLogin(
  page: Page,
  creds: { email: string; password: string; tenantId: number }
): Promise<void> {
  await page.goto('/login');
  await page.getByRole('button', { name: 'Sign in with a tenant ID instead' }).click();
  await page.getByLabel('Tenant ID').fill(String(creds.tenantId));
  await page.getByLabel('Email').fill(creds.email);
  await page.getByLabel('Password', { exact: true }).fill(creds.password);
  await page.getByRole('button', { name: /sign in/i }).click();
  // Post-login lands on the first nav item the role actually has permission for (see
  // LoginPage.tsx's getFirstAccessiblePath) — not always /dashboard (e.g. SALES_MANAGER
  // lacks DASHBOARD_VIEW and lands on /copilot instead). Wait for navigation away from
  // /login rather than assuming a specific destination.
  await page.waitForURL((url) => !url.pathname.startsWith('/login'), { timeout: 15000 });
}

// Direct gateway login (bypasses the UI) to get a bearer token for API-level setup work
// (creating a high-value invoice) — the frontend's own token lives in an in-memory store, not
// something a separate page.request context can reuse.
async function apiLogin(
  request: APIRequestContext,
  creds: { email: string; password: string; tenantId: number }
): Promise<string> {
  const res = await request.post(`${GATEWAY_URL}/api/auth/auth/login`, {
    data: { email: creds.email, password: creds.password, tenantId: creds.tenantId },
  });
  expect(res.ok()).toBe(true);
  const body = (await res.json()) as { data: { accessToken: string } };
  return body.data.accessToken;
}

test.use({ storageState: undefined });

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('erp_onboarding_dismissed', 'true'));
});

test('LIVE — Business Rules Engine: seeded rules visible, create + simulate a custom rule', async ({
  page,
}) => {
  test.setTimeout(60_000);
  const uniqueName = `QA Playwright Rule ${Date.now()}`;

  await realLogin(page, OWNER);
  await page.goto('/settings/rules');

  // The seeded system template fixed earlier this session (see rule-engine.ts's
  // SYSTEM_RULE_TEMPLATES) must actually be visible and marked SYSTEM.
  await expect(page.getByText('Block sale above credit limit')).toBeVisible({ timeout: 10000 });

  await page.getByRole('button', { name: 'New Rule' }).click();
  await page.getByLabel('Name').fill(uniqueName);
  await page.getByLabel('Entity Type').fill('SALE');
  await page.getByLabel('Event Type').fill('SALE_CREATE');
  await page.locator('input[placeholder="field (e.g. isOverCreditLimit)"]').fill('testFlag');
  await page.locator('input[placeholder="value"]').fill('true');
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByText('Rule saved')).toBeVisible({ timeout: 10000 });

  // Re-select the just-created rule (save clears selection) and simulate it against a REAL
  // boolean (as invoice data would actually shape it), not a string — the condition's value
  // field is a plain text Input (RulesPage.tsx has no type picker), so it was saved as the
  // STRING "true". Regression test for a real bug found via this exact live test: RuleEngine's
  // EQUALS previously used bare `==`, and `true == "true"` is `false` in JS, so no rule authored
  // through this UI could ever match a boolean field — fixed with explicit boolean<->"true"/
  // "false" string normalization in evaluateCondition (see rule-engine.ts's looseEquals).
  await page.getByText(uniqueName, { exact: true }).click();
  await page.locator('textarea[placeholder*="isOverCreditLimit"]').fill('{"testFlag": true}');
  await page.getByRole('button', { name: 'Run Simulation' }).click();
  await expect(page.getByText('MATCHED', { exact: true })).toBeVisible({ timeout: 10000 });
});

test('LIVE — Workflow Automation Engine: create, manually trigger, and see a COMPLETED execution', async ({
  page,
}) => {
  test.setTimeout(60_000);
  const uniqueName = `QA Playwright Automation ${Date.now()}`;
  const uniqueEvent = `QA_PLAYWRIGHT_EVENT_${Date.now()}`;

  await realLogin(page, OWNER);
  await page.goto('/settings/automation');

  await page.getByRole('button', { name: 'New Automation' }).click();
  await page.getByLabel('Name').fill(uniqueName);
  await page.getByLabel('Trigger Event').fill(uniqueEvent);
  await page.getByLabel('Entity Type').fill('QaPlaywrightEntity');
  // Default first step is a CONDITION node with no conditions (matches ALWAYS) — leave as-is
  // so "Trigger Now" runs the chain straight through to COMPLETED.
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByText('Automation saved')).toBeVisible({ timeout: 10000 });

  await page.getByText(uniqueName, { exact: true }).click();
  await page.getByRole('button', { name: 'Trigger Now' }).click();
  await expect(page.getByText('Triggered')).toBeVisible({ timeout: 10000 });

  await expect(page.getByText('COMPLETED').first()).toBeVisible({ timeout: 15000 });
});

test('LIVE — AI Copilot: sending a message surfaces a clear, actionable error (not a hang or a raw crash)', async ({
  page,
}) => {
  test.setTimeout(60_000);

  await realLogin(page, OWNER);
  await page.goto('/copilot');

  await page
    .getByPlaceholder('Ask a question, or ask for a draft…')
    .fill('show my recent invoices');
  await page.getByRole('button', { name: 'Send' }).click();

  // No ANTHROPIC_API_KEY is configured in this dev environment — the fix applied this session
  // (ClaudeOrchestrator throwing a BusinessError instead of a plain Error) means the real,
  // specific reason surfaces here instead of a generic "An unexpected error occurred".
  await expect(page.getByText(/ANTHROPIC_API_KEY/i)).toBeVisible({ timeout: 15000 });
});

test('LIVE — real approval-chain workflow: a high-value invoice routes to Sales Manager for sign-off, then unblocks confirm', async ({
  page,
  request,
}) => {
  test.setTimeout(60_000);

  let invoiceId = 0;
  await test.step('Create a high-value invoice via the API (as Owner) — crosses the ₹50,000 WorkflowEngine threshold', async () => {
    const token = await apiLogin(request, OWNER);
    const now = new Date().toISOString();
    const due = new Date(Date.now() + 7 * 86400000).toISOString();
    const res = await request.post(`${GATEWAY_URL}/api/sales/invoices`, {
      headers: { Authorization: `Bearer ${token}` },
      data: {
        customerId: 1,
        branchId: 1,
        warehouseId: 12,
        placeOfSupply: 'MH',
        sellerStateCode: 'MH',
        invoiceDate: now,
        dueDate: due,
        lines: [{ itemId: 1, quantity: 55, unitPrice: 1000, gstRate: 5 }],
        overridePriceFloor: true,
      },
    });
    expect(res.status()).toBe(201);
    const body = (await res.json()) as { data: { id: number } };
    invoiceId = body.data.id;

    const confirmRes = await request.post(
      `${GATEWAY_URL}/api/sales/invoices/${invoiceId}/confirm`,
      {
        headers: { Authorization: `Bearer ${token}` },
      }
    );
    expect(confirmRes.status()).toBe(422);
    const confirmBody = (await confirmRes.json()) as { error: { code: string } };
    expect(confirmBody.error.code).toBe('APPROVAL_PENDING');
  });

  await test.step('Sales Manager sees and approves it in My Approvals', async () => {
    await realLogin(page, SALES_MANAGER);
    await page.goto('/my-approvals');

    const row = page.getByText(`Invoice #${invoiceId}`, { exact: false });
    await expect(row).toBeVisible({ timeout: 15000 });
    await row.click();

    await page.getByRole('button', { name: 'Approve' }).click();
    await page
      .getByRole('dialog', { name: 'Approve this item?' })
      .getByRole('button', { name: 'Approve' })
      .click();
    await expect(page.getByText('Approved')).toBeVisible({ timeout: 10000 });
  });

  await test.step('Owner can now confirm the invoice', async () => {
    const token = await apiLogin(request, OWNER);
    const confirmRes = await request.post(
      `${GATEWAY_URL}/api/sales/invoices/${invoiceId}/confirm`,
      {
        headers: { Authorization: `Bearer ${token}` },
      }
    );
    expect(confirmRes.status()).toBe(200);
  });
});
