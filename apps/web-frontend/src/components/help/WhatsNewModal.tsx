import Modal from '../ui/Modal.js';

interface ReleaseNote {
  date: string;
  title: string;
  description: string;
}

// Real shipped changes only — sourced from actual completion records, not placeholder copy.
// Add a new entry (most recent first) whenever a user-visible change ships; this is a
// changelog, so stale/inaccurate entries are worse than none.
const RELEASE_NOTES: ReleaseNote[] = [
  {
    date: '2026-07-15',
    title: 'Theme & Help Center improvements',
    description:
      'High Contrast mode now applies everywhere (it previously had no effect on the GST and Accounting Reports modules). Reduced Motion now actually reduces motion. Added a keyboard shortcuts reference, searchable help, and fixed broken documentation links.',
  },
  {
    date: '2026-07-14',
    title: 'Consistent create/edit pages across the app',
    description:
      'Record creation (invoices, customers, purchase orders, and more) now uses full pages with a consistent header and footer instead of a mix of modals and pages.',
  },
  {
    date: '2026-07-13',
    title: 'Accounting Reports overhaul',
    description:
      'Trial Balance, Balance Sheet, Profit & Loss, and Cash Flow reports fixed — Balance Sheet now balances correctly mid-year, and Financial Years can be created from Settings.',
  },
  {
    date: '2026-07-13',
    title: 'GSTR-9 classification fix',
    description: 'Annual GST return no longer misclassifies taxable revenue as nil-rated.',
  },
  {
    date: '2026-07-08',
    title: 'Tenant branding',
    description:
      "Set your organization's brand color, font, and corner-radius style from Settings — changes apply live across every open tab, no reload needed.",
  },
  {
    date: '2026-07-07',
    title: 'Refreshed navigation, tables, and forms',
    description:
      'New design system rollout across the app — consistent layout, spacing, and interaction patterns.',
  },
];

interface WhatsNewModalProps {
  open: boolean;
  onClose: () => void;
}

export function WhatsNewModal({ open, onClose }: WhatsNewModalProps) {
  return (
    <Modal open={open} onClose={onClose} title="What's new" size="md">
      <ul className="space-y-4">
        {RELEASE_NOTES.map((note) => (
          <li key={note.date + note.title}>
            <p className="text-xs text-secondary">{note.date}</p>
            <p className="text-sm font-semibold text-primary">{note.title}</p>
            <p className="text-sm text-secondary leading-relaxed">{note.description}</p>
          </li>
        ))}
      </ul>
    </Modal>
  );
}

export default WhatsNewModal;
