import type { TourDefinition } from '../../schema.js';
import { PERMISSIONS } from '../../../../constants/permissions.js';

const tour: TourDefinition = {
  id: 'accounting-cash-flow-overview',
  version: 1,
  type: 'quick',
  title: 'Cash Flow — quick overview',
  description:
    'Cash movement over a period, grouped into operating, investing, and financing activity.',
  module: 'accounting',
  estimatedMinutes: 1,
  requiredPermissions: [PERMISSIONS.CASH_FLOW_VIEW],
  steps: [
    {
      id: 'intro',
      route: 'accounting/reports/cash-flow',
      title: 'Cash Flow',
      body: 'Cash movement over a period, grouped into operating, investing, and financing activity.',
      placement: 'center',
      mode: 'informational',
      requiredPermission: PERMISSIONS.CASH_FLOW_VIEW,
    },
    {
      id: 'select-period',
      route: 'accounting/reports/cash-flow',
      title: 'Select the period',
      body: 'Compares cash actually received/paid, not accrued income/expense.',
      placement: 'center',
      mode: 'informational',
      requiredPermission: PERMISSIONS.CASH_FLOW_VIEW,
    },
    {
      id: 'compare-net-profit',
      route: 'accounting/reports/cash-flow',
      title: 'Compare cash flow to net profit',
      body: 'A gap usually means unpaid invoices or bills, not an error.',
      placement: 'center',
      mode: 'informational',
      requiredPermission: PERMISSIONS.CASH_FLOW_VIEW,
    },
  ],
};

export default tour;
