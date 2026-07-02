# Production Support Framework — NEXORAA ERP
## Version 1.0 | Effective from Go-Live Date

---

## 1. Support Tiers

### Tier 1 — User Support (End Users)

**Who handles:** Support team / trained implementation partner  
**Channels:**
- WhatsApp Business: +91-XXXXXXXXXX (business hours: 9 AM – 7 PM IST)
- In-app chat widget (bottom-right corner of the ERP)
- Email: support@nexoraatech.com

**SLA:**
| Priority | Response Time | Resolution Time |
|----------|--------------|----------------|
| Urgent (can't invoice) | 1 hour | 4 hours |
| High (major workflow blocked) | 4 hours | Same business day |
| Normal (how-to, configuration) | Next business day | 3 business days |

**Tier 1 handles:**
- "How do I do X?" questions → refer to training guides
- Configuration help (GST settings, number series, user roles)
- Password resets
- Report generation guidance
- Data entry corrections (delete/edit within allowed window)

**Escalation to Tier 2:** If the issue is a software bug (something that *should* work but doesn't), create a Jira ticket and escalate.

---

### Tier 2 — Technical Bugs

**Who handles:** Engineering team (Nexoraa Tech)  
**Tracking:** Jira project: **ERP-BUGS** (nexoraatech.atlassian.net)

**Priority Definitions:**

| Priority | Definition | Examples |
|----------|-----------|---------|
| **P0 — System Down** | Core service unavailable for all users | Login broken, invoices cannot be created, POS down |
| **P1 — Major Feature Broken** | A key workflow is broken for 1+ users | GST calculation wrong, payment not recording, PDF not generating |
| **P2 — Minor Bug** | Feature works but with incorrect result or poor UX | Report number is off by 1, wrong rounding on totals |
| **P3 — Enhancement** | Working as designed but user wants improvement | New report column, different date format |

**SLAs:**

| Priority | Response Time | Fix Deployment |
|----------|--------------|---------------|
| P0 | 1 hour | Hotfix within 4 hours (same day) |
| P1 | 4 hours | Fix in next business day |
| P2 | 24 hours triage | Fix in next sprint (bi-weekly) |
| P3 | 48 hours acknowledgment | Feature release (monthly) |

**How to create a Jira ticket:**
```
Summary: [Module] Brief description
Priority: P0 / P1 / P2 / P3
Steps to reproduce:
  1. Login as [role]
  2. Navigate to [screen]
  3. Do [action]
Expected: [what should happen]
Actual: [what actually happened]
Screenshot: [attach]
Console errors: [attach if any]
Affected tenant ID: [number]
```

---

### Tier 3 — Engineering Escalation

**Who handles:** Senior Backend + Frontend Engineers directly  
**Channel:** Private Slack channel: #erp-[client-name]-escalations  
**Invite:** Business Owner/Admin + Engineering Lead  

**Use Tier 3 for:**
- Data corruption issues
- Security concerns (unauthorized data access)
- Performance degradation affecting business
- Database issues requiring manual intervention

---

## 2. Hotfix Process (P0 / P1)

```
1. P0 alert fires (Grafana → PagerDuty or phone call)
         ↓
2. On-call engineer acknowledges within 15 minutes
         ↓
3. Engineer diagnoses root cause in staging/logs
         ↓
4. Fix developed and tested in staging (< 3 hours)
         ↓
5. PM notifies business: "Fix deploying in X minutes, brief downtime expected"
         ↓
6. Deploy to production (blue-green if possible — zero downtime)
         ↓
7. Verify fix on production (run smoke test)
         ↓
8. PM confirms with business: "Issue resolved"
         ↓
9. Post-mortem written within 24 hours (what happened, why, how prevented)
```

---

## 3. Release Cadence

| Release Type | Frequency | What's included | Notification |
|-------------|-----------|----------------|-------------|
| **Hotfix** | As needed (P0/P1) | Critical bug fixes only | Email + WhatsApp 30 min before |
| **Sprint Release** | Every 2 weeks | P2 bug fixes + small improvements | Email + in-app banner |
| **Feature Release** | Monthly | New features, P3 items | Email + training session |

### Deployment Window
- **Hotfixes:** Any time (service maintained during deployment via rolling update)
- **Sprint/Feature releases:** Saturday 11 PM IST (zero-business-hours)
- **Maintenance window:** Sunday 12 AM – 6 AM IST (if DB migration required)

---

## 4. On-Call Rotation

| Week | Backend Engineer | Frontend Engineer | DevOps |
|------|-----------------|------------------|--------|
| Week 1 | _____________ | _____________ | _____________ |
| Week 2 | _____________ | _____________ | _____________ |

**On-call responsibilities:**
- Monitor Grafana alerts (PagerDuty integration)
- Respond to P0 within 15 minutes (any hour)
- Respond to P1 within 1 hour (business hours) / 2 hours (off-hours)
- Escalate to Tech Lead if resolution not clear within 1 hour

---

## 5. Monitoring Runbook

### Daily Checks (automated — Grafana alerts handle these)
- [ ] All services healthy (`/health` returns `{ "status": "ok" }`)
- [ ] Error rate < 1% (`HighAPIErrorRate` alert)
- [ ] DLQ depth = 0 (`DLQDepthHigh` alert)
- [ ] No stalled sagas (`StalledSagaDetected` alert)

### Weekly Checks (manual — engineering team)
- [ ] DB replication lag < 5 seconds (Grafana → Database panel)
- [ ] Kafka consumer lag < 100 messages (Grafana → Kafka panel)
- [ ] Redis memory < 70% (`maxmemory` policy check)
- [ ] Disk usage < 70% on all nodes
- [ ] Review error logs for any recurring patterns

### Monthly Checks
- [ ] SSL certificate expiry (must have > 60 days remaining)
- [ ] pnpm audit — no new High/Critical CVEs
- [ ] DB backup verified (test restore to staging)
- [ ] Review Prometheus alert rules — are they still firing correctly?
- [ ] Review Grafana dashboards — any missing data?

---

## 6. Data Backup Policy

| Component | Backup Frequency | Retention | Location |
|-----------|-----------------|-----------|----------|
| PostgreSQL (primary) | Every 6 hours | 30 days | MinIO / S3 |
| PostgreSQL WAL | Continuous | 7 days | MinIO / S3 |
| Redis | Daily snapshot | 7 days | MinIO / S3 |
| Kafka topic offsets | Continuous | 7 days | Kafka replication |
| Uploaded files (MinIO) | Daily sync | 90 days | Off-site S3 |

**RTO (Recovery Time Objective):** < 30 minutes (per DR drill report)  
**RPO (Recovery Point Objective):** < 6 hours (last backup)

---

## 7. Key Contacts

| Role | Name | Phone | Email |
|------|------|-------|-------|
| Business Owner | _____________ | _____________ | _____________ |
| Tier 1 Support | _____________ | _____________ | _____________ |
| Backend Lead | _____________ | _____________ | _____________ |
| Frontend Lead | _____________ | _____________ | _____________ |
| DevOps Lead | _____________ | _____________ | _____________ |
| Nexoraa PM | _____________ | _____________ | nexoraatech.seo@gmail.com |

---

## 8. Service Level Agreement Summary

| Metric | SLA Target |
|--------|-----------|
| System uptime | 99.5% monthly (≤ 3.6 hours downtime) |
| P0 response | 1 hour |
| P0 resolution | 4 hours |
| P1 response | 4 hours |
| P1 resolution | Next business day |
| P2 fix | Next bi-weekly sprint |
| Scheduled backup success | 99% monthly |
| DR drill frequency | Quarterly |

---

*Generated by: ERP Phase 14 | Date: 2026-07-01*
