// REAL end-to-end test — no mocking. Runs against the actually-running dev stack, same
// qa-e2e tenant (tenant_id=2) as live-crm.spec.ts.
//
// CP-7 (Campaign Management Platform initiative): covers the approval-workflow UI added this
// phase (Submit for Approval / Approve / Reject buttons and the approval-status badge on
// CampaignsPage). The qa-e2e tenant has no tenant_communication_settings row, so
// tenantRequiresApproval() defaults to false — submitForApproval() auto-approves immediately.
// There is currently no settings UI/API to flip a tenant into "approval required" mode (see the
// CP-7 completion report's Known Issues section), so the PENDING_APPROVAL → Approve/Reject
// gated path cannot be exercised live yet. That path (and the send()/schedule() APPROVAL_REQUIRED
// guard) is instead covered by the 12 approval-workflow integration tests in
// apps/sales-service/src/__tests__/campaign-service.test.ts, which set the tenant's
// approvalRequired flag directly against the test database.
import { test, expect, type Page } from '@playwright/test';

const OWNER = { email: 'owner@qa-e2e.local', password: 'QaE2eOwner@2026', tenantId: 2 };

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
  await page.waitForURL(/\/(dashboard|no-access)/, { timeout: 15000 });
}

// Same pattern as live-crm.spec.ts — the segment <select>'s option text is
// "{name} ({code})"/"{name}" and isn't reachable via getByRole('combobox', {name}).
async function selectByPartialLabel(
  select: ReturnType<Page['locator']>,
  partialText: string
): Promise<void> {
  const value = await select
    .locator('option', { hasText: partialText })
    .first()
    .getAttribute('value');
  if (!value) throw new Error(`No <option> matching text "${partialText}" found`);
  await select.selectOption(value);
}

async function createSegment(page: Page, segmentName: string): Promise<void> {
  await page.goto('/crm/segments');
  await page.getByRole('button', { name: '+ New Segment' }).click();
  await page.waitForURL('**/crm/segments/new', { timeout: 10000 });
  await page.getByRole('textbox', { name: 'Segment Name' }).fill(segmentName);
  await page.getByPlaceholder('Value').fill('ACTIVE');
  await expect(page.getByRole('button', { name: 'Create Segment' })).toBeEnabled();
  await page.getByRole('button', { name: 'Create Segment' }).click();
  await expect(page.getByText('Segment created')).toBeVisible({ timeout: 10000 });
  await page.waitForURL('**/crm/segments', { timeout: 10000 });
}

async function createDraftCampaign(page: Page, name: string, segmentName: string): Promise<void> {
  await page.goto('/crm/campaigns/new');
  await page.getByRole('textbox', { name: 'Campaign Name' }).fill(name);
  await page.getByRole('button', { name: 'IN_APP', exact: true }).click();
  // Deliberately targets a CUSTOM (DB-backed) segment, not one of the 6 PREBUILT_SEGMENTS
  // entries also offered in this dropdown. Discovered while writing this test: prebuilt segment
  // <option>s render with value={null} (their `id` is null — they're virtual/computed, never a
  // customer_segments row), which React omits from the DOM entirely, so the browser falls back
  // to using the option's *text* as its value. That non-numeric string then fails
  // Number(form.segmentId) on submit, so campaigns.segmentId (an FK into customer_segments) can
  // never actually resolve a prebuilt segment. This is a real, pre-existing bug — selecting any
  // of the 6 prebuilt segments when creating a campaign silently fails validation. It predates
  // CP-7 and is unrelated to the approval workflow being tested here, so it is flagged in the
  // CP-7 completion report's Known Issues rather than fixed as part of this phase's diff.
  await selectByPartialLabel(page.locator('select').first(), segmentName);
  await page
    .getByPlaceholder('Hi {{customerName}}, visit us for exclusive offers…')
    .fill('Hi {{customerName}}, a message just for you.');
  await page.getByRole('button', { name: 'Create Campaign' }).click();
  await expect(page.getByText(/Campaign created/i)).toBeVisible({ timeout: 10000 });
  await page.waitForURL('**/crm/campaigns', { timeout: 10000 });
}

test.use({ storageState: undefined });

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('erp_onboarding_dismissed', 'true'));
});

test('LIVE — Submit for Approval auto-approves when the tenant does not require approval', async ({
  page,
}) => {
  test.setTimeout(60_000);
  const name = `QA Approval AutoApprove ${Date.now()}`;
  const segmentName = `QA Approval Segment ${Date.now()}`;

  await test.step('Login', async () => {
    await realLogin(page, OWNER);
  });

  await test.step('Create a segment and a DRAFT campaign targeting it', async () => {
    await createSegment(page, segmentName);
    await createDraftCampaign(page, name, segmentName);
  });

  await test.step('Submit for approval and verify it is immediately APPROVED', async () => {
    const row = page.getByText(name, { exact: true }).locator('../../..');
    await row.getByRole('button', { name: 'Submit for Approval' }).click();
    await expect(page.getByText('Campaign submitted for approval')).toBeVisible({
      timeout: 10000,
    });
    await expect(row.getByText('APPROVED', { exact: true })).toBeVisible({ timeout: 10000 });
    // The gate is satisfied — Send Now must still be offered (backward-compat regression check).
    await expect(row.getByRole('button', { name: 'Send Now' })).toBeVisible();
  });
});

test('LIVE — editing an approved campaign resets its approval status (R6 guard)', async ({
  page,
}) => {
  test.setTimeout(60_000);
  const name = `QA Approval EditReset ${Date.now()}`;
  const segmentName = `QA Approval Segment ${Date.now()}`;

  await test.step('Login, create, and auto-approve a campaign', async () => {
    await realLogin(page, OWNER);
    await createSegment(page, segmentName);
    await createDraftCampaign(page, name, segmentName);
    const row = page.getByText(name, { exact: true }).locator('../../..');
    await row.getByRole('button', { name: 'Submit for Approval' }).click();
    await expect(row.getByText('APPROVED', { exact: true })).toBeVisible({ timeout: 10000 });
  });

  await test.step('Edit the campaign and verify the APPROVED badge disappears', async () => {
    const row = page.getByText(name, { exact: true }).locator('../../..');
    await row.getByRole('button', { name: 'Edit' }).click();
    await page.waitForURL('**/crm/campaigns/*/edit', { timeout: 10000 });
    await page
      .getByPlaceholder('Hi {{customerName}}, visit us for exclusive offers…')
      .fill('Updated message after approval.');
    await page.getByRole('button', { name: 'Save Changes' }).click();
    await expect(page.getByText(/Campaign updated/i)).toBeVisible({ timeout: 10000 });
    await page.waitForURL('**/crm/campaigns', { timeout: 10000 });

    const row2 = page.getByText(name, { exact: true }).locator('../../..');
    await expect(row2.getByText('APPROVED', { exact: true })).not.toBeVisible();
  });
});
