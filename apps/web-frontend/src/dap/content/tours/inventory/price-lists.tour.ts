import type { TourDefinition } from '../../schema.js';
import { PERMISSIONS } from '../../../../constants/permissions.js';

// Corrected against a live code audit: the previous version of this tour described setting
// item-level price overrides and assigning a price list to a customer — neither exists
// anywhere in the UI (confirmed via grep: priceListApi.updateItems is never called from any
// page, and no customer page has a priceList field at all). The backend data model supports
// both, but only the price-list *header* record (name/code/currency/validity/default flag)
// is actually reachable today — and there's no edit/delete/view for it either once created.
// This tour describes only what's real; do not re-add the override/assignment claims until
// that UI actually exists.
const tour: TourDefinition = {
  id: 'inventory-price-lists-overview',
  version: 1,
  type: 'quick',
  title: 'Price Lists — quick overview',
  description:
    'A named price-list record — item-level pricing and customer assignment are not available in the UI yet.',
  module: 'inventory',
  estimatedMinutes: 1,
  requiredPermissions: [PERMISSIONS.PRICE_LIST_VIEW],
  steps: [
    {
      id: 'intro',
      route: 'inventory/price-lists',
      title: 'Price Lists',
      body: "Today this page only creates a named price-list header — code, currency, validity dates, and whether it's the default. There's no way yet to set item-level prices on it or assign it to a customer.",
      placement: 'center',
      mode: 'informational',
      requiredPermission: PERMISSIONS.PRICE_LIST_VIEW,
    },
    {
      id: 'create',
      route: 'inventory/price-lists',
      target: '[data-tour-id="inventory-price-lists-create-button"]',
      title: 'Create a price list',
      body: 'New Price List → Name, Code, Currency, validity dates, and an optional "Set as Default" flag.',
      placement: 'bottom',
      mode: 'informational',
      requiredPermission: PERMISSIONS.PRICE_LIST_VIEW,
    },
    {
      id: 'no-edit',
      route: 'inventory/price-lists',
      title: 'No edit, view, or delete yet',
      body: "Once created, a price list can't be opened, edited, or removed from this page — double-check the details before saving.",
      placement: 'center',
      mode: 'informational',
      requiredPermission: PERMISSIONS.PRICE_LIST_VIEW,
    },
  ],
};

export default tour;
