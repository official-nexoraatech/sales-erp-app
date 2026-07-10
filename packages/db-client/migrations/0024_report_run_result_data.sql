-- Async report runs (definition.supportsAsync) queue a job and return {runId, status: 'PENDING'}
-- immediately, but the generated rows were only ever used to compute rowCount/durationMs and then
-- discarded — there was no way for the client to ever retrieve the actual report data once the
-- job finished. Store the generated result so GET /run-history/:runId can serve it on completion.
ALTER TABLE "report_run_history" ADD COLUMN IF NOT EXISTS "result_data" JSONB;
