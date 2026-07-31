import type { TourDefinition } from '../../schema.js';
import { PERMISSIONS } from '../../../../constants/permissions.js';

const tour: TourDefinition = {
  id: 'hr-alterations-overview',
  version: 1,
  type: 'quick',
  title: 'Alteration Orders — quick overview',
  description:
    'Counter screen for tailoring alteration jobs — capture the customer, items, and assign a tailor.',
  module: 'hr',
  estimatedMinutes: 1,
  requiredPermissions: [PERMISSIONS.ALTERATION_VIEW],
  steps: [
    {
      id: 'intro',
      route: 'hr/alterations',
      title: 'Alteration Orders',
      body: 'Counter screen for tailoring alteration jobs — capture the customer, items, and assign a tailor.',
      placement: 'center',
      mode: 'informational',
      requiredPermission: PERMISSIONS.ALTERATION_VIEW,
    },
    {
      id: 'create',
      route: 'hr/alterations',
      target: '[data-tour-id="hr-alterations-create-button"]',
      title: 'Create an alteration order',
      body: 'Enter the customer, items needing alteration, and charges.',
      placement: 'bottom',
      mode: 'informational',
      requiredPermission: PERMISSIONS.ALTERATION_VIEW,
    },
    {
      id: 'assign-tailor',
      route: 'hr/alterations',
      title: 'Assign a tailor and track status',
      body: 'Assign from your team, then update status as work progresses: Received → Assigned → In Progress → Quality Check → Ready → Delivered.',
      placement: 'center',
      mode: 'informational',
      requiredPermission: PERMISSIONS.ALTERATION_VIEW,
    },
    {
      id: 'cancel',
      route: 'hr/alterations',
      title: 'Cancel',
      body: "Available on any order that isn't already Delivered or Cancelled — now asks for confirmation with the order number and customer name before cancelling.",
      placement: 'center',
      mode: 'informational',
      requiredPermission: PERMISSIONS.ALTERATION_UPDATE,
    },
  ],
};

export default tour;
