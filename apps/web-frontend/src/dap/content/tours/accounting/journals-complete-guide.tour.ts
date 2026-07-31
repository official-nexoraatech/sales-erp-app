import type { TourDefinition } from '../../schema.js';
import { PERMISSIONS } from '../../../../constants/permissions.js';

// Deep-dive companion to `accounting-journals-overview`. Grounded against JournalEngine.ts,
// JournalFormPage.tsx, JournalDetailPage.tsx. Key findings: there is no DRAFT state in the real
// code (posting is immediate); balance validation happens both client-side and via a DB-level
// trigger as a final safety net; reversal never requires a reason and is exempt from the
// period-closed guard that blocks new manual postings; system accounts CAN receive manual
// postings (isSystem only blocks editing the account record itself).
const tour: TourDefinition = {
  id: 'accounting-journals-complete-guide',
  version: 1,
  type: 'complete',
  title: 'Journal Entries — complete guide',
  description:
    'How posting and reversal actually work, what balance validation really checks, and the traceability gap worth knowing about.',
  module: 'accounting',
  estimatedMinutes: 6,
  requiredPermissions: [PERMISSIONS.JOURNAL_VIEW],
  steps: [
    {
      id: 'purpose',
      route: 'accounting/journals',
      title: 'Why this page exists',
      body: "Most journals are posted automatically — an invoice confirms, a payment is recorded, a GRN is approved. This page is for the cases those flows don't cover: manual adjustments, corrections, and anything genuinely one-off.",
      placement: 'center',
      mode: 'informational',
      requiredPermission: PERMISSIONS.JOURNAL_VIEW,
    },
    {
      id: 'no-draft',
      route: 'accounting/journals',
      title: 'There is no draft stage',
      body: "Unlike some other modules, a journal has exactly two states: Posted or Reversed. There's no save-as-draft — clicking Post Journal commits it immediately.",
      placement: 'center',
      mode: 'informational',
      requiredPermission: PERMISSIONS.JOURNAL_VIEW,
    },
    {
      id: 'create',
      route: 'accounting/journals/new',
      target: '[data-tour-id="accounting-journal-post-button"]',
      title: 'Creating and posting',
      body: "Add at least 2 lines, each with an account and an amount, so total debits equal total credits to the paisa. Post Journal is disabled until it balances, and now asks for confirmation before posting — there's no undo beyond a full reversal.",
      placement: 'bottom',
      mode: 'informational',
      requiredPermission: PERMISSIONS.JOURNAL_CREATE,
    },
    {
      id: 'validation-layers',
      route: 'accounting/journals',
      title: 'Two layers of balance validation',
      body: "The form checks debits=credits before letting you submit, and a database-level trigger checks again as a final safety net — so a balanced-looking journal genuinely can't be posted unbalanced, even by a bug elsewhere.",
      placement: 'center',
      mode: 'informational',
      requiredPermission: PERMISSIONS.JOURNAL_VIEW,
    },
    {
      id: 'system-accounts',
      route: 'accounting/journals',
      title: 'System accounts accept manual postings',
      body: "Accounts flagged as system accounts (like Retained Earnings) can't be edited or deleted as records, but they CAN still receive an ordinary manual journal posting — the system flag only protects the account definition, not what can post to it. Be deliberate about posting to these.",
      placement: 'center',
      mode: 'informational',
      requiredPermission: PERMISSIONS.JOURNAL_VIEW,
    },
    {
      id: 'reverse',
      route: 'accounting/journals',
      target: '[data-tour-id="accounting-journal-detail-reverse-button"]',
      title: 'Reverse',
      body: "On a posted journal's own detail page. Creates a brand-new mirror journal with debits and credits flipped — the original is never edited or deleted, just marked Reversed. A reason is optional, and reversal is not blocked even in a locked period (unlike a fresh manual posting).",
      placement: 'bottom',
      mode: 'informational',
      requiredPermission: PERMISSIONS.CANCEL_POSTED_JOURNAL,
    },
    {
      id: 'business-impact',
      route: 'accounting/journals',
      title: 'What posting and reversing touch',
      body: "Immediate and permanent — there's no undo layer above the ledger itself.",
      placement: 'center',
      mode: 'informational',
      requiredPermission: PERMISSIONS.JOURNAL_VIEW,
      calloutTitle: 'Business impact',
      calloutVariant: 'info',
      businessImpact: [
        'Posting updates account balances immediately — Trial Balance, P&L, and Balance Sheet reflect it on their next load.',
        'Reversal creates a second, offsetting entry rather than touching the first — your audit trail always shows both.',
        'A journal you post manually to a cost-center-tagged account also flows into the "By Cost Center" P&L view if you tag a cost center on the line.',
      ],
    },
    {
      id: 'common-mistakes',
      route: 'accounting/journals',
      title: 'Common mistakes',
      body: 'The missing drill-through is the one that trips people up most.',
      placement: 'center',
      mode: 'informational',
      requiredPermission: PERMISSIONS.JOURNAL_VIEW,
      calloutTitle: 'Common mistakes',
      calloutVariant: 'warning',
      businessImpact: [
        'Trying to click a system-generated journal\'s "Reference" text expecting it to open the source invoice/payment/GRN — it\'s plain text, not a link, today.',
        "Posting a correcting entry directly to a system account like Retained Earnings without realizing it's allowed — double-check the account before submitting.",
        "Assuming a locked financial period blocks a Reverse the same way it blocks a new manual Post — it doesn't; reversal is exempt from that guard.",
      ],
    },
    {
      id: 'best-practices',
      route: 'accounting/journals',
      title: 'Best practices',
      body: 'Treat every posting as final.',
      placement: 'center',
      mode: 'informational',
      requiredPermission: PERMISSIONS.JOURNAL_VIEW,
      calloutTitle: 'Best practices',
      calloutVariant: 'success',
      businessImpact: [
        "Double-check account selection and amounts before confirming — there's no edit, only Reverse-and-repost.",
        "Give line-level descriptions even though they're optional — future-you (or an auditor) will thank you.",
        'Tag a cost center on manual journal lines when relevant, so the entry shows up correctly in cost-center reporting.',
      ],
    },
  ],
};

export default tour;
