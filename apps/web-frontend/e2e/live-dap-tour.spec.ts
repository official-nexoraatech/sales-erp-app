// REAL end-to-end test — no mocking. Runs against the actually-running dev stack, verifying
// the DAP-1 pilot: the "Purchase → Dashboard" business-workflow tour. Real login, real
// navigation, real RBAC-driven step filtering (ACCOUNTANT's exact permission set was read
// directly from apps/tenant-service/src/rbac/role-defaults.ts, not guessed — see
// ERP-PLANNING/DAP-Planning/phase-completions/DAP-1_COMPLETION.md). No tour step forces a real
// DOM click to advance — that was a real UX bug (interactive-mode gating on a Save/Confirm
// button meant the tour couldn't be read without actually creating real data) fixed across
// every tour that used it; see the "no step forces a real click" test below.
import { test, expect, type Page } from '@playwright/test';

const TENANT_ID = 2;
const OWNER = { email: 'owner@qa-e2e.local', password: 'QaE2eOwner@2026', tenantId: TENANT_ID };
const ACCOUNTANT = {
  email: 'accountant@qa-e2e.local',
  password: 'QaE2eRole@2026',
  tenantId: TENANT_ID,
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
  await page.waitForURL(/\/(dashboard|no-access|accounting)/, { timeout: 15000 });
}

async function startPilotTour(page: Page, label: 'Start' | 'Resume' | 'Restart' = 'Start') {
  await page.getByRole('button', { name: 'Open help panel' }).click();
  await page
    .getByRole('button', {
      name: `${label} guided tour: Purchase → Dashboard: how one purchase flows through the whole business`,
    })
    .click();
}

test.use({ storageState: undefined });

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('erp_onboarding_dismissed', 'true'));
});

