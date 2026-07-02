# Go-Live Runbook — NEXORAA ERP
## Version 1.0 | Cloth Retail ERP — Production Go-Live Procedure

> **This runbook is the authoritative go-live procedure.**  
> **Follow every step in sequence. Do not skip steps.**  
> **If ANY checkpoint fails → STOP and escalate immediately.**

---

## Pre-Conditions (ALL must be satisfied before D-7)

| Pre-Condition | Owner | Status |
|---------------|-------|--------|
| All 40 UAT scenarios passed | QA Lead | ☐ |
| All 5 user roles training completed | Training Lead | ☐ |
| Production infrastructure provisioned (K8s cluster, DB, Redis, Kafka) | DevOps | ☐ |
| Production environment variables set in Vault | DevOps | ☐ |
| Production GSTIN configured in Organization settings | Business Owner | ☐ |
| Production WhatsApp, SMS, SendGrid accounts live | Tech Lead | ☐ |
| Support channels configured (Jira project, Slack channel, WhatsApp Business) | PM | ☐ |
| Rollback procedure tested in staging | DevOps | ☐ |
| Emergency contacts documented (see War Room Roster below) | PM | ☐ |

---

## D-7: Final Migration Dry-Run

**Date:** _____________ (7 days before go-live)  
**Responsible:** Backend Engineer + Business Owner

### Steps
1. [ ] Take a snapshot of the production data from the old system (Busy/Tally/Excel)
2. [ ] Copy old system data to staging environment (no production data on dev machine)
3. [ ] Run migration DRY_RUN for all entities in order:
   ```bash
   export DATABASE_URL="postgresql://erp:***@staging-db:5432/erp"
   erp-migrate customers --source=busy --file=customers.csv --tenant=1 --mode=DRY_RUN
   erp-migrate suppliers --source=busy --file=suppliers.csv --tenant=1 --mode=DRY_RUN
   erp-migrate items --source=busy --file=items.csv --tenant=1 --mode=DRY_RUN
   erp-migrate opening-stock --source=excel --file=stock.xlsx --tenant=1 --mode=DRY_RUN
   erp-migrate opening-balances --source=excel --file=balances.xlsx --tenant=1 --mode=DRY_RUN
   ```
4. [ ] Fix ALL errors reported by DRY_RUN
5. [ ] Re-run DRY_RUN until zero errors
6. [ ] Run full EXECUTE on staging to confirm clean migration
7. [ ] Run reconciliation: `erp-migrate verify --tenant=1 --source-customers=N --source-items=M`
8. [ ] Reconciliation report: ALL checks PASS

**Checkpoint D-7:** ☐ Dry-run passed on staging with zero errors

---

## D-5: UAT Sign-Off

**Date:** _____________ (5 days before go-live)  
**Responsible:** Business Owner

