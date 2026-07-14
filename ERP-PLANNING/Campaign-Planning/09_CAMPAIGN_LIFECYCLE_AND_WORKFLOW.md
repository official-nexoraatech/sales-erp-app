# 09 — Campaign Lifecycle & Workflow

## Current State Machine (as implemented today)

```
DRAFT --schedule()--> SCHEDULED --dispatch (cron)--> SENDING --> SENT
DRAFT --send()------------------------------------------------> SENDING --> SENT
DRAFT/SCHEDULED --cancel()--> CANCELLED
(any send failure path) --> FAILED
```

No `PAUSED`, no `PENDING_APPROVAL`/`APPROVED`, no `ARCHIVED`, no re-entry from `CANCELLED`/`FAILED` back to
`DRAFT`, no edit while `SCHEDULED`.

## Target State Machine

```
                 ┌─────────────┐
                 │    DRAFT     │◄───────────────────────┐
                 └──────┬───────┘                        │ (reject / edit)
                        │ submit for approval             │
                        ▼                                 │
              ┌────────────────────┐                      │
              │ PENDING_APPROVAL   │──────────────────────┘
              │ (skipped if tenant │
              │  approval is off)  │
              └─────────┬──────────┘
                        │ approve
                        ▼
                 ┌─────────────┐     schedule       ┌─────────────┐
                 │  APPROVED   │───────────────────►│  SCHEDULED   │
                 └──────┬──────┘                    └──────┬───────┘
                        │ send now                          │ dispatch time reached
                        ▼                                   ▼
                 ┌─────────────────────────────────────────────┐
                 │                   RUNNING                     │
                 │ (was SENDING; renamed conceptually, same      │
                 │  storage value preserved — see migration doc) │
                 └───────┬───────────────────────┬──────────────┘
                         │ pause                  │ all recipients processed
                         ▼                        ▼
                  ┌─────────────┐           ┌─────────────┐
                  │   PAUSED    │──resume──►│  COMPLETED  │ (was SENT)
                  └─────────────┘           └──────┬──────┘
                                                    │ retention period elapsed
                                                    ▼
                                             ┌─────────────┐
                                             │  ARCHIVED   │
                                             └─────────────┘

Side states reachable from DRAFT/PENDING_APPROVAL/APPROVED/SCHEDULED/PAUSED:
  --cancel()--> CANCELLED
  (unrecoverable send-path error) --> FAILED
```

## Transition Table

| From                                             | Event                   | To                                 | Guard                                                                  | Phase                           |
| ------------------------------------------------ | ----------------------- | ---------------------------------- | ---------------------------------------------------------------------- | ------------------------------- |
| DRAFT                                            | edit                    | DRAFT                              | always allowed                                                         | CP-4                            |
| DRAFT                                            | submit                  | PENDING_APPROVAL                   | tenant requires approval                                               | CP-7                            |
| DRAFT                                            | submit                  | APPROVED                           | tenant does not require approval (auto-approve)                        | CP-7                            |
| PENDING_APPROVAL                                 | approve                 | APPROVED                           | actor has approve permission                                           | CP-7                            |
| PENDING_APPROVAL                                 | reject                  | DRAFT                              | actor has approve permission; reason required                          | CP-7                            |
| APPROVED                                         | edit                    | DRAFT                              | re-submission required after edit (prevents silent bypass of approval) | CP-7                            |
| APPROVED                                         | schedule                | SCHEDULED                          | `scheduledAt` in future                                                | CP-4 (existing rule, preserved) |
| APPROVED                                         | send                    | RUNNING                            | actor has send permission                                              | CP-4 (existing rule, preserved) |
| SCHEDULED                                        | edit                    | APPROVED (re-approval if required) |                                                                        | CP-4/CP-7                       |
| SCHEDULED                                        | dispatch (system)       | RUNNING                            | `scheduledAt <= now`                                                   | existing, preserved             |
| RUNNING                                          | pause                   | PAUSED                             | actor has send permission                                              | CP-5                            |
| PAUSED                                           | resume                  | RUNNING                            |                                                                        | CP-5                            |
| RUNNING                                          | all recipients terminal | COMPLETED                          | system-driven                                                          | existing (`SENT`), preserved    |
| DRAFT/PENDING_APPROVAL/APPROVED/SCHEDULED/PAUSED | cancel                  | CANCELLED                          | actor has send permission                                              | existing, preserved             |
| COMPLETED                                        | archive                 | ARCHIVED                           | retention policy or manual action                                      | CP-8                            |
| (any)                                            | unrecoverable error     | FAILED                             | system-driven                                                          | existing, preserved             |

## Design Notes

- **No breaking rename.** Internally the existing `SENDING`/`SENT` values are kept in the `status` column;
  `RUNNING`/`COMPLETED` are the UI-facing labels for the same states once the lifecycle is extended, OR (if a
  rename is judged worth it during CP-4/CP-7 implementation) an additive migration maps old→new values with
  both read paths supported during a transition window — the specific choice is an implementation decision
  for CP-4, not fixed here; either way `19_MIGRATION_AND_BACKWARD_COMPATIBILITY.md` governs how it's done
  safely.
- **Approval is optional per tenant.** A tenant that doesn't want the extra step is unaffected — `DRAFT` →
  `APPROVED` auto-transitions, preserving today's "any authorized user can send directly" behavior as a
  configuration, not removing it.
- **Editing an approved/scheduled campaign resets approval.** This closes the gap where someone could get
  approval for one message and swap in another before it sends.
- **Automation-created campaigns** (CP-5) enter this same state machine (typically auto-approved per their
  own configuration) rather than bypassing it — keeps the audit trail and lifecycle uniform per US-07 AC3.
