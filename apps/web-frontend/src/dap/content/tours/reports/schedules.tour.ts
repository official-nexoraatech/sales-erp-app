import type { TourDefinition } from '../../schema.js';
import { PERMISSIONS } from '../../../../constants/permissions.js';

// Grounded against ScheduledReportJob.ts / SchedulesPage.tsx. Confirmed this is a genuinely
// working cron + Redis-locked + real SMTP delivery pipeline, not a stub. Corrected: "Pause or
// edit a schedule" was fictional — there is no pause or edit action, only Create and Delete.
// Fixed this session: PDF was removed as a format option (the delivery worker never built a PDF
// attachment — a schedule set to PDF silently emailed with nothing attached), and Delete now
// asks for confirmation.
const tour: TourDefinition = {
  id: 'reports-schedules-overview',
  version: 1,
  type: 'quick',
  title: 'Scheduled Reports — quick overview',
  description: 'A real cron-driven pipeline that emails a report on a recurring schedule.',
  module: 'reports',
  estimatedMinutes: 2,
  requiredPermissions: [PERMISSIONS.REPORT_SCHEDULE],
  steps: [
    {
      id: 'intro',
      route: 'reports/schedules',
      title: 'Scheduled Reports',
      body: 'A genuinely working pipeline: a scheduled job runs your report and emails it as a real attachment, on the cron expression you set.',
      placement: 'center',
      mode: 'informational',
      requiredPermission: PERMISSIONS.REPORT_SCHEDULE,
    },
    {
      id: 'schedule',
      route: 'reports/schedules',
      title: 'New Schedule',
      body: 'Pick a report, a format (Excel or CSV), a cron expression (or one of the quick presets), and recipients.',
      placement: 'center',
      mode: 'informational',
      requiredPermission: PERMISSIONS.REPORT_SCHEDULE,
    },
    {
      id: 'no-pause-no-edit',
      route: 'reports/schedules',
      title: 'No pause or edit — only create and delete',
      body: 'Once a schedule exists, the only actions available are Delete (which now asks for confirmation) or letting a recipient unsubscribe via the link in their email. If the recipients or cadence need to change, delete the old schedule and create a new one.',
      placement: 'center',
      mode: 'informational',
      requiredPermission: PERMISSIONS.REPORT_SCHEDULE,
      calloutTitle: 'Common mistake',
      calloutVariant: 'warning',
    },
  ],
};

export default tour;
