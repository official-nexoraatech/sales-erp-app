-- Event Service audit (2026-07-23): OutboxRelayWorker retried a failed Kafka publish on the
-- very next poll tick (default 500ms) with no backoff, so a transient broker blip lasting
-- longer than ~2.5s (default 5 retries) permanently dead-lettered real business events before
-- the problem could plausibly resolve itself. Nullable next_retry_at lets a failed row be
-- skipped until its exponential-backoff window has elapsed, without changing the existing
-- retry_count/failed/failed_reason semantics or requiring a backfill (NULL == "eligible now",
-- matching every currently-pending row's existing behavior).
ALTER TABLE "outbox_events" ADD COLUMN "next_retry_at" timestamptz;
