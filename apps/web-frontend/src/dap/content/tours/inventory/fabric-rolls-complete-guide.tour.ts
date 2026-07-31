import type { TourDefinition } from '../../schema.js';
import { PERMISSIONS } from '../../../../constants/permissions.js';

// Deep-dive companion to `inventory-fabric-rolls-overview`. Grounded against
// FabricRollService.ts (apps/inventory-service): receiveRoll() only inserts a row into
// fabric_rolls (originalMeters/remainingMeters) — it never calls InventoryLedgerService.addStock(),
// so there's no inventory_ledger row, no projection_stock_level update, no items.availableQty
// change, and no valuation. cut() only updates fabricRolls.remainingMeters/status and inserts a
// fabricCuts row — it never touches the item's general stock either. This is the single most
// important fact for this tour: fabric roll tracking is a completely separate system from the
// standard stock pipeline. If the underlying item also has "Track Inventory" enabled, its
// quantity will never reflect roll receipts or cuts — a real double-bookkeeping risk that must
// be stated plainly, not softened.
const tour: TourDefinition = {
  id: 'inventory-fabric-rolls-complete-guide',
  version: 1,
  type: 'complete',
  title: 'Fabric Rolls — complete guide',
  description:
    "FIFO-style length tracking for cloth rolls — and the one thing you must know: it runs entirely separate from your item's general stock count.",
  module: 'inventory',
  estimatedMinutes: 6,
  requiredPermissions: [PERMISSIONS.ITEM_VIEW],
  steps: [
    {
      id: 'purpose',
      route: 'inventory/fabric-rolls',
      title: 'Why this page exists',
      body: "Fabric doesn't sell in whole units — a single roll gets cut into many pieces over time. This page tracks each physical roll's remaining length as it's cut, which a simple quantity count can't represent.",
      placement: 'center',
      mode: 'informational',
      requiredPermission: PERMISSIONS.ITEM_VIEW,
    },
    {
      id: 'critical-architecture-fact',
      route: 'inventory/fabric-rolls',
      title: "This is separate from your item's general stock",
      body: "Receiving a roll here does not change that item's stock quantity anywhere else in the system — not on the Stock page, not in the inventory ledger, not in valuation. Cutting a roll doesn't either. Roll tracking and item stock tracking are two independent systems that don't talk to each other.",
      placement: 'center',
      mode: 'informational',
      requiredPermission: PERMISSIONS.ITEM_VIEW,
      calloutTitle: 'Read this before you rely on this page',
      calloutVariant: 'warning',
      businessImpact: [
        'If the underlying item also has "Track Inventory" enabled on its item master, that item\'s quantity will never move because of a roll being received or cut.',
        "Don't assume the Stock page or Stock Valuation reflect anything happening here — they don't.",
        'If you need both roll-length tracking and accurate item-level stock counts, you currently have to manage them as two separate, manually-reconciled systems.',
      ],
    },
    {
      id: 'receive',
      route: 'inventory/fabric-rolls',
      target: '[data-tour-id="inventory-fabric-rolls-create-button"]',
      title: '+ Receive Roll',
      body: 'Roll Number, Item, Warehouse, and total Meters. Only items flagged "Fabric Item" on the item master should be selectable — if you don\'t see the item you expect, check that flag on the item form first.',
      placement: 'bottom',
      mode: 'informational',
      requiredPermission: PERMISSIONS.ITEM_EDIT,
    },
    {
      id: 'cut',
      route: 'inventory/fabric-rolls',
      target: '[data-tour-id="inventory-fabric-rolls-cut-button"]',
      title: 'Cut',
      body: "Only available while a roll is AVAILABLE or PARTIALLY_CUT. Enter meters to cut and an optional purpose (e.g. a sales order reference) — the modal shows how much is left on the roll and won't let you cut more than that.",
      placement: 'bottom',
      mode: 'informational',
      requiredPermission: PERMISSIONS.ITEM_EDIT,
    },
    {
      id: 'business-impact',
      route: 'inventory/fabric-rolls',
      title: 'What receiving and cutting actually touch',
      body: "Only the roll's own record — repeating this because it's the fact most likely to cause a real discrepancy if missed.",
      placement: 'center',
      mode: 'informational',
      requiredPermission: PERMISSIONS.ITEM_VIEW,
      calloutTitle: 'Business impact',
      calloutVariant: 'info',
      businessImpact: [
        "Inventory: only this roll's own remainingMeters changes — the item's general availableQty is never touched, by receiving or by cutting.",
        "Valuation: no effect — fabric rolls don't flow through the costing engine at all.",
        'Accounting: no effect.',
        'GST: no effect.',
        "Reports: nothing here feeds Stock Valuation or the Dashboard's stock widgets — those read the item's own stock fields, which fabric rolls never update.",
        'Customer Outstanding: no effect.',
      ],
    },
    {
      id: 'common-mistakes',
      route: 'inventory/fabric-rolls',
      title: 'Common mistakes',
      body: 'All of these come from assuming this page behaves like a normal stock movement.',
      placement: 'center',
      mode: 'informational',
      requiredPermission: PERMISSIONS.ITEM_VIEW,
      calloutTitle: 'Common mistakes',
      calloutVariant: 'warning',
      businessImpact: [
        "Expecting the Stock page to show fabric received here — it won't, ever, unless you separately record a stock movement for that item.",
        "Cutting from a roll but not also deducting the item's general stock elsewhere, if that item is also tracked normally — you'll end up double-counting availability.",
        "Not checking remaining meters before cutting for a large order — the modal shows it, but it's easy to skip.",
      ],
    },
    {
      id: 'best-practices',
      route: 'inventory/fabric-rolls',
      title: 'Best practices',
      body: "Decide upfront which system is the source of truth for a fabric item's availability.",
      placement: 'center',
      mode: 'informational',
      requiredPermission: PERMISSIONS.ITEM_VIEW,
      calloutTitle: 'Best practices',
      calloutVariant: 'success',
      businessImpact: [
        "For items you track by roll, treat this page — not the Stock page — as the real source of truth for what's available, and make sure everyone selling that item knows to check here.",
        "Use a clear, consistent Purpose on each cut (e.g. a real sales order number) so a roll's history is traceable later.",
        'Flag "Fabric Item" correctly on the item master before receiving rolls against it — it\'s what keeps the item picker here scoped to the right products.',
      ],
    },
  ],
};

export default tour;
