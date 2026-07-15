// CP-7/CP-9 (Campaign Management Platform initiative): campaign-preference-center.spec.ts.
//
// Status update: the customer_communication_preferences API+UI (deferred in CP-7 pending user
// confirmation of DPDP Act/TRAI applicability) were built in a CP-9 follow-up session, after the
// user explicitly authorized shipping a generic version now rather than waiting further on that
// confirmation. The schema/shape itself remains generic (channel x category, not tied to any
// specific regulatory framework's mechanics like TRAI's DLT consent registration) — see the
// updated CP-7/CP-9 completion reports for the full reasoning.
//
// What's real and tested here: an admin can view/edit a customer's granular consent on their
// detail page (CustomerViewPage.tsx), and CampaignService.resolveRecipients() now enforces it
// (a customer with an explicit consented=false PROMOTIONAL row for a channel is excluded from
// that channel's campaign targeting) — this is the "respected by subsequent campaign targeting"
// half of this spec's original two tests.
//
// What's still NOT built: a customer-facing self-service portal (this ERP has no such portal for
// any entity — it's an internal admin tool) and an automatic unsubscribe-link/pixel mechanism
// wired into every outbound message. That second test below remains explicitly skipped.
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

test.use({ storageState: undefined });
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('erp_onboarding_dismissed', 'true'));
});

test("LIVE — admin updates a customer's granular channel/category preference, and it is respected by subsequent campaign targeting", async ({
  page,
}) => {
  test.setTimeout(90_000);
  const suffix = Date.now();
  const customerName = `QA Consent Regression ${suffix}`;
  const segmentName = `QA Consent Segment ${suffix}`;

  await test.step('Login', async () => {
    await realLogin(page, OWNER);
  });

  await test.step('Create a customer and revoke their EMAIL/Promotional consent on the detail page', async () => {
    await page.goto('/customers/new');
    await page.getByRole('textbox', { name: 'Display Name' }).fill(customerName);
    await page.getByRole('combobox', { name: 'Customer Type' }).selectOption('RETAIL');
    await page.getByRole('textbox', { name: 'Phone' }).fill('9812349988');
    await page.getByRole('button', { name: /^create customer/i }).click();
    await page.waitForURL('**/customers', { timeout: 10000 });

    await page.getByText(customerName, { exact: true }).click();
    await page.waitForURL(/\/customers\/\d+$/, { timeout: 10000 });
    await expect(page.getByText('Detailed Consent')).toBeVisible({ timeout: 10000 });

    // The channel name renders directly inside its <td> (no nested wrapper), so one level up
    // from that text reaches the <tr> — not two (see git history for a bug this exact
    // off-by-one caused when only the first table row was ever exercised in ad-hoc testing).
    const emailRow = page.getByText('EMAIL', { exact: true }).locator('..');
    const promoCheckbox = emailRow.locator('td').nth(1).getByRole('checkbox');
    await promoCheckbox.click();
    await expect(promoCheckbox).not.toBeChecked({ timeout: 10000 });
  });

  await test.step('Create a segment matching this customer', async () => {
    await page.goto('/crm/segments');
    await page.getByRole('button', { name: '+ New Segment' }).click();
    await page.waitForURL('**/crm/segments/new', { timeout: 10000 });
    await page.getByRole('textbox', { name: 'Segment Name' }).fill(segmentName);
    await page.getByRole('combobox', { name: 'Rule 1 field' }).selectOption('displayName');
    await page.getByRole('combobox', { name: 'Rule 1 operator' }).selectOption('contains');
    await page.getByRole('textbox', { name: 'Rule 1 value' }).fill(customerName);
    await page.getByRole('button', { name: 'Create Segment' }).click();
    await expect(page.getByText('Segment created')).toBeVisible({ timeout: 10000 });
  });

  await test.step('Verify an EMAIL campaign preview excludes this customer (consent revoked)', async () => {
    await page.goto('/crm/campaigns/new');
    await page
      .getByRole('textbox', { name: 'Campaign Name' })
      .fill(`QA Consent Campaign ${suffix}`);
    await page.getByRole('button', { name: 'EMAIL', exact: true }).click();
    await selectByPartialLabel(page.locator('select').first(), segmentName);
    await page
      .getByPlaceholder('Hi {{customerName}}, visit us for exclusive offers…')
      .fill('Hi {{customerName}}, exclusive offer inside!');

    await page.getByRole('button', { name: 'Preview Recipients' }).click();
    const resultBox = page.getByText('matched recipients').locator('..');
    await expect(resultBox).toBeVisible({ timeout: 10000 });
    await expect(resultBox.locator('p').first()).toHaveText('0');
  });
});

// test.skip(title, fn) — scoped to just this one test, unlike a standalone test.skip(condition,
// reason) call, which is a file-level modifier that would skip every test declared in this file
// (the bug this replaces: the original CP-7 stub used that form correctly when both tests were
// unimplemented, but keeping it after adding a real test above would have silently skipped that
// one too).
test.skip('every channel outbound message includes a working unsubscribe mechanism that updates the preference record', () => {
  // Intentionally unimplemented — no automatic unsubscribe-link/pixel mechanism is wired into
  // outbound messages yet. This ERP has no customer-facing self-service portal for any entity;
  // the preference center built this session is admin-facing (CustomerViewPage), not a public
  // unsubscribe flow. See the CP-9 completion report follow-up section.
});
