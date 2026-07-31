import type { TourDefinition } from '../../schema.js';
import { PERMISSIONS } from '../../../../constants/permissions.js';

// Deep-dive companion to `inventory-items-overview`. Grounded against item.schema.ts and
// ItemFormPage.tsx: gstRate must be one of [0,5,12,18,28] and hsnCode is required — both feed
// directly into every invoice/quotation line's tax calculation. Price fields have no
// cross-field validation (nothing stops Min Sale Price exceeding Sale Price or MRP). "Delete"
// is really a status change to DISCONTINUED, not a real delete — confirmed via the success
// toast text and itemApi.delete's actual backend behavior.
const tour: TourDefinition = {
  id: 'inventory-items-complete-guide',
  version: 1,
  type: 'complete',
  title: 'Items — complete guide',
  description:
    'Your product catalog — the fields every sale, purchase, and tax calculation in the app depends on.',
  module: 'inventory',
  estimatedMinutes: 6,
  requiredPermissions: [PERMISSIONS.ITEM_VIEW],
  steps: [
    {
      id: 'purpose',
      route: 'inventory/items',
      title: 'Why this page exists',
      body: "Every item you can invoice, quote, purchase, or hold in stock starts here. It's the single source of truth other pages read from — pricing, GST rate, and HSN code entered here are what auto-fill onto every invoice and quotation line.",
      placement: 'center',
      mode: 'informational',
      requiredPermission: PERMISSIONS.ITEM_VIEW,
    },
    {
      id: 'prerequisites',
      route: 'inventory/items',
      title: 'Before you start',
      body: 'Two fields are required and compliance-sensitive — get them right at creation, since correcting a wrong GST rate later means fixing it on every future invoice that used it.',
      placement: 'center',
      mode: 'informational',
      requiredPermission: PERMISSIONS.ITEM_VIEW,
      calloutTitle: 'Before you start',
      calloutVariant: 'warning',
      businessImpact: [
        "HSN Code is required — it's a compliance field the GST return relies on, not just documentation.",
        'GST Rate is required and must be one of 0%, 5%, 12%, 18%, or 28% — no custom rates.',
        'If this is a cloth/fabric item you\'ll track by roll length rather than a simple quantity, decide that now — it\'s the "Fabric Item" switch on this form, and it determines whether the item shows up on the Fabric Rolls page.',
      ],
    },
    {
      id: 'create-item',
      route: 'inventory/items',
      target: '[data-tour-id="inventory-items-create-button"]',
      title: '+ New Item',
      body: "The form is organized into Basic Information, GST & HSN, Pricing, and Inventory & Barcode. Nothing here auto-validates that Min Sale Price stays below Sale Price or MRP — that's on you to get right, since the form will happily save it either way.",
      placement: 'bottom',
      mode: 'informational',
      requiredPermission: PERMISSIONS.ITEM_CREATE,
    },
    {
      id: 'discontinue',
      route: 'inventory/items',
      title: 'Discontinuing an item',
      body: "The row action marks an item DISCONTINUED rather than deleting it — it stops appearing for new sales/purchases but its history on past invoices and orders stays intact. There's no way to permanently remove an item once created.",
      placement: 'center',
      mode: 'informational',
      requiredPermission: PERMISSIONS.ITEM_DELETE,
    },
    {
      id: 'barcode',
      route: 'inventory/items',
      title: 'Barcode actions',
      body: '"Generate Barcode" assigns a new barcode to the item. "Print Barcode Label" hands off to the Production module\'s label-printing page, pre-filled with this item — the two are separate steps by design.',
      placement: 'center',
      mode: 'informational',
      requiredPermission: PERMISSIONS.ITEM_EDIT,
    },
    {
      id: 'business-impact',
      route: 'inventory/items',
      title: 'What this page feeds',
      body: 'Almost every other module reads from here.',
      placement: 'center',
      mode: 'informational',
      requiredPermission: PERMISSIONS.ITEM_VIEW,
      calloutTitle: 'Business impact',
      calloutVariant: 'info',
      businessImpact: [
        'Inventory: Reorder Level drives the "Low Stock" flag on the Stock page and the Dashboard\'s low-stock widget.',
        'Sales/Purchase: GST Rate, HSN Code, Sale Price, and Purchase Price all auto-fill onto invoice, quotation, and purchase-order lines — get them right once here instead of correcting every document.',
        'GST: HSN Code and GST Rate are what your GST returns rely on for correct classification.',
        "Reports: Stock Valuation reads this item's live cost fields directly — no lag.",
        "Dashboard: stock-value and low-stock widgets both read this item's fields live.",
      ],
    },
    {
      id: 'common-mistakes',
      route: 'inventory/items',
      title: 'Common mistakes',
      body: "Most of these are things the form won't stop you from doing.",
      placement: 'center',
      mode: 'informational',
      requiredPermission: PERMISSIONS.ITEM_VIEW,
      calloutTitle: 'Common mistakes',
      calloutVariant: 'warning',
      businessImpact: [
        'Setting Min Sale Price higher than Sale Price or MRP — nothing warns you, and it can produce confusing behavior anywhere the minimum is enforced.',
        'Forgetting to flag "Fabric Item" for cloth products — without it, the item won\'t appear as a pickable option on the Fabric Rolls page.',
        'Clicking "Delete" expecting it to remove the item — it discontinues it instead; the item and its history stay.',
      ],
    },
    {
      id: 'best-practices',
      route: 'inventory/items',
      title: 'Best practices',
      body: "Get pricing and tax right at creation — it's cheaper than correcting it later.",
      placement: 'center',
      mode: 'informational',
      requiredPermission: PERMISSIONS.ITEM_VIEW,
      calloutTitle: 'Best practices',
      calloutVariant: 'success',
      businessImpact: [
        "Set a real Reorder Level on every item you actively stock — it's what makes the low-stock features across the app useful instead of empty.",
        "Double-check GST Rate and HSN Code against your tax advisor's classification before the first invoice goes out on a new item.",
        'Use Discontinue instead of trying to "hide" an item by other means — it\'s the one action that correctly keeps history intact while stopping new use.',
      ],
    },
  ],
};

export default tour;
