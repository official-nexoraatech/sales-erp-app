import type { TourDefinition } from '../../schema.js';
import { PERMISSIONS } from '../../../../constants/permissions.js';

// Grounded against AttendancePage.tsx / PayrollEngine.ts. Corrected: "Import from file → download
// template → fill → upload" describes a UI that doesn't exist — marking is one employee, one
// date, one status at a time. There's a real CSV import path in the backend (a biometric
// punch-log file import), but no button anywhere in the frontend calls it. Also corrected: no
// live biometric device integration exists — the "nightly auto-import" endpoint is a stub that
// always reports zero imported.
const tour: TourDefinition = {
  id: 'hr-attendance-overview',
  version: 1,
  type: 'quick',
  title: 'Attendance — quick overview',
  description: "Record daily attendance — feeds directly into payroll's unpaid-leave calculation.",
  module: 'hr',
  estimatedMinutes: 2,
  requiredPermissions: [PERMISSIONS.ATTENDANCE_VIEW],
  steps: [
    {
      id: 'intro',
      route: 'hr/attendance',
      title: 'Attendance',
      body: "What you mark here directly drives payroll's unpaid-leave (LOP) calculation for each employee — it's not just a record for its own sake.",
      placement: 'center',
      mode: 'informational',
      requiredPermission: PERMISSIONS.ATTENDANCE_VIEW,
    },
    {
      id: 'mark-daily',
      route: 'hr/attendance',
      target: '[data-tour-id="hr-attendance-mark-button"]',
      title: 'Mark attendance',
      body: "One employee, one date, one status (Present/Absent/Half Day/Late/Holiday/Weekly Off) per entry — there's no bulk-mark-the-whole-team-at-once action in the UI today.",
      placement: 'bottom',
      mode: 'informational',
      requiredPermission: PERMISSIONS.ATTENDANCE_MARK,
    },
    {
      id: 'no-device-integration',
      route: 'hr/attendance',
      title: 'No live biometric device connection',
      body: "There's no automatic sync from a biometric machine — attendance is entered by hand. Marking is the only way to get attendance into the system today.",
      placement: 'center',
      mode: 'informational',
      requiredPermission: PERMISSIONS.ATTENDANCE_VIEW,
    },
    {
      id: 'review',
      route: 'hr/attendance',
      title: 'Calendar and Summary tabs',
      body: 'Calendar shows a per-employee monthly grid; Summary shows present/absent/LOP/late totals per employee for the team — review before running payroll for the period.',
      placement: 'center',
      mode: 'informational',
      requiredPermission: PERMISSIONS.ATTENDANCE_REPORT,
    },
  ],
};

export default tour;
