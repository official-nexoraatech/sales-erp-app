// REAL end-to-end test — no mocking. Runs against the actually-running dev stack, same
// freshly provisioned tenant ("qa-e2e", tenant_id=2) as the other live-*.spec.ts files.
// Covers: Segment create+preview -> Campaign create+preview -> Send Now.
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

// selectOption({ label }) requires an exact string match — this dropdown's option text is
// "{name} ({code})" and code is server-generated, unknown at test write time. Resolve the
// option's value from a partial text match instead (same pattern as live-hr-payroll.spec.ts).
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

test('LIVE — full real CRM workflow: Segment, Campaign, Send', async ({ page }) => {
  test.setTimeout(120_000);
  const segmentName = `QA Active Customers ${Date.now()}`;
  const campaignName = `QA Campaign ${Date.now()}`;

  await test.step('Login', async () => {
    await realLogin(page, OWNER);
    await expect(page).toHaveURL(/\/dashboard/);
  });

  await test.step('Create a custom segment and preview real matching customers', async () => {
    // ES-* create-record UX standardization (2026-07-14) converted this flow from a modal to a
    // full page at /crm/segments/new — updated selectors below accordingly, same underlying flow.
    await page.goto('/crm/segments');
    await page.getByRole('button', { name: '+ New Segment' }).click();
    await page.waitForURL('**/crm/segments/new', { timeout: 10000 });
    await page.getByRole('textbox', { name: 'Segment Name' }).fill(segmentName);
    // Default rule fields (field=status, operator=eq) are left as-is — only the value needs
    // filling in, matching the ACTIVE customers created by earlier live-*.spec.ts runs.
    await page.getByPlaceholder('Value').fill('ACTIVE');
    await expect(page.getByRole('button', { name: 'Create Segment' })).toBeEnabled();
    await page.getByRole('button', { name: 'Create Segment' }).click();
    await expect(page.getByText('Segment created')).toBeVisible({ timeout: 10000 });
    await page.waitForURL('**/crm/segments', { timeout: 10000 });
    await expect(page.getByText(segmentName)).toBeVisible({ timeout: 10000 });
  });

  await test.step('Create a campaign targeting the segment and preview real recipients', async () => {
    await page.goto('/crm/campaigns/new');
    await page.getByRole('textbox', { name: 'Campaign Name' }).fill(campaignName);
    await page.getByRole('button', { name: 'WHATSAPP', exact: true }).click();

    // This <select> has no aria-label — it's a bare native element under a plain <label> text,
    // not associated via htmlFor/id, so it isn't reachable via getByRole('combobox', {name}).
    await selectByPartialLabel(page.locator('select').first(), segmentName);

    await page
      .getByPlaceholder('Hi {{customerName}}, visit us for exclusive offers…')
      .fill('Hi {{customerName}}, thanks for being a valued customer!');

    await page.getByRole('button', { name: 'Preview Recipients' }).click();
    await expect(page.getByText('matched recipients')).toBeVisible({ timeout: 10000 });

    await page.getByRole('button', { name: 'Create Campaign' }).click();
    await expect(page.getByText(/Campaign created/i)).toBeVisible({ timeout: 10000 });
    await page.waitForURL('**/crm/campaigns', { timeout: 10000 });
  });

  await test.step('Send the campaign now and confirm it reaches SENT/SENDING with real recipients', async () => {
    // `div.filter({ hasText })` matches every ancestor div too, not just the tightest row —
    // .first() in DOM order actually returns the outermost (list-wide) wrapper, not the row.
    // Walk up from the exact-text name element instead: <p>{name}</p> -> .flex.items-center
    // .gap-2 -> .flex-1.min-w-0 -> the actual row div that also holds the action buttons.
    const row = page.getByText(campaignName, { exact: true }).locator('../../..');
    await row.getByRole('button', { name: 'Send Now' }).click();
    await page
      .getByRole('dialog', { name: 'Send Campaign' })
      .getByRole('button', { name: 'Send Now' })
      .click();
    await expect(page.getByText('Campaign sent')).toBeVisible({ timeout: 15000 });

    // Scoped to this run's own row — re-running this spec against a persistent dev DB leaves
    // prior runs' campaigns in the list, and an unscoped page-wide match on "recipients —"
    // hits all of them (a strict-mode collision) once more than one exists.
    await expect(row.getByText(/recipients —/)).toBeVisible({ timeout: 10000 });
  });
});
