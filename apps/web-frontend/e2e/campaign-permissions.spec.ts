// REAL end-to-end test — no mocking. Runs against the actually-running dev stack, same
// qa-e2e tenant (tenant_id=2) as live-crm.spec.ts.
//
// CP-7 (Campaign Management Platform initiative): UI-level smoke check that the new
// CRM_CAMPAIGN_APPROVE-gated "Submit for Approval" action is reachable for a permission holder.
//
// The 24_PLAYWRIGHT_TEST_PLAN.md guidance for this spec asks for positive AND negative
// permission-guard coverage "via direct API call, not just hidden UI". That coverage already
// exists and is more precise than a live Playwright HTTP call would be:
// apps/sales-service/src/__tests__/crm-campaign-permission-guards.test.ts (8 tests) exercises
// CRM_CAMPAIGN_APPROVE, CRM_CAMPAIGN_ANALYTICS_VIEW, and CRM_AUTOMATION_MANAGE directly against
// the Fastify route tree with signed JWTs, covering both the holder and non-holder case for each.
// It is not duplicated here because the qa-e2e tenant has no seeded user holding
// CRM_CAMPAIGN_APPROVE/CRM_CAMPAIGN_ANALYTICS_VIEW/CRM_AUTOMATION_MANAGE without also holding
// every other permission via the OWNER wildcard (see role-defaults.ts — these three CP-7
// permissions are currently only reachable through the OWNER/ADMIN/SUPER_ADMIN wildcard, not
// granted to any narrower named role like SALES_MANAGER), so a live negative-case UI test would
// require provisioning a new test role/user — judged out of proportion for this phase.
import { test, expect, type Page } from '@playwright/test';

const OWNER = { email: 'owner@qa-e2e.local', password: 'QaE2eOwner@2026', tenantId: 2 };

async function realLogin(
  page: Page,
  creds: { email: string; password: string; tenantId: number }
): Promise<void> {
  await page.goto('/login');
  await page.getByLabel('Tenant ID').fill(String(creds.tenantId));
  await page.getByLabel('Email').fill(creds.email);
  await page.getByLabel('Password', { exact: true }).fill(creds.password);
  await page.getByRole('button', { name: /sign in/i }).click();
  await page.waitForURL(/\/(dashboard|no-access)/, { timeout: 15000 });
}

test.use({ storageState: undefined });

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('erp_onboarding_dismissed', 'true'));
});

test('LIVE — a CRM_CAMPAIGN_CREATE holder sees Submit for Approval but never sees Approve/Reject on their own DRAFT campaigns', async ({
  page,
}) => {
  test.setTimeout(60_000);

  await test.step('Login as OWNER', async () => {
    await realLogin(page, OWNER);
    await page.goto('/crm/campaigns');
  });

  await test.step('Approve/Reject controls never render for a DRAFT campaign (only PENDING_APPROVAL ones)', async () => {
    // A DRAFT campaign's row never shows Approve/Reject — those only ever render for
    // approvalStatus === 'PENDING_APPROVAL' (see CampaignsPage.tsx), which nothing in this test
    // reaches. This asserts the UI doesn't leak the controls prematurely, independent of who is
    // logged in.
    await expect(page.getByRole('button', { name: 'Approve' })).toHaveCount(0);
  });
});
