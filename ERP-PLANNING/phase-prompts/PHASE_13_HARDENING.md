# PHASE 13 — ENTERPRISE HARDENING — SESSION STARTER PROMPT

---

```
You are the Principal Security Engineer + Performance Engineer + DevOps Lead on an enterprise Cloth Retail ERP. Your job: make Phase 13 — Enterprise Hardening. No new features. Make what exists correct, secure, and production-ready under real-world conditions. Do NOT redesign.

═══════════════════════════════════════════
MANDATORY READING
═══════════════════════════════════════════
All the file in teh phase-completion and phase prompt, readme.md adn all other .md files 
Read: ERP-PLANNING/TECH_AUDIT.md       <- full stack, all packages+versions, what NOT to add
Read: ERP-PLANNING/TEST_CREDENTIALS.md  <- test logins (email/password/tenantId) for dev/smoke testing
Read: ERP-PLANNING/ERP_MASTER_SPEC.md
Read: ERP-PLANNING/CODING_STANDARDS.md
Read: ERP-PLANNING/phase-completions/PHASE_12_COMPLETION.md  ← performance baseline numbers

═══════════════════════════════════════════
THIS PHASE PRODUCES EVIDENCE, NOT CODE
═══════════════════════════════════════════

Most of this phase produces test reports, audit results, and runbooks — not application code.
The code changes are: fixing whatever the tests find.
Every acceptance criteria item must be VERIFIED, not assumed.

═══════════════════════════════════════════
MILESTONE SEQUENCE
═══════════════════════════════════════════

MILESTONE 13.1 — Security Audit and Hardening
  Task 13.1.1: HTTP Security Headers
    Add to all API responses via Fastify plugin:
      Content-Security-Policy: default-src 'self'; script-src 'self'; ...
      X-Frame-Options: DENY
      X-Content-Type-Options: nosniff
      Strict-Transport-Security: max-age=63072000; includeSubDomains; preload
      Referrer-Policy: strict-origin-when-cross-origin
      Permissions-Policy: camera=(), microphone=(), geolocation=()
    Verify with: securityheaders.com scan (must score A+)
    
  Task 13.1.2: Dependency Vulnerability Scan
    Run: pnpm audit --audit-level=moderate
    Run: Snyk scan (pnpm dlx snyk test)
    Fix: all Critical and High vulnerabilities
    Add to CI/CD: fail pipeline if new High/Critical found
    
  Task 13.1.3: Container Security Scan
    Run Trivy on all service Docker images:
      trivy image --exit-code 1 --severity HIGH,CRITICAL erp-sales-service:latest
    Fix all CRITICAL CVEs in base images
    Use: node:20-alpine (minimal surface area)
    
  Task 13.1.4: SAST (Static Application Security Testing)
    Run Semgrep with rules:
      semgrep --config=auto --config=p/owasp-top-ten
    Fix: all HIGH findings
    
  Task 13.1.5: Secrets Scanner
    Run: git-secrets or truffleHog on entire git history
    Ensure: no secrets committed to any branch (ever)
    Verify: all secrets are in Vault (check each service's config loading)
    
  Task 13.1.6: Auth Security Hardening
    □ Test: brute force → lockout after 5th attempt (automated test)
    □ Test: JWT expiry → 401 after 15 minutes (automated test)
    □ Test: refresh token rotation → old token invalid after use
    □ Test: concurrent session limit (if configured)
    □ Test: SQL injection on all search inputs → Drizzle prevents (verify)
    □ Test: XSS: inject <script> in customer name → must be escaped in UI
    □ Test: IDOR: try to access tenant B's invoice with tenant A's token → 403
    □ Test: mass assignment: try to set tenant_id in request body → ignored
    
  PENTEST READINESS CHECKLIST:
    Before external VAPT:
    □ All OWASP Top 10 self-tested with above checks
    □ Security headers: A+ score
    □ All CVEs fixed in dependencies and containers
    □ No secrets in code
    □ Tenant isolation tested

MILESTONE 13.2 — Load Testing
  Tool: k6 (https://k6.io)
  
  Write k6 test scripts for all 5 scenarios from roadmap:
  
  Scenario 1 — Normal Load (baseline):
    Script: k6-normal-load.js
    Config: 50 VUs, 30 minutes, ramping (0→50 in 2 min, hold, 50→0 in 2 min)
    Mix: 60% read (GET /invoices, GET /stock), 30% invoice create, 10% reports
    Targets: P95 < 500ms, P99 < 1000ms, error rate < 0.1%
    
  Scenario 2 — Peak Load (Diwali simulation):
    Script: k6-peak-load.js
    Config: 200 VUs, 2 hours
    Targets: P95 < 2000ms, error rate < 1%
    
  Scenario 3 — Spike Test:
    Script: k6-spike.js
    Config: 10→500 VUs in 2 minutes, hold 2 min, drop
    Verify: HPA fires and scales correctly within 90 seconds
    
  Scenario 4 — Soak Test:
    Script: k6-soak.js
    Config: 100 VUs, 24 hours
    Monitor: memory usage per pod (should not grow over time)
    
  Scenario 5 — Concurrency / Stock Integrity:
    Script: k6-concurrency.js
    Config: 200 VUs all trying to buy the last unit of one item simultaneously
    Verify: exactly 1 success, 199 InsufficientStockError responses, stock = 0 after
    
  Performance fixes: profile and fix any bottleneck found by load tests
  
  Output: load-test-results/ folder with:
    - HTML report per scenario
    - P50/P95/P99/Max metrics
    - Error breakdown
    - Pass/Fail verdict

MILESTONE 13.3 — Database Optimization
  Task 13.3.1: Index Audit
    Run EXPLAIN ANALYZE on every API endpoint's SQL queries with realistic data volume
    Expected indexes (verify all exist):
      □ (tenant_id, customer_id, created_at) on invoices
      □ (tenant_id, item_id, warehouse_id) on inventory_ledger  
      □ (tenant_id, created_at) on financial_entries
      □ (tenant_id, status, created_at) on purchase_orders
      □ GIN index on customers.name for pg_trgm search
    Add any missing indexes
    
  Task 13.3.2: Query Optimization
    From slow query log (enabled in Phase 12): fix top 10 slowest queries
    Document: what was changed and measured improvement
    
  Task 13.3.3: Connection Pool Tuning
    PostgreSQL max_connections: set per service based on peak concurrency
    PgBouncer in front of PostgreSQL (transaction mode pooling)
    Redis pipeline: batch Redis commands where possible

MILESTONE 13.4 — Chaos Engineering
  Run the monthly chaos calendar from architecture specification:
  
  Week 1 — Network faults:
    □ Kill inventory-service pod during invoice creation → saga compensates → no stuck invoices
    □ Redis goes down → auth still works? No cached data served? → verify fallback
    
  Week 2 — Database faults:
    □ Primary DB fails → auto-failover to replica in < 30 seconds
    □ Inject 500ms DB latency → P95 API latency under 1000ms still
    
  Week 3 — External service faults:
    □ NIC e-Invoice API times out → invoice confirmed, IRN retry queued, no error to user
    □ MSG91 SMS API returns 500 → notification retried, not lost, user not blocked
    □ Kafka unavailable → outbox accumulates → normal processing resumes when Kafka back
    
  Week 4 — Resource exhaustion:
    □ Pod runs out of memory → OOM kill → K8s restarts → no data loss
    □ Redis evicts cache under memory pressure → cache miss → DB queries → still correct
    
  Document each chaos experiment:
    - What was injected
    - Expected behavior
    - Actual behavior
    - Pass/Fail
    - Fix (if failed)
  
  Output: chaos-engineering-report.md

MILESTONE 13.5 — Disaster Recovery Drill
  Simulate full DR scenario:
    1. Take production backup snapshot
    2. Restore to isolated environment (different namespace/cluster)
    3. Run validation suite:
       □ All services start within 5 minutes
       □ All health checks green
       □ Can log in with test user
       □ Customer count matches backup
       □ Last invoice in backup accessible
       □ Run a test invoice → succeeds
       □ Run trial balance → balances
    4. Document: actual RTO achieved
    5. Document: actual RPO (last committed data in backup)
    
  Output: dr-drill-report.md with RTO/RPO measurements

MILESTONE 13.6 — Monitoring Completeness
  Verify Grafana dashboards cover:
    □ Service Overview: request rate, error rate, P50/P95/P99 per service
    □ Infrastructure: CPU, memory, disk, network per pod
    □ Business Health: invoices/hour, failed invoice rate, DLQ depth
    □ Database: query time, connection count, replication lag
    □ Kafka: consumer lag per consumer group
    □ Saga: active, failed, compensation rate
    
  Alert verification:
    Test each alert rule fires correctly:
    □ API error rate > 5% for 5 minutes → PagerDuty
    □ DLQ depth > 10 → Slack #infra-alerts
    □ DB replication lag > 30s → Slack #infra-alerts  
    □ Stalled saga > 30 min → Slack #engineering
    □ Stock went negative (should never happen) → PagerDuty P0

═══════════════════════════════════════════
ACCEPTANCE CRITERIA
═══════════════════════════════════════════

✅ Security: zero Critical/High vulnerabilities in dependency scan and SAST
✅ Security: HTTP headers score A+ on securityheaders.com
✅ Tenant isolation: IDOR test → 100% return 403 (never leak cross-tenant data)
✅ Load test Scenario 1: P95 < 500ms, error rate < 0.1% (result report attached)
✅ Load test Scenario 5: exactly 1 success for last-unit concurrent buy
✅ Chaos: all 8 experiments passed (system recovered correctly)
✅ DR drill: RTO achieved < 30 min for Standard tier (measured, not estimated)
✅ All 6 Grafana dashboard categories populated with real data
✅ All 5 alert rules tested and confirmed firing

Output: Hardening Evidence Report (compile all sub-reports into one document).

═══════════════════════════════════════════
POST-IMPLEMENTATION VERIFICATION CHECKLIST
═══════════════════════════════════════════

Once all milestones above are done, run every check below before generating the report.
Do NOT skip any step. Fix all issues found before moving on.

── 1. MILESTONE COMPLETENESS ────────────────────────────────────────────────
Re-read EVERY milestone in this prompt. For each one confirm:
  ✔ Schema table(s) exist in migration file
  ✔ Domain service / business logic implemented
  ✔ API routes registered with authenticate + requirePermission
  ✔ Zod validation on all request bodies and query params
  ✔ Outbox event written in same DB transaction (all state-changing ops)
  ✔ Audit log entry written
  ✔ Frontend page / component wired (if applicable)
List any milestone, sub-step, or field that is missing or partial. Fix before proceeding.

── 2. VALIDATION COVERAGE ───────────────────────────────────────────────────
For every new API route in this phase verify:
  ✔ 400 returned for invalid/missing request body fields
  ✔ 401 returned when Authorization header is absent
  ✔ 403 returned when user lacks required permission
  ✔ 404 returned for unknown IDs (with tenant_id scope — never leak cross-tenant data)
  ✔ 422 returned for business rule violations (insufficient stock, duplicate, etc.)
  ✔ All error responses use { error: { code, message, details? } } envelope
  ✔ All success responses use { data: { ... } } envelope

── 3. BUILD CHECK ───────────────────────────────────────────────────────────
Run build for every service and frontend touched in this phase:

  pnpm --filter @erp/<service-name> build      ← repeat for each modified service
  pnpm --filter @erp/web-frontend build
  pnpm --filter @erp/pos-frontend build        ← only if POS was changed

Zero build errors required. Fix all before proceeding.

── 4. TYPESCRIPT STRICT CHECK ──────────────────────────────────────────────
Run type-check for each modified service:

  pnpm --filter @erp/<service-name> type-check

Zero errors required. Specifically fix:
  ✔ No implicit `any` — use `unknown` or proper types
  ✔ All function return types declared
  ✔ No non-null assertions (!) unless unavoidable with a comment
  ✔ No `as unknown as X` casts without justification
  ✔ Consistent type imports (import type { ... })

── 5. LOCAL RUN & SMOKE TEST ────────────────────────────────────────────────
Start each modified service in dev mode:

  pnpm --filter @erp/<service-name> dev

Then test EVERY new API endpoint manually (curl or browser):
  ✔ Happy path returns correct response and status code
  ✔ GET /health returns { status: "ok" } on the service port
  ✔ Unauthenticated request returns 401
  ✔ Insufficient permission returns 403
  ✔ Invalid body returns 400 with field-level errors
  ✔ Full lifecycle flow works end-to-end (e.g., DRAFT → CONFIRM → PAID)

For frontend changes open http://localhost:5173, login, and verify:
  ✔ Navigate to every new page — no blank screen, no console errors
  ✔ Create, list, edit, delete flows all work
  ✔ Loading states, empty states, and error toasts display correctly
  ✔ Dark mode renders correctly on all new components

── 6. GENERATE PHASE COMPLETION REPORT ─────────────────────────────────────
Generate the Phase Completion Report using the template at:
  ERP-PLANNING/PHASE_COMPLETION_TEMPLATE.md

Save it as:
  ERP-PLANNING/phase-completions/PHASE_13_COMPLETION.md

The report must be generated and saved BEFORE closing this session.

```