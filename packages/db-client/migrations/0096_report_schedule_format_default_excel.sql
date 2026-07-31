-- Report Service audit (2026-07-22): report_schedules.format and report_run_history.format
-- both defaulted to 'PDF', but ScheduledReportJob only builds an email attachment for
-- EXCEL/CSV formats — a PDF-format schedule silently emailed recipients with nothing attached.
-- The frontend already avoids sending PDF for this exact reason; this closes the same gap for
-- any caller (direct API, future integration) that omits `format` and would otherwise still
-- fall back to the broken default.
ALTER TABLE report_schedules ALTER COLUMN format SET DEFAULT 'EXCEL';
ALTER TABLE report_run_history ALTER COLUMN format SET DEFAULT 'EXCEL';
