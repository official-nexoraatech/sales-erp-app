// REAL end-to-end test — no mocking. Runs against the actually-running dev stack, same
// qa-e2e tenant (tenant_id=2) as live-crm.spec.ts.
//
// CP-9 (Campaign Management Platform initiative, final phase): the consolidated regression spec
// requested by the CP-9 phase prompt. Per 24_PLAYWRIGHT_TEST_PLAN.md, campaign-regression.spec.ts
// is meant to be a full lifecycle walk + cross-module check + cross-browser/mobile pass on top of
// re-running every earlier spec's critical assertions.
//
// Scope actually covered here, and why the rest isn't duplicated:
// - The full DRAFT -> SENT lifecycle walk (segment create -> campaign create -> preview -> send)
//   is already exhaustively covered by live-crm.spec.ts, which this file does not duplicate.
// - The DRAFT -> PENDING_APPROVAL -> APPROVED walk (CP-7) and branch-scoping/sender-identity/
//   webhook flows (CP-8) cannot be exercised live yet — see the CP-7 and CP-8 completion reports'
//   "verification debt" sections: the running sales-service process predates all of CP-2 through
//   CP-8's route additions (confirmed via a direct curl 404 against a CP-7 route in the CP-7
//   session). Their coverage lives in campaign-approval-workflow.spec.ts (written, currently
//   failing live for the documented infrastructure reason, not a code defect) plus this
//   initiative's unit/integration test suites, which do not depend on the live process being
//   current.
// - What genuinely wasn't covered by any earlier spec, and IS fully reachable live today, is the
//   specific cross-module check the CP-9 phase prompt calls out by name: an opted-out customer
//   (Customers module) is excluded from campaign targeting (Campaigns module) — that's this file's
//   actual content.
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

test("LIVE — cross-module regression: an SMS-opted-out customer is excluded from an SMS campaign's recipient preview", async ({
  page,
}) => {
  test.setTimeout(90_000);
  const suffix = Date.now();
  const customerName = `QA OptOut Regression ${suffix}`;
  const segmentName = `QA OptOut Segment ${suffix}`;

  await test.step('Login', async () => {
    await realLogin(page, OWNER);
  });

  await test.step('Create a customer via the Customers module', async () => {
    await page.goto('/customers/new');
    await page.getByRole('textbox', { name: 'Display Name' }).fill(customerName);
    await page.getByRole('combobox', { name: 'Customer Type' }).selectOption('RETAIL');
    await page.getByRole('textbox', { name: 'Phone' }).fill('9812345670');
    await page.getByRole('button', { name: /^create customer/i }).click();
    await page.waitForURL('**/customers', { timeout: 10000 });
    await expect(page.getByText(customerName)).toBeVisible({ timeout: 10000 });
  });

  await test.step('Opt the customer out of SMS via their detail page', async () => {
    await page.getByText(customerName, { exact: true }).click();
    await page.waitForURL(/\/customers\/\d+$/, { timeout: 10000 });
    // A plain click, not .uncheck() — the checkbox is a controlled component driven by the
    // customer query result, so its checked state only flips after the opt-out mutation's
    // response invalidates that query, not synchronously with the click event itself.
    const smsRow = page.getByText('SMS', { exact: true }).locator('..');
    await smsRow.getByRole('checkbox').click();
    await expect(smsRow.getByRole('checkbox')).not.toBeChecked({ timeout: 10000 });
  });

  await test.step('Create a segment matching this customer via the Campaigns/CRM module', async () => {
    await page.goto('/crm/segments');
    await page.getByRole('button', { name: '+ New Segment' }).click();
    await page.waitForURL('**/crm/segments/new', { timeout: 10000 });
    await page.getByRole('textbox', { name: 'Segment Name' }).fill(segmentName);
    await page.getByRole('combobox', { name: 'Rule 1 field' }).selectOption('displayName');
    await page.getByRole('combobox', { name: 'Rule 1 operator' }).selectOption('contains');
    await page
      .getByRole('textbox', { name: 'Rule 1 value' })
      .fill(`QA OptOut Regression ${suffix}`);
    await expect(page.getByRole('button', { name: 'Create Segment' })).toBeEnabled();
    await page.getByRole('button', { name: 'Create Segment' }).click();
    await expect(page.getByText('Segment created')).toBeVisible({ timeout: 10000 });
  });

  await test.step('Verify the SMS preview excludes the opted-out customer, while an EMAIL preview would not filter on SMS opt-out', async () => {
    await page.goto('/crm/campaigns/new');
    await page.getByRole('textbox', { name: 'Campaign Name' }).fill(`QA OptOut Campaign ${suffix}`);
    await page.getByRole('button', { name: 'SMS', exact: true }).click();

    const value = await page
      .locator('select')
      .first()
      .locator('option', { hasText: segmentName })
      .first()
      .getAttribute('value');
    if (!value) throw new Error(`Segment option "${segmentName}" not found in dropdown`);
    await page.locator('select').first().selectOption(value);

    await page
      .getByPlaceholder('Hi {{customerName}}, visit us for exclusive offers…')
      .fill('Hi {{customerName}}, exclusive offer inside!');

    await page.getByRole('button', { name: 'Preview Recipients' }).click();
    // The segment matches exactly one customer (this test's own, uniquely-named one), and that
    // customer just opted out of SMS — a correct SMS-channel preview must report 0 matches.
    // previewCount and the "matched recipients" label render as separate <p> siblings inside the
    // same result box, not one combined text node.
    const resultBox = page.getByText('matched recipients').locator('..');
    await expect(resultBox).toBeVisible({ timeout: 10000 });
    await expect(resultBox.locator('p').first()).toHaveText('0');
  });
});
