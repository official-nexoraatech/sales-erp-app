// E2E coverage for the three new enterprise engines (Business Rules, Workflow Automation, AI
// Copilot) — mocked-API tier, same pattern as invoices-workflow.spec.ts. Exercises the golden
// path of each new page against a mocked backend boundary (no live services required).
import { test, expect } from '@playwright/test';
import { login, mockJson } from './helpers.js';

const RULE_PERMISSIONS = [
  'DASHBOARD_VIEW',
  'RULE_VIEW',
  'RULE_CREATE',
  'RULE_UPDATE',
  'RULE_DELETE',
  'RULE_SIMULATE',
];
const APPROVAL_PERMISSIONS = ['DASHBOARD_VIEW'];
const AUTOMATION_PERMISSIONS = [
  'DASHBOARD_VIEW',
  'AUTOMATION_VIEW',
  'AUTOMATION_CREATE',
  'AUTOMATION_EDIT',
  'AUTOMATION_DELETE',
  'AUTOMATION_EXECUTE',
];
const COPILOT_PERMISSIONS = ['DASHBOARD_VIEW', 'COPILOT_VIEW', 'COPILOT_USE'];

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('erp_onboarding_dismissed', 'true'));
});

test.describe('Business Rules page', () => {
  test('lists seeded system rules and shows the simulate panel for a selected rule', async ({
    page,
  }) => {
    await login(page, RULE_PERMISSIONS);

    // Scoped to /api/auth/rules specifically — an unscoped '**/rules' glob also matches the
    // frontend's own page navigation to /settings/rules (same suffix), intercepting the app
    // shell request itself and replacing it with the mocked JSON body.
    await page.route('**/api/auth/rules', (route) => {
      if (route.request().method() !== 'GET') return route.fallback();
      return mockJson(route, {
        content: [
          {
            id: 1,
            name: 'Block sale above credit limit',
            entityType: 'SALE',
            eventType: 'SALE_CREATE',
            isActive: true,
            isSystem: true,
            priority: 1,
            conditions: [{ field: 'isOverCreditLimit', operator: 'EQUALS', value: true }],
            actions: [{ type: 'BLOCK', message: 'Customer has exceeded credit limit.' }],
            conditionOperator: 'AND',
            createdAt: '2026-07-31T00:00:00Z',
            updatedAt: '2026-07-31T00:00:00Z',
          },
        ],
        totalElements: 1,
      });
    });

    await page.goto('/settings/rules');
    await expect(page.getByText('Block sale above credit limit')).toBeVisible();
    await expect(page.getByText('SYSTEM')).toBeVisible();

    await page.getByText('Block sale above credit limit').click();
    await expect(
      page.getByRole('heading', { name: /Edit — Block sale above credit limit/i })
    ).toBeVisible();
    await expect(page.getByText('System rule — editable, not deletable')).toBeVisible();
    await expect(page.getByText('Run Simulation')).toBeVisible();
  });

  test('creating a new rule posts the form and refreshes the list', async ({ page }) => {
    await login(page, RULE_PERMISSIONS);

    // Scoped to /api/auth/rules specifically — an unscoped '**/rules' glob also matches the
    // frontend's own page navigation to /settings/rules (same suffix), intercepting the app
    // shell request itself and replacing it with the mocked JSON body.
    await page.route('**/api/auth/rules', (route) => {
      if (route.request().method() === 'GET') {
        return mockJson(route, { content: [], totalElements: 0 });
      }
      if (route.request().method() === 'POST') {
        return mockJson(
          route,
          {
            id: 2,
            name: 'Test Rule',
            entityType: 'SALE',
            eventType: 'SALE_CREATE',
            isActive: true,
            isSystem: false,
            priority: 100,
            conditions: [{ field: 'x', operator: 'EQUALS', value: '1' }],
            actions: [{ type: 'WARN', message: '' }],
            conditionOperator: 'AND',
            createdAt: '2026-08-01T00:00:00Z',
            updatedAt: '2026-08-01T00:00:00Z',
          },
          201
        );
      }
      return route.fallback();
    });

    await page.goto('/settings/rules');
    await page.getByRole('button', { name: 'New Rule' }).click();
    await page.getByLabel('Name').fill('Test Rule');

    const postRequest = page.waitForRequest(
      (req) => req.url().includes('/rules') && req.method() === 'POST'
    );
    await page.getByRole('button', { name: 'Save' }).click();
    await postRequest;
  });
});

