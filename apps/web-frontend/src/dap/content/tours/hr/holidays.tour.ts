import type { TourDefinition } from '../../schema.js';
import { PERMISSIONS } from '../../../../constants/permissions.js';

// Grounded against holiday.routes.ts / HolidayCalendarPage.tsx / PayrollEngine.ts / attendance
// routes. Important correction: despite the page's own subtitle claiming holidays are "used by
// attendance and payroll calculations," nothing in the codebase actually reads the holiday
// calendar from either — HOLIDAY is a manually-pickable attendance status, and payroll's working
// days is a manually entered number. This is purely a reference calendar today.
const tour: TourDefinition = {
  id: 'hr-holidays-overview',
  version: 1,
  type: 'quick',
  title: 'Holiday Calendar — quick overview',
  description: 'A reference list of company holidays by year.',
  module: 'hr',
  estimatedMinutes: 1,
  requiredPermissions: [PERMISSIONS.HR_MANAGE],
  steps: [
    {
      id: 'intro',
      route: 'hr/holidays',
      title: 'Holiday Calendar',
      body: 'A list of National, State, and Optional holidays for the year, organized for reference.',
      placement: 'center',
      mode: 'informational',
      requiredPermission: PERMISSIONS.HR_MANAGE,
    },
    {
      id: 'add-holiday',
      route: 'hr/holidays',
      target: '[data-tour-id="hr-holidays-create-button"]',
      title: 'Add a holiday',
      body: 'New Holiday → date, name, and type → Save. "Seed" adds a standard set of national holidays for the year in one click.',
      placement: 'bottom',
      mode: 'informational',
      requiredPermission: PERMISSIONS.HR_MANAGE,
    },
    {
      id: 'reference-only',
      route: 'hr/holidays',
      title: 'Reference only — not wired to attendance or payroll',
      body: "Adding a date here doesn't automatically mark anyone present, exclude the day from unpaid-leave calculations, or change payroll's working-day count. It's a calendar for your team to reference — you still mark HOLIDAY on attendance and set working days on a payroll run yourself.",
      placement: 'center',
      mode: 'informational',
      requiredPermission: PERMISSIONS.HR_MANAGE,
      calloutTitle: 'Common mistake',
      calloutVariant: 'warning',
    },
  ],
};

export default tour;