### Steps
1. [ ] Open [UAT environment](http://uat.erp.nexoraa.com)
2. [ ] Run all 40 UAT scenarios from `docs/uat-test-scenarios.md`
3. [ ] All 40 scenarios: PASS
4. [ ] Business owner signs the UAT sign-off sheet
5. [ ] Scan and email signed sheet to: nexoraatech.seo@gmail.com

**Checkpoint D-5:** ☐ UAT sign-off received from business owner

---

## D-3: Training Completion Confirmation

**Date:** _____________ (3 days before go-live)  
**Responsible:** Training Lead

### Steps
1. [ ] Confirm all staff have completed their role-specific training module:
   - [ ] Owner: OWNER_GUIDE.md — 5 modules
   - [ ] All cashiers: CASHIER_GUIDE.md — 5 modules
   - [ ] Accountant: ACCOUNTANT_GUIDE.md — 5 modules
   - [ ] Purchase Manager: PURCHASE_MANAGER_GUIDE.md — 4 modules
   - [ ] HR Manager: HR_MANAGER_GUIDE.md — 4 modules
2. [ ] Conduct a Q&A session — collect and resolve any doubts
3. [ ] Distribute quick-reference cards to each staff member

**Checkpoint D-3:** ☐ All role-based training completed and confirmed

---

## D-1: System Freeze

**Date:** _____________ (day before go-live — end of business)  
**Time:** End of business day (typically 8:00 PM)  
**Responsible:** Business Owner + Backend Engineer

### Steps
1. [ ] **Freeze old system:** Disable new entry creation in Busy/Tally (read-only mode or log out all users)
2. [ ] Print and file all outstanding reports from old system:
   - [ ] Outstanding receivables report
   - [ ] Outstanding payables report
   - [ ] Stock valuation report
   - [ ] Trial balance as of today
   - [ ] Bank balance from bank app/statement
3. [ ] Run final export from old system:
   ```
   Busy: Export → All masters + outstanding balances as of today's date
   Note: Record exact totals (customer outstanding = ₹X, supplier outstanding = ₹Y, stock value = ₹Z)
   ```
4. [ ] Save final export files with timestamp in filename: `customers_2026-07-15.csv`
5. [ ] Upload files to migration folder (accessible by migration engineer)

**Checkpoint D-1:** ☐ Old system frozen, final export taken, totals recorded

---

## D-0 00:00 — Migration Begins

**Time:** 12:00 AM (midnight)  
**Responsible:** Backend Engineer + DevOps  
**Location:** War room (physical or video call)

### Environment Setup
```bash
# Confirm production DB is accessible
psql $DATABASE_URL -c "SELECT version();"

# Confirm all services are running
curl -s http://sales-service:3013/health | jq '.status'
curl -s http://inventory-service:3012/health | jq '.status'
curl -s http://accounting-service:3019/health | jq '.status'
curl -s http://auth-service:3010/health | jq '.status'
```

### Migration Execution (in order — do NOT parallelize)

```bash
export DATABASE_URL="postgresql://erp:***@prod-db:5432/erp"
TENANT=1  # Production tenant ID

# Step 1: Customers
erp-migrate customers --source=busy --file=customers_FINAL.csv --tenant=$TENANT --mode=EXECUTE
# → Note: X customers inserted, Y errors

# Step 2: Suppliers
erp-migrate suppliers --source=busy --file=suppliers_FINAL.csv --tenant=$TENANT --mode=EXECUTE

# Step 3: Items
erp-migrate items --source=busy --file=items_FINAL.csv --tenant=$TENANT --mode=EXECUTE

# Step 4: Opening Stock
erp-migrate opening-stock --source=excel --file=stock_FINAL.xlsx --tenant=$TENANT --mode=EXECUTE

# Step 5: Opening Balances
erp-migrate opening-balances --source=excel --file=balances_FINAL.xlsx --tenant=$TENANT --mode=EXECUTE
```

**Error threshold:** If more than 2% rows fail for any entity → **STOP and escalate**.

### Migration Log Template
```
Customer migration:  ___ inserted, ___ errors, duration: ___s
Supplier migration:  ___ inserted, ___ errors, duration: ___s
Item migration:      ___ inserted, ___ errors, duration: ___s
Opening stock:       ___ inserted, ___ errors, duration: ___s
Opening balances:    ___ inserted, ___ errors, duration: ___s
```

---

## D-0 04:00 — Migration Complete, Run Validation Suite

**Time:** 4:00 AM  
**Responsible:** Backend Engineer

```bash
# Full reconciliation with source totals from D-1 freeze
erp-migrate verify --tenant=1 \
  --source-customers=ACTUAL_COUNT \
  --source-suppliers=ACTUAL_COUNT \
  --source-items=ACTUAL_COUNT \
  --source-customer-outstanding=ACTUAL_TOTAL \
  --source-supplier-outstanding=ACTUAL_TOTAL \
  --source-stock-value=ACTUAL_TOTAL
```

**All 7 reconciliation checks must PASS:**
- [ ] Customer count matches ± 0
- [ ] Supplier count matches ± 0
- [ ] Item count matches ± 0
- [ ] Customer outstanding within ₹10 tolerance
- [ ] Supplier outstanding within ₹10 tolerance
- [ ] Stock value within ₹10 tolerance
- [ ] Trial balance: DR = CR exactly

**Checkpoint D-0 04:00:** ☐ All reconciliation checks PASS

---

## D-0 06:00 — Go/No-Go Meeting

**Time:** 6:00 AM  
**Attendees:** Business Owner, Backend Engineer, Frontend Engineer, DevOps  
**Format:** 15-minute video call

### Go/No-Go Decision Framework

| Condition | Decision |
|-----------|----------|
| All reconciliation checks pass + zero P0 issues | **GO ✅** |
| 1–2 reconciliation checks fail with known workaround | **Conditional GO** (document, fix within 24h) |
| Any reconciliation check fails by >₹100 | **NO-GO ❌** |
| Any core service (auth, sales, inventory) returning 5xx | **NO-GO ❌** |

**Decision recorded:** ☐ GO  ☐ NO-GO  
**Signed by:** ______________________ Time: ______

---

## D-0 09:00 — Business Opens on New ERP

**Time:** 9:00 AM (when shop opens)  
**Responsible:** All team

### Pre-Opening Checklist
1. [ ] All staff logged into ERP with their credentials
2. [ ] First test invoice created and confirmed by cashier (with owner watching)
3. [ ] First test payment received and recorded
4. [ ] Dashboard shows the test invoice in today's sales
5. [ ] POS terminal functional: barcode scan works

### War Room Active (D-0 to D+2)
| Role | Person | Phone | Availability |
|------|--------|-------|-------------|
| Backend Engineer | _____________ | _____________ | On-call 24x7 |
| Frontend Engineer | _____________ | _____________ | On-call 24x7 |
| DevOps Engineer | _____________ | _____________ | On-call 24x7 |
| Project Manager | _____________ | _____________ | Business hours |
| Business Owner | _____________ | _____________ | On-site |

### Issue Escalation in War Room
```
User reports issue
      ↓
PM documents in Jira with screenshot
      ↓
Classify: P0 (down) / P1 (major) / P2 (minor)
      ↓
P0 → backend engineer immediately
P1 → backend engineer within 30 min
P2 → add to hotfix queue
```

---

## D+1 EOD — First Day Debrief

**Time:** End of first business day  
**Attendees:** All war room members

### Debrief Agenda
1. How many invoices were created today?
2. Any issues encountered? What P0/P1 issues?
3. Staff feedback — what was confusing or slow?
4. Any data quality issues discovered?
5. Outstanding tasks from today

### First Day Success Metrics
| Metric | Target | Actual |
|--------|--------|--------|
| Invoices created | > 0 | |
| Payments recorded | > 0 | |
| P0 issues | 0 | |
| P1 issues | < 3 | |
| Staff able to use system | 100% | |

---

## D+7 — First Week Review

**Responsible:** PM + Business Owner

1. [ ] Total invoices for the week — compare with last week on old system
2. [ ] All staff comfortable with their modules (if not: schedule extra training)
3. [ ] Any recurring P1/P2 issues — prioritize in next sprint
4. [ ] Bank reconciliation completed for the week
5. [ ] GST entries are accumulating correctly (spot-check 5 invoices for GST)
6. [ ] Old system still accessible in read-only mode (verify)

---

## D+30 — First Month Review & Celebration

**Responsible:** PM + Business Owner

1. [ ] GSTR-1 filed for the first ERP month
2. [ ] GSTR-3B filed
3. [ ] Month-end reports generated: P&L, Trial Balance
4. [ ] Staff productivity assessment — any additional training needs?
5. [ ] Outstanding P1/P2 issues resolved
6. [ ] Plan for next quarter's enhancements

**🎉 Celebrate: First month on new ERP! Share milestone with team.**

---

## Rollback Plan

### When to Rollback
- Migration fails with >5% error rate on any entity
- Reconciliation check fails by >₹1,000 on any metric
- Core service (auth, sales, inventory, accounting) is down for >30 minutes
- Business owner requests rollback at any point before D+1

### Rollback Procedure
```bash
# Step 1: Notify all users immediately
# "We are rolling back to the old system. Please log out of ERP."

# Step 2: Restore old system (ensure it was in read-only, not disabled)
# Un-freeze Busy/Tally (enable new entry creation)

# Step 3: Flush ERP production data for this tenant
psql $DATABASE_URL -c "DELETE FROM customers WHERE tenant_id = 1 AND created_at >= 'MIGRATION_START_TIMESTAMP';"
psql $DATABASE_URL -c "DELETE FROM suppliers WHERE tenant_id = 1 AND created_at >= 'MIGRATION_START_TIMESTAMP';"
psql $DATABASE_URL -c "DELETE FROM items WHERE tenant_id = 1 AND created_at >= 'MIGRATION_START_TIMESTAMP';"
# (Run migration rollback script: tools/migration/rollback.sh)

# Step 4: Notify business owner and staff
# "We have rolled back to the old system. ERP go-live is postponed to [new date]."

# Step 5: Post-mortem within 24 hours — document what went wrong
```

### Old System Availability
Keep the old system (Busy/Tally) accessible in read-only mode for **30 days** after go-live.  
Read-only means: Users can query/view/print, but cannot create new entries.  
This ensures you can reference historical data during the transition period.

---

## Post-Go-Live Monitoring Checklist (First 72 Hours)

Check every 4 hours during business hours:

| Check | Command / URL |
|-------|--------------|
| All services healthy | curl http://api-gateway/health |
| Error rate < 1% | Grafana → Service Overview → Error Rate |
| No DLQ depth > 0 | Grafana → Business Health → DLQ Depth |
| No stalled sagas | Grafana → Saga → Stalled Count |
| DB replication lag < 5s | Grafana → Database → Replication Lag |
| No stock went negative | Grafana → StockWentNegative alert |

---

*Generated by: ERP Phase 14 | Date: 2026-07-01*  
*Approved by: _________________ | Date: _________________*