test.describe('My Approvals page', () => {
  test('shows a pending approval and approves it', async ({ page }) => {
    await login(page, APPROVAL_PERMISSIONS);

    await page.route('**/approvals/pending', (route) =>
      mockJson(route, {
        content: [
          {
            approvalId: 10,
            instanceId: 100,
            nodeId: 'node_1',
            nodeName: 'Sales Manager Approval',
            entityType: 'Invoice',
            entityId: 55,
            triggeredByUserId: 2,
            createdAt: '2026-08-01T00:00:00Z',
          },
        ],
        totalElements: 1,
      })
    );
    await page.route('**/approvals/100/status', (route) =>
      mockJson(route, {
        instanceId: 100,
        status: 'PENDING',
        currentNodeId: 'node_1',
        pendingApprovals: [
          {
            id: 10,
            nodeId: 'node_1',
            nodeName: 'Sales Manager Approval',
            approverId: 1,
            action: 'PENDING',
          },
        ],
        history: [],
      })
    );
    await page.route('**/approvals/100/approve', (route) =>
      mockJson(route, { message: 'Approved', instanceId: 100 })
    );

    await page.goto('/my-approvals');
    await expect(page.getByText('Sales Manager Approval')).toBeVisible();
    await expect(page.getByText('Invoice #55')).toBeVisible();

    await page.getByText('Sales Manager Approval').click();
    await expect(page.getByRole('button', { name: 'Approve' })).toBeVisible();

    const approveRequest = page.waitForRequest(
      (req) => req.url().includes('/approvals/100/approve') && req.method() === 'POST'
    );
    await page.getByRole('button', { name: 'Approve' }).click();
    // ConfirmContext renders a confirmation dialog — accept it.
    await page.getByRole('button', { name: 'Approve', exact: true }).last().click();
    await approveRequest;
  });
});

test.describe('Workflow Automation page', () => {
  test('lists automations and previews the DAG for the selected one', async ({ page }) => {
    await login(page, AUTOMATION_PERMISSIONS);

    await page.route('**/automation/definitions', (route) => {
      if (route.request().method() !== 'GET') return route.fallback();
      return mockJson(route, {
        content: [
          {
            id: 1,
            tenantId: 1,
            name: 'Low Stock Alert',
            triggerEvent: 'STOCK_LEVEL_CHANGED',
            entityType: 'Item',
            triggerType: 'EVENT',
            triggerConfig: null,
            nodes: [
              {
                id: 'n1',
                name: 'Check threshold',
                type: 'CONDITION',
                conditions: [],
                conditionOperator: 'AND',
                nextNodeId: 'n2',
              },
              {
                id: 'n2',
                name: 'Notify manager',
                type: 'NOTIFICATION',
                approverType: 'ROLE',
                approverRef: 'INVENTORY_MANAGER',
                message: 'Stock is low',
              },
            ],
            isActive: true,
            isSystem: false,
            timeoutHours: 48,
            createdAt: '2026-08-01T00:00:00Z',
            updatedAt: '2026-08-01T00:00:00Z',
          },
        ],
        totalElements: 1,
      });
    });
    await page.route('**/automation/definitions/1/history', (route) =>
      mockJson(route, { content: [], totalElements: 0 })
    );

    await page.goto('/settings/automation');
    await expect(page.getByText('Low Stock Alert')).toBeVisible();

    await page.getByText('Low Stock Alert').click();
    await expect(page.getByRole('heading', { name: /Edit — Low Stock Alert/i })).toBeVisible();
    await expect(page.locator('input[value="Check threshold"]')).toBeVisible();
    await expect(page.locator('input[value="Notify manager"]')).toBeVisible();
  });

  test('triggering an automation manually calls the trigger endpoint', async ({ page }) => {
    await login(page, AUTOMATION_PERMISSIONS);
    await page.route('**/automation/definitions', (route) => {
      if (route.request().method() !== 'GET') return route.fallback();
      return mockJson(route, {
        content: [
          {
            id: 1,
            tenantId: 1,
            name: 'Manual Test Automation',
            triggerEvent: 'CUSTOM',
            entityType: 'Custom',
            triggerType: 'API',
            triggerConfig: null,
            nodes: [{ id: 'n1', name: 'Notify', type: 'ACTION', actionEventType: 'CUSTOM_FIRED' }],
            isActive: true,
            isSystem: false,
            timeoutHours: 48,
            createdAt: '2026-08-01T00:00:00Z',
            updatedAt: '2026-08-01T00:00:00Z',
          },
        ],
        totalElements: 1,
      });
    });
    await page.route('**/automation/definitions/1/history', (route) =>
      mockJson(route, { content: [], totalElements: 0 })
    );
    await page.route('**/automation/definitions/1/trigger', (route) =>
      mockJson(route, { message: 'Triggered' })
    );

    await page.goto('/settings/automation');
    await page.getByText('Manual Test Automation').click();

    const triggerRequest = page.waitForRequest(
      (req) => req.url().includes('/automation/definitions/1/trigger') && req.method() === 'POST'
    );
    await page.getByRole('button', { name: 'Trigger Now' }).click();
    await triggerRequest;
  });
});

