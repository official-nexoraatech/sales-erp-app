import type { TourDefinition } from '../../schema.js';
import { PERMISSIONS } from '../../../../constants/permissions.js';

// Grounded against JournalsPage.tsx / JournalFormPage.tsx / JournalDetailPage.tsx /
// JournalEngine.ts. Corrected: real button labels are "+ Manual Journal" (list) and
// "Post Journal" (form), not "New Journal"/"Post". Added: posting now asks for confirmation
// (it's effectively permanent — there's no true delete/unpost, only Reverse), and there is no
// drill-through from a system-generated journal's "Reference" field to its source record.
const tour: TourDefinition = {
  id: 'accounting-journals-overview',
  version: 1,
  type: 'quick',
  title: 'Journal Entries — quick overview',
  description: "Manual double-entry postings for adjustments invoices and payments don't cover.",
  module: 'accounting',
  estimatedMinutes: 2,
  requiredPermissions: [PERMISSIONS.JOURNAL_VIEW],
  steps: [
    {
      id: 'intro',
      route: 'accounting/journals',
      title: 'Journal Entries',
      body: "Most journals here are posted automatically by other modules (an invoice, a payment, a GRN) — this list is also where you post a manual one for anything they don't cover.",
      placement: 'center',
      mode: 'informational',
      requiredPermission: PERMISSIONS.JOURNAL_VIEW,
    },
    {
      id: 'create',
      route: 'accounting/journals',
      target: '[data-tour-id="accounting-journals-create-button"]',
      title: 'Create a manual journal',
      body: "+ Manual Journal → add debit/credit lines that balance to the paisa → Post Journal. You'll be asked to confirm, since posting is immediate and effectively permanent.",
      placement: 'bottom',
      mode: 'informational',
      requiredPermission: PERMISSIONS.JOURNAL_VIEW,
    },
    {
      id: 'no-drill-through',
      route: 'accounting/journals',
      title: 'System-generated journals show a reference, but no link',
      body: 'A journal posted by another module shows its source as plain text (e.g. "INVOICE #1042") — there\'s currently no click-through from here back to that invoice, payment, or GRN.',
      placement: 'center',
      mode: 'informational',
      requiredPermission: PERMISSIONS.JOURNAL_VIEW,
    },
    {
      id: 'reverse',
      route: 'accounting/journals',
      title: 'Reverse a posted journal',
      body: "Open the journal → Reverse — creates a new offsetting entry rather than editing or deleting the original. A reason is optional. Reversal isn't blocked by a locked period, even though posting a new manual journal is.",
      placement: 'center',
      mode: 'informational',
      requiredPermission: PERMISSIONS.JOURNAL_VIEW,
    },
  ],
};

export default tour;