test('LIVE — DAP-1 pilot: full 8-step Purchase→Dashboard tour as OWNER', async ({ page }) => {
  test.setTimeout(120_000);

  await test.step('Login and launch the tour from the Help Center', async () => {
    await realLogin(page, OWNER);
    await startPilotTour(page);
    await expect(page.getByText('Step 1 of 8')).toBeVisible();
    await expect(page.getByText('One purchase touches six modules')).toBeVisible();
    await expect(page).toHaveURL(/\/dashboard/);
  });

  await test.step('Step 2 — Purchase Order (informational, spotlighted)', async () => {
    await page.getByRole('button', { name: 'Next' }).click();
    await expect(page).toHaveURL(/\/purchase\/orders$/);
    await expect(page.getByText('Step 2 of 8')).toBeVisible();
  });

  await test.step('Step 3 — GRN (informational, spotlighted — Next is never disabled)', async () => {
    await page.getByRole('button', { name: 'Next' }).click();
    await expect(page).toHaveURL(/\/purchase\/grns$/);
    await expect(page.getByText('Step 3 of 8')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Next' })).toBeEnabled();
  });

  await test.step('Steps 4-7 — Stock, Accounting, GST, Reports (informational)', async () => {
    await page.getByRole('button', { name: 'Next' }).click();
    await expect(page).toHaveURL(/\/inventory\/stock$/);
    await expect(page.getByText('Step 4 of 8')).toBeVisible();

    await page.getByRole('button', { name: 'Next' }).click();
    await expect(page).toHaveURL(/\/accounting\/journals$/);
    await expect(page.getByText('Step 5 of 8')).toBeVisible();

    await page.getByRole('button', { name: 'Next' }).click();
    await expect(page).toHaveURL(/\/gst\/register$/);
    await expect(page.getByText('Step 6 of 8')).toBeVisible();

    await page.getByRole('button', { name: 'Next' }).click();
    await expect(page).toHaveURL(/\/reports$/);
    await expect(page.getByText('Step 7 of 8')).toBeVisible();
  });

  await test.step('Step 8 — Outro, then Finish closes the overlay', async () => {
    await page.getByRole('button', { name: 'Next' }).click();
    await expect(page).toHaveURL(/\/dashboard$/);
    await expect(page.getByText('Step 8 of 8')).toBeVisible();

    await page.getByRole('button', { name: 'Finish' }).click();
    await expect(page.getByText(/Step \d of 8/)).not.toBeVisible();
  });
});

test('LIVE — DAP-1 pilot: ACCOUNTANT sees exactly the 3 steps their real permissions cover (RBAC step-level filtering, ADR-2)', async ({
  page,
}) => {
  test.setTimeout(60_000);

  await realLogin(page, ACCOUNTANT);
  await startPilotTour(page);

  // ACCOUNTANT holds JOURNAL_VIEW/GST_VIEW/REPORT_VIEW but not DASHBOARD_VIEW/PO_VIEW/
  // GRN_CREATE/ITEM_VIEW — intro, purchase-order, grn, stock, and outro are silently
  // skipped, not blocked; the workflow narrative still reads coherently starting mid-chain.
  await expect(page.getByText('Step 1 of 3')).toBeVisible();
  await expect(page).toHaveURL(/\/accounting\/journals$/);

  await page.getByRole('button', { name: 'Next' }).click();
  await expect(page.getByText('Step 2 of 3')).toBeVisible();
  await expect(page).toHaveURL(/\/gst\/register$/);

  await page.getByRole('button', { name: 'Next' }).click();
  await expect(page.getByText('Step 3 of 3')).toBeVisible();
  await expect(page).toHaveURL(/\/reports$/);

  await page.getByRole('button', { name: 'Finish' }).click();
  await expect(page.getByText(/Step \d of 3/)).not.toBeVisible();
});

test('LIVE — DAP-1 pilot: reloading mid-tour resumes at the saved step, not from the start', async ({
  page,
}) => {
  test.setTimeout(60_000);

  await realLogin(page, OWNER);
  await startPilotTour(page);
  await page.getByRole('button', { name: 'Next' }).click();
  await page.getByRole('button', { name: 'Next' }).click();
  await expect(page.getByText('Step 3 of 8')).toBeVisible();
  await expect(page).toHaveURL(/\/purchase\/grns$/);

  await page.reload();

  await expect(page.getByText('Step 3 of 8')).toBeVisible({ timeout: 10000 });
  await expect(page).toHaveURL(/\/purchase\/grns$/);
});

// ── Enterprise redesign regression coverage ─────────────────────────────────────────────
// Covers the specific screenshot bug reported in the redesign review, plus the new
// floating-ui positioning, keyboard nav, and responsive/theme behavior added alongside it.
// Reuses the same pilot tour as the tests above — it's the one tour whose steps and DOM
// structure are already fully verified, so these tests isolate exactly what changed (layout,
// keyboard handling, viewport, color scheme) rather than re-verifying tour content.

test('LIVE — redesign: a centered step (first-step-of-every-tour shape) stacks title/body/buttons vertically, not scattered', async ({
  page,
}) => {
  test.setTimeout(60_000);
  // Regression test for the reported bug: the centered-placement style object was applied
  // directly to the card, turning it into a full-viewport flex row and scattering its own
  // children (step-count row, title, body, button row) horizontally instead of stacking them.
  await realLogin(page, OWNER);
  await startPilotTour(page);

  const dialog = page.getByRole('dialog');
  const title = dialog.getByRole('heading', { name: 'One purchase touches six modules' });
  const body = dialog.getByText('Every Purchase Order you create eventually moves stock');
  const nextButton = dialog.getByRole('button', { name: 'Next' });
  await expect(title).toBeVisible();
  await expect(body).toBeVisible();
  await expect(nextButton).toBeVisible();

  const titleBox = await title.boundingBox();
  const bodyBox = await body.boundingBox();
  const buttonBox = await nextButton.boundingBox();
  if (!titleBox || !bodyBox || !buttonBox)
    throw new Error('expected all three to have a layout box');

  // A vertical stack: each element strictly below the previous one, not side-by-side at
  // roughly the same y-coordinate (which is what the scattered-flex-row bug produced).
  expect(titleBox.y).toBeLessThan(bodyBox.y);
  expect(bodyBox.y).toBeLessThan(buttonBox.y);
  // And the card itself is a normal, human-scale popup — not stretched edge-to-edge, which is
  // what happened when `display:flex; inset:0` landed on the card instead of a wrapper.
  const cardBox = await dialog.boundingBox();
  expect(cardBox?.width).toBeLessThan(600);
});

test('LIVE — redesign: keyboard navigation (ArrowRight advances, ArrowLeft goes back, Escape closes)', async ({
  page,
}) => {
  test.setTimeout(60_000);
  await realLogin(page, OWNER);
  await startPilotTour(page);
  await expect(page.getByText('Step 1 of 8')).toBeVisible();

  await page.keyboard.press('ArrowRight');
  await expect(page.getByText('Step 2 of 8')).toBeVisible();

  await page.keyboard.press('ArrowLeft');
  await expect(page.getByText('Step 1 of 8')).toBeVisible();

  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).not.toBeVisible();
});