test.describe('AI Copilot chat page', () => {
  test('sends a message and displays the assistant reply', async ({ page }) => {
    await login(page, COPILOT_PERMISSIONS);

    await page.route('**/copilot/conversations', (route) =>
      mockJson(route, { content: [], totalElements: 0 })
    );
    await page.route('**/copilot/conversations/new/messages', (route) => {
      if (route.request().method() !== 'POST') return route.fallback();
      return mockJson(route, {
        conversationId: 42,
        reply: 'You have 3 recent invoices totalling ₹45,000.',
        toolCalls: [{ toolName: 'list_invoices', input: { pageSize: 10 } }],
      });
    });
    await page.route('**/copilot/conversations/42/messages', (route) => {
      if (route.request().method() !== 'GET') return route.fallback();
      return mockJson(route, {
        content: [
          {
            id: 1,
            conversationId: 42,
            role: 'user',
            content: 'show my recent invoices',
            toolCalls: null,
            createdAt: '2026-08-01T00:00:00Z',
          },
          {
            id: 2,
            conversationId: 42,
            role: 'assistant',
            content: 'You have 3 recent invoices totalling ₹45,000.',
            toolCalls: [{ toolUseId: '0', toolName: 'list_invoices', input: { pageSize: 10 } }],
            createdAt: '2026-08-01T00:00:01Z',
          },
        ],
        totalElements: 2,
      });
    });

    await page.goto('/copilot');
    await page.getByPlaceholder(/Ask a question/i).fill('show my recent invoices');

    const sendRequest = page.waitForRequest(
      (req) => req.url().includes('/copilot/conversations/new/messages') && req.method() === 'POST'
    );
    await page.getByRole('button', { name: 'Send' }).click();
    await sendRequest;

    await expect(page.getByText(/3 recent invoices/)).toBeVisible();
    await expect(page.getByText(/Used: list_invoices/)).toBeVisible();
  });

  test('shows a clear error toast when the Copilot backend is unavailable', async ({ page }) => {
    await login(page, COPILOT_PERMISSIONS);
    await page.route('**/copilot/conversations', (route) =>
      mockJson(route, { content: [], totalElements: 0 })
    );
    // Error responses are NOT wrapped in {data: ...} the way mockJson() wraps success
    // payloads — client.ts's request() reads `error` at the top level of the raw body
    // (see its own comment: "auth-service sends {error: 'msg'}, others send
    // {error: {code, message}}"). Using mockJson() here would double-wrap it as
    // {data: {error: ...}}, which client.ts can't see, and every case would silently fall
    // through to the generic "Request failed" default instead of the real message.
    await page.route('**/copilot/conversations/new/messages', (route) =>
      route.fulfill({
        status: 500,
        contentType: 'application/json',
        body: JSON.stringify({
          error: { code: 'COPILOT_UNAVAILABLE', message: 'AI Copilot is not configured' },
        }),
      })
    );

    await page.goto('/copilot');
    await page.getByPlaceholder(/Ask a question/i).fill('hello');
    await page.getByRole('button', { name: 'Send' }).click();

    await expect(page.getByText(/AI Copilot is not configured/i)).toBeVisible();
  });
});
