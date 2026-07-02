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

## Scenarios

| Script | Scenario | VUs | Duration | Key Threshold |
|--------|----------|-----|----------|--------------|
| `k6-normal-load.js` | Scenario 1 — Baseline | 50 | 30 min | P95 < 500ms, error < 0.1% |
| `k6-peak-load.js` | Scenario 2 — Diwali peak | 200 | 2 hours | P95 < 2000ms, error < 1% |
| `k6-spike.js` | Scenario 3 — Spike | 10→500 | ~8 min | No 5xx cascade |
| `k6-soak.js` | Scenario 4 — Soak | 100 | 24 hours | No memory growth |
| `k6-concurrency.js` | Scenario 5 — Last-unit race | 200 | 2 min | Exactly 1 success |

## Running

```bash
# Scenario 1 — Normal Load (run this first to establish baseline)
k6 run load-tests/k6-normal-load.js --out json=load-test-results/normal-load.json

# Scenario 2 — Peak Load
k6 run load-tests/k6-peak-load.js --out json=load-test-results/peak-load.json

# Scenario 3 — Spike
k6 run load-tests/k6-spike.js --out json=load-test-results/spike.json

# Scenario 4 — Soak (24 hours — run overnight)
k6 run load-tests/k6-soak.js --out json=load-test-results/soak.json

# Scenario 5 — Concurrency (RESET STOCK TO 1 FIRST — see script header)
k6 run load-tests/k6-concurrency.js --out json=load-test-results/concurrency.json
```

## Results

Results are saved to `load-test-results/` as JSON summaries.
HTML reports can be generated with k6's built-in dashboard:

```bash
k6 run --out web-dashboard=open k6-normal-load.js
```

## Acceptance Criteria

- Scenario 1: P95 < 500ms, P99 < 1000ms, error rate < 0.1% → **PASS**
- Scenario 5: Exactly 1 success, 199 InsufficientStockError → **PASS**