test('LIVE — redesign: renders usably at phone width (375px)', async ({ page }) => {
  test.setTimeout(60_000);
  await page.setViewportSize({ width: 375, height: 812 });
  await realLogin(page, OWNER);
  await startPilotTour(page);

  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  const box = await dialog.boundingBox();
  expect(box?.width).toBeLessThanOrEqual(375);
  await expect(dialog.getByRole('button', { name: 'Next' })).toBeVisible();
});

test('LIVE — redesign: renders under dark color scheme', async ({ page }) => {
  test.setTimeout(60_000);
  await page.emulateMedia({ colorScheme: 'dark' });
  await realLogin(page, OWNER);
  await startPilotTour(page);

  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  const bg = await dialog.evaluate((el) => getComputedStyle(el).backgroundColor);
  // Not transparent/unstyled — the card picked up a real background color in dark mode.
  expect(bg).not.toBe('rgba(0, 0, 0, 0)');
});

test('LIVE — redesign: flagship Sales Invoice workflow tour navigates list → create form with real spotlighted targets', async ({
  page,
}) => {
  test.setTimeout(60_000);
  await realLogin(page, OWNER);
  await page.getByRole('button', { name: 'Open help panel' }).click();
  await page
    .getByRole('button', {
      name: 'Start guided tour: Sales → Invoice: from blank form to a paid, printed invoice',
    })
    .click();

  await test.step('Step 1 — intro (centered)', async () => {
    await expect(page.getByText('Step 1 of 8')).toBeVisible();
    await expect(page).toHaveURL(/\/dashboard/);
  });

  await test.step('Step 2 — Invoices list, spotlighted on the real "+ New Invoice" button', async () => {
    await page.getByRole('button', { name: 'Next' }).click();
    await expect(page).toHaveURL(/\/sales\/invoices$/);
    await expect(page.getByText('Step 2 of 8')).toBeVisible();
    await expect(page.getByRole('button', { name: '+ New Invoice' })).toBeVisible();
  });

  await test.step('Steps 3-4 — Create Invoice form, spotlighted on the real customer select and item search', async () => {
    await page.getByRole('button', { name: 'Next' }).click();
    await expect(page).toHaveURL(/\/sales\/invoices\/new$/);
    await expect(page.getByText('Step 3 of 8')).toBeVisible();
    await expect(page.getByPlaceholder('Type to search customers…')).toBeVisible();

    await page.getByRole('button', { name: 'Next' }).click();
    await expect(page.getByText('Step 4 of 8')).toBeVisible();
    await expect(page.getByPlaceholder('Search items to add...')).toBeVisible();
  });

  // Stops here deliberately — the next step's target is the real "Save as Draft" button,
  // which (like every step in this tour) is informational and never forces a click, but
  // actually clicking it here would still create a real invoice; this test only needs to
  // prove the multi-page navigation and real target resolution work, not exercise invoice
  // creation itself (covered by invoices-workflow.spec.ts).
  await page.getByRole('button', { name: 'Skip tour' }).first().click();
  await expect(page.getByRole('dialog')).not.toBeVisible();
});
