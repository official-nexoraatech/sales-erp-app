import type { TourDefinition } from '../../schema.js';
import { PERMISSIONS } from '../../../../constants/permissions.js';

// Grounded against Form16Service.ts / Form16Page.tsx. Corrected: there is no bulk-generate
// action — one employee, one financial year, at a time. Corrected: "Download" produces a raw
// JSON data file, not an official Form 16 Part A/B certificate/PDF.
const tour: TourDefinition = {
  id: 'hr-form16-overview',
  version: 1,
  type: 'quick',
  title: 'Form 16 — quick overview',
  description:
    'Annual TDS summary computed from a full year of real payroll data, one employee at a time.',
  module: 'hr',
  estimatedMinutes: 1,
  requiredPermissions: [PERMISSIONS.VIEW_SALARY_DETAILS],
  steps: [
    {
      id: 'intro',
      route: 'hr/form16',
      title: 'Form 16',
      body: 'Aggregates a full financial year (April–March) of real payroll slips into gross salary, TDS, and taxable income after the standard deduction.',
      placement: 'center',
      mode: 'informational',
      requiredPermission: PERMISSIONS.VIEW_SALARY_DETAILS,
    },
    {
      id: 'generate',
      route: 'hr/form16',
      target: '[data-tour-id="hr-form16-generate-button"]',
      title: 'Generate',
      body: "Select one employee and one financial year → Generate. There's no bulk/all-employees action — this is a one-at-a-time lookup.",
      placement: 'bottom',
      mode: 'informational',
      requiredPermission: PERMISSIONS.VIEW_SALARY_DETAILS,
    },
    {
      id: 'json-not-certificate',
      route: 'hr/form16',
      title: 'Download produces data, not the official certificate',
      body: "The Download button saves the on-screen figures as a .json file — it's real, correctly-computed data, but it's not a signed, government-format Form 16 Part A/B document. Use it as your source data, not a filing-ready certificate.",
      placement: 'center',
      mode: 'informational',
      requiredPermission: PERMISSIONS.VIEW_SALARY_DETAILS,
    },
  ],
};

export default tour;
