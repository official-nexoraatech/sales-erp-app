import type { TourDefinition } from '../../schema.js';
import { PERMISSIONS } from '../../../../constants/permissions.js';

// DAP-1 pilot content — see ERP-PLANNING/DAP-Planning/phase-prompts/DAP-1_FOUNDATION_AND_PILOT.md.
// Routes and permission constants below were grepped directly from App.tsx's route table, not
// assumed — see ERP-PLANNING/DAP-Planning/00_CURRENT_STATE_ASSESSMENT.md §3 for why that
// matters in this codebase (PURCHASE_ORDER_* doesn't exist; the real constant is PO_*, and
// inventory/stock is gated on ITEM_VIEW, not STOCK_VIEW).
const tour: TourDefinition = {
  id: 'purchase-to-dashboard-workflow',
  version: 1,
  type: 'business-workflow',
  title: 'Purchase → Dashboard: how one purchase flows through the whole business',
  description:
    'Follow a single purchase from Purchase Order through GRN, Stock, Accounting, GST, and Reports — see exactly what changes at each step and why.',
  module: 'cross-module',
  estimatedMinutes: 6,
  steps: [
    {
      id: 'intro',
      route: 'dashboard',
      title: 'One purchase touches six modules',
      body: 'Every Purchase Order you create eventually moves stock, creates a supplier liability, posts a journal entry, and shows up in GST and financial reports — automatically. This tour follows one purchase through that whole chain so you can see how the modules connect, not just what each button does.',
      placement: 'center',
      mode: 'informational',
      requiredPermission: PERMISSIONS.DASHBOARD_VIEW,
      businessImpact: ['Nothing happens yet at this step — this is the map before the walk.'],
    },
    {
      id: 'purchase-order',
      route: 'purchase/orders',
      target: '[data-tour-id="po-create-button"]',
      title: 'Step 1 — Purchase Order',
      body: 'A Purchase Order (PO) is a formal request to a supplier — it does not affect your stock or accounts yet. Think of it as a commitment, not a transaction.',
      placement: 'bottom',
      mode: 'informational',
      requiredPermission: PERMISSIONS.PO_VIEW,
      businessImpact: [
        'No stock quantity changes.',
        'No accounting entry is posted.',
        'The supplier now has a record of what you intend to buy.',
      ],
    },
    {
      id: 'grn',
      route: 'purchase/grns',
      target: '[data-tour-id="grn-create-button"]',
      title: 'Step 2 — GRN (Goods Receipt Note)',
      body: 'This is where the purchase becomes real: a GRN records that goods actually arrived. "+ Create GRN" opens the form for that — this is the step where stock and accounting both react.',
      placement: 'bottom',
      mode: 'informational',
      requiredPermission: PERMISSIONS.GRN_CREATE,
      businessImpact: [
        'Increases on-hand stock immediately, at the received warehouse.',
        'Creates the liability you now owe the supplier (Accounts Payable).',
        'Sets the weighted-average cost basis used by every future stock valuation.',
      ],
    },
    {
      id: 'stock',
      route: 'inventory/stock',
      title: 'Step 3 — Stock',
      body: 'The quantity you just received is now live here, in real time — filterable by warehouse. No manual sync step exists between GRN and Stock; if a quantity looks wrong, the GRN is where to look first, not here.',
      placement: 'center',
      mode: 'informational',
      requiredPermission: PERMISSIONS.ITEM_VIEW,
      businessImpact: [
        'On-hand quantity increased by exactly what the GRN recorded as received.',
        'Stock valuation (weighted-average cost) recalculated for this item.',
      ],
    },
    {
      id: 'accounting',
      route: 'accounting/journals',
      title: 'Step 4 — Accounting',
      body: 'The GRN you just created automatically posted a journal entry here — you never fill this in by hand for a normal purchase. It debits Inventory and credits Accounts Payable for the received value.',
      placement: 'center',
      mode: 'informational',
      requiredPermission: PERMISSIONS.JOURNAL_VIEW,
      businessImpact: [
        'Debit: Inventory (an asset increased).',
        'Credit: Accounts Payable (a liability increased — what you owe the supplier).',
        'This is why Accounting and Inventory can never silently drift apart for a normal GRN flow.',
      ],
    },
    {
      id: 'gst',
      route: 'gst/register',
      title: 'Step 5 — GST',
      body: "If this purchase carried GST, it's now classified here too — this is the input tax credit (ITC) you can claim against tax you owe on sales.",
      placement: 'center',
      mode: 'informational',
      requiredPermission: PERMISSIONS.GST_VIEW,
      businessImpact: [
        'Input tax credit becomes available for your next GST return.',
        'An unclassified entry here means the GST rate on the item/supplier needs a fix — not a bug, a data gap.',
      ],
    },
    {
      id: 'reports',
      route: 'reports',
      title: 'Step 6 — Reports',
      body: 'Everything you just saw — the stock increase, the journal entry, the GST classification — now feeds every report that touches inventory or payables: Trial Balance, Stock Valuation, and Accounts Payable aging, without you doing anything extra.',
      placement: 'center',
      mode: 'informational',
      requiredPermission: PERMISSIONS.REPORT_VIEW,
      businessImpact: [
        'Trial Balance: the Inventory and Accounts Payable account balances both moved.',
        'Stock Valuation report: reflects the new weighted-average cost.',
      ],
    },
    {
      id: 'outro',
      route: 'dashboard',
      title: "That's the whole chain",
      body: 'Purchase Order → GRN → Stock → Accounting → GST → Reports. The GRN is the one step that actually moves anything — everything after it is automatic. Understanding that one fact explains most "why did my numbers change" questions in this ERP.',
      placement: 'center',
      mode: 'informational',
      requiredPermission: PERMISSIONS.DASHBOARD_VIEW,
    },
  ],
};

export default tour;
