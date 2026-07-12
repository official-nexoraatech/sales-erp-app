# Load Tests — k6 Scripts

## Prerequisites

```bash
# Install k6
winget install k6          # Windows
brew install k6            # macOS

# Start the full stack
docker compose up -d
pnpm turbo run dev --concurrency=20
```

## Safety

Every script's `setup()` calls `assertSafeEnvironment()` (`k6-helpers.js`) before generating
any load. It refuses to run unless `LOAD_TEST_ENV` is explicitly `local` or `staging`, and
refuses to run against any target URL that looks production-like. Set it via `-e`:

```bash
k6 run -e LOAD_TEST_ENV=local load-tests/k6-normal-load.js
```

Override the default `localhost` ports with `-e BASE_AUTH_URL=...`, `-e BASE_SALES_URL=...`,
`-e BASE_INVENTORY_URL=...`, `-e BASE_EVENT_URL=...` if targeting a real staging environment.

## Scenarios

| Script                       | Scenario                                                        | VUs            | Duration | Key Threshold             |
| ---------------------------- | --------------------------------------------------------------- | -------------- | -------- | ------------------------- |
| `k6-normal-load.js`          | Scenario 1 — Baseline                                           | 50             | 30 min   | P95 < 500ms, error < 0.1% |
| `k6-peak-load.js`            | Scenario 2 — Diwali peak                                        | 200            | 2 hours  | P95 < 2000ms, error < 1%  |
| `k6-spike.js`                | Scenario 3 — Spike                                              | 10→500         | ~8 min   | No 5xx cascade            |
| `k6-soak.js`                 | Scenario 4 — Soak                                               | 100            | 24 hours | No memory growth          |
| `k6-concurrency.js`          | Scenario 5 — Last-unit race on `POST /invoices/:id/confirm`     | 200            | 2 min    | Exactly 1 success         |
| `outbox-relay-throughput.js` | Scenario 6 — Outbox relay backlog under sustained producer load | 10 (+1 poller) | ~2.5 min | Backlog stays bounded     |

## Running

```bash
# Scenario 1 — Normal Load (run this first to establish baseline)
k6 run -e LOAD_TEST_ENV=local load-tests/k6-normal-load.js --out json=load-test-results/normal-load.json

# Scenario 2 — Peak Load
k6 run -e LOAD_TEST_ENV=local load-tests/k6-peak-load.js --out json=load-test-results/peak-load.json

# Scenario 3 — Spike
k6 run -e LOAD_TEST_ENV=local load-tests/k6-spike.js --out json=load-test-results/spike.json

# Scenario 4 — Soak (24 hours — run overnight)
k6 run -e LOAD_TEST_ENV=local load-tests/k6-soak.js --out json=load-test-results/soak.json

# Scenario 5 — Concurrency (RESET STOCK TO 1 FIRST — see script header)
k6 run -e LOAD_TEST_ENV=local load-tests/k6-concurrency.js --out json=load-test-results/concurrency.json

# Scenario 6 — Outbox relay throughput
k6 run -e LOAD_TEST_ENV=local load-tests/outbox-relay-throughput.js --out json=load-test-results/outbox-relay.json
```

## Results

Results are saved to `load-test-results/` as JSON summaries.
HTML reports can be generated with k6's built-in dashboard:

```bash
k6 run --out web-dashboard=open k6-normal-load.js
```

Scenarios 1, 2, 5, and 6 also POST their measured P95 latency to event-service's
`POST /admin/performance/samples` (see `reportSamplesToEventService` in `k6-helpers.js`),
so `GET /admin/performance/baselines` reflects real measured numbers instead of staying
empty. This requires event-service to be reachable at `BASE_EVENT_URL` (default
`http://localhost:3023`) with a user holding `PERFORMANCE_VIEW`.

## Acceptance Criteria

- Scenario 1: P95 < 500ms, P99 < 1000ms, error rate < 0.1% → **PASS**
- Scenario 5: Exactly 1 success, 199 InsufficientStockError → **PASS**

## Known gaps (not yet done — see IMPLEMENTATION-NOTES.md)

- No live Docker/Postgres/k6 was available in the session that wired up samples-posting and
  the outbox-relay scenario — none of this has been run against a live stack yet. The four
  hardcoded `TARGETS` in `apps/event-service/src/api/performance.routes.ts` are still
  engineering guesses, not measured baselines. Run the scenarios above against a real dev
  stack and update `TARGETS` (with a dated comment citing the source run) once real numbers
  exist — don't fabricate them.
- No CI job runs these against a live multi-service stack yet (see `ci.yml`'s
  `load-test-validate` job, which only syntax-checks the scripts). Standing up all 14 app
  services + Kafka + Elasticsearch + MinIO inside a GitHub Actions runner is a bigger,
  separate piece of infra work — the `load-test` workflow-dispatch job assumes a reachable
  target environment (e.g. a real staging URL via `LOAD_TEST_*_URL` secrets), which this
  project doesn't have yet per `[[project_dev_phase_no_data]]`.
