import type { TourDefinition } from '../../schema.js';
import { PERMISSIONS } from '../../../../constants/permissions.js';

// Quick Tour — content sourced directly from HelpPanel.tsx's existing, real HELP_CONTENT
// entry for this route (not fabricated), restructured into the tour schema. See
// ERP-PLANNING/DAP-Planning/02_ROADMAP.md, DAP-2 "migrate HELP_CONTENT" — this is that work,
// started per direct user request rather than waiting for a later phase.
const tour: TourDefinition = {
  id: 'dashboard-overview',
  version: 1,
  type: 'quick',
  title: 'Dashboard — quick overview',
  description: "Your business at a glance — today's sales, collections, alerts, and KPIs.",
  module: 'dashboard',
  estimatedMinutes: 2,
  requiredPermissions: [PERMISSIONS.DASHBOARD_VIEW],
  steps: [
    {
      id: 'intro',
      route: 'dashboard',
      title: 'Dashboard',
      body: "Your business at a glance — today's sales, collections, alerts, and KPIs.",
      placement: 'center',
      mode: 'informational',
      requiredPermission: PERMISSIONS.DASHBOARD_VIEW,
    },
    {
      id: 'todays-sales',
      route: 'dashboard',
      target: '[data-tour-id="dashboard-todays-sales-card"]',
      title: "Read today's sales",
      body: 'The "Today\'s Sales" card shows all confirmed invoices billed today.',
      placement: 'bottom',
      mode: 'informational',
      requiredPermission: PERMISSIONS.DASHBOARD_VIEW,
    },
    {
      id: 'overdue-customers',
      route: 'dashboard',
      target: '[data-tour-id="dashboard-receivables-widget"]',
      title: 'See overdue customers',
      body: 'Check the Outstanding Receivables widget. Click to see aging detail.',
      placement: 'bottom',
      mode: 'informational',
      requiredPermission: PERMISSIONS.DASHBOARD_VIEW,
    },
    {
      id: 'approvals',
      route: 'dashboard',
      target: '[data-tour-id="dashboard-approvals-button"]',
      title: 'Approve pending items',
      body: 'The Approvals badge (bell icon, top right) shows items waiting for your action.',
      placement: 'bottom',
      mode: 'informational',
      requiredPermission: PERMISSIONS.DASHBOARD_VIEW,
    },
  ],
};

export default tour;
