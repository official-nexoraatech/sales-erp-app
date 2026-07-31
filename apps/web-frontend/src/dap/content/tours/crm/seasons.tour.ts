import type { TourDefinition } from '../../schema.js';
import { PERMISSIONS } from '../../../../constants/permissions.js';

// Important correction: the previous version claimed the stock multiplier is "used by reorder
// suggestions" — grepping the whole codebase for seasonId/businessSeasons outside this page's
// own CRUD and schema file finds zero consumers. Stock multiplier, loyalty multiplier, and
// sales target are stored and displayed, but nothing in inventory reorder logic, loyalty point
// calculation, or campaign/segment targeting currently reads them. Grounded against
// SeasonsPage.tsx / SeasonFormPage.tsx and a repo-wide grep for consumers.
const tour: TourDefinition = {
  id: 'crm-seasons-overview',
  version: 1,
  type: 'quick',
  title: 'Festival Season Planner — quick overview',
  description: 'Define business seasons (e.g. Diwali, wedding season) as a planning reference.',
  module: 'crm',
  estimatedMinutes: 2,
  requiredPermissions: [PERMISSIONS.CRM_SEASON_VIEW],
  steps: [
    {
      id: 'intro',
      route: 'crm/seasons',
      title: 'Festival Season Planner',
      body: 'Name a date range (Diwali, Wedding Season, Year-End Sale) and record a stock multiplier, loyalty multiplier, and sales target you expect for it.',
      placement: 'center',
      mode: 'informational',
      requiredPermission: PERMISSIONS.CRM_SEASON_VIEW,
    },
    {
      id: 'create-season',
      route: 'crm/seasons',
      target: '[data-tour-id="crm-seasons-create-button"]',
      title: 'Create a season',
      body: 'Set the season type, date range, and your planning numbers — stock multiplier, loyalty multiplier, optional sales target.',
      placement: 'bottom',
      mode: 'informational',
      requiredPermission: PERMISSIONS.CRM_SEASON_MANAGE,
    },
    {
      id: 'planning-only',
      route: 'crm/seasons',
      title: 'These numbers are reference only, today',
      body: "The stock and loyalty multipliers you enter are stored and displayed here, but nothing else in the system currently reads them — reorder suggestions, loyalty point calculations, and campaign targeting don't automatically apply a season's multiplier. Use this page to plan and communicate expectations with your team, not as an automated control.",
      placement: 'center',
      mode: 'informational',
      requiredPermission: PERMISSIONS.CRM_SEASON_VIEW,
      calloutTitle: 'Common mistake',
      calloutVariant: 'warning',
    },
  ],
};

export default tour;
