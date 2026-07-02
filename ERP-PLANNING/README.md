# ERP PLANNING DIRECTORY
## How to Use This Folder

---

## WHAT IS IN THIS FOLDER

This folder contains everything needed to build the Cloth Retail ERP phase by phase, using Claude Code with maximum consistency and zero architecture drift.

```
ERP-PLANNING/
│
├── README.md                        ← YOU ARE HERE — start here
├── TECH_AUDIT.md                    ← READ FIRST: full stack, every package+version, what NOT to add
├── TEST_CREDENTIALS.md              ← Test user logins, tenant IDs, infra passwords for local dev
├── ERP_MASTER_SPEC.md               ← Architecture Bible (NEVER REWRITE)
├── CODING_STANDARDS.md              ← Coding Standards (NEVER REWRITE)
├── ERP_ROADMAP_SUMMARY.md           ← Quick reference: all phases and timeline
├── PHASE_COMPLETION_TEMPLATE.md     ← Template for end-of-phase reports
│
├── phase-prompts/                   ← ONE FILE PER PHASE — copy-paste to start
│   ├── PHASE_0_FOUNDATION.md
│   ├── PHASE_1_PLATFORM.md
│   ├── PHASE_2_MASTER_DATA.md
│   ├── PHASE_3_INVENTORY.md
│   ├── PHASE_4_SALES.md
│   ├── PHASE_5_PURCHASE.md
│   ├── PHASE_6_ACCOUNTING.md
│   ├── PHASE_7_GST.md
│   ├── PHASE_8_HR.md
│   ├── PHASE_9_CRM.md
│   ├── PHASE_10_PRODUCTION.md
│   ├── PHASE_11_REPORTS.md
│   ├── PHASE_12_DISTRIBUTED.md
│   ├── PHASE_13_HARDENING.md
│   └── PHASE_14_PRODUCTION.md
│
└── phase-completions/               ← GENERATED AT END OF EACH PHASE
    ├── PHASE_0_COMPLETION.md        (generated after Phase 0)
    ├── PHASE_1_COMPLETION.md        (generated after Phase 1)
    └── ...
```

---

## HOW TO START A NEW PHASE

### Step 1: Open a NEW Claude Code session (new chat)

Do NOT continue the previous phase's chat. A fresh session has full context for the new phase.

### Step 2: Paste the phase starter prompt

Open the appropriate file in `phase-prompts/` (e.g., `PHASE_3_INVENTORY.md`).
Copy the entire content inside the ``` code block.
Paste it as your FIRST message in the new Claude session.

### Step 3: Provide the architecture files

Claude's prompt will ask you to read:
- `ERP-PLANNING/ERP_MASTER_SPEC.md`
- `ERP-PLANNING/CODING_STANDARDS.md`
- Previous phase completion reports

Claude Code can read these directly from the file system if you are in the same project directory.

### Step 4: Work milestone by milestone

Inside one phase chat, work through milestones in sequence.
Each milestone: architecture → database → API → service → frontend → events → tests.
Do NOT jump milestones or work on two milestones simultaneously.

### Step 5: Generate Phase Completion Report

At the END of the phase, ask Claude to generate the Phase Completion Report:

```
Generate the Phase Completion Report for Phase [N] using the template at:
ERP-PLANNING/PHASE_COMPLETION_TEMPLATE.md

Save it as: ERP-PLANNING/phase-completions/PHASE_[N]_COMPLETION.md
```

This file becomes the handoff document for the next phase.

---

## HOW TO HANDOFF BETWEEN PHASES

At the start of a new phase, Claude's prompt already instructs it to:
1. Read `ERP_MASTER_SPEC.md`
2. Read `CODING_STANDARDS.md`
3. Read the previous phase's `COMPLETION.md`

This gives it full context without re-explaining everything.

### The "4-Document Rule"
Every session must start with:
1. **Tech Audit** (`TECH_AUDIT.md`) — stack, packages, what NOT to add
2. **Architecture Bible** (`ERP_MASTER_SPEC.md`)
3. **Coding Standards** (`CODING_STANDARDS.md`)
4. **Previous Phase Report** (`PHASE_N_COMPLETION.md`)

---

## GOLDEN RULES

### Rules for YOU (the developer/owner):
1. **One phase = one chat.** Never work on two phases in the same session.
2. **Always generate Phase Completion Report** before closing a phase's chat.
3. **Never skip a phase.** The dependency order matters.
4. **If you change anything in `ERP_MASTER_SPEC.md`**, start a new chat — old sessions have cached the old version.
5. **Keep completion reports accurate.** Future Claude sessions will rely on them.

### Rules for Claude (already in the phase prompts):
- Never redesign architecture
- Never simplify specified patterns
- Always write to outbox in same DB transaction
- Always use Platform SDK for infrastructure access
- Always add tenant_id, audit log, permission check to new code
- Generate Phase Completion Report at end

---

## IF CLAUDE STARTS INVENTING ARCHITECTURE

This means it did not read the architecture bible. Stop and say:

> "Stop. Read the file ERP-PLANNING/ERP_MASTER_SPEC.md before continuing.
> The architecture is already decided. Do not redesign it.
> Implement exactly as specified."

---

## IF CLAUDE SKIPS SOMETHING

Look at the phase prompt's milestone list and say:

> "You have not completed Milestone X.Y yet. We need:
> [paste the milestone spec from the phase prompt].
> Complete this before moving to the next milestone."

---

## IF THE CHAT GETS TOO LONG (context limit)

If Claude seems to be losing context of earlier decisions in the same phase, say:

> "Re-read ERP-PLANNING/ERP_MASTER_SPEC.md and
> ERP-PLANNING/phase-completions/PHASE_[N-1]_COMPLETION.md
> to refresh your context, then continue from where we left off."

This restores the critical context without starting over.

---

## QUALITY CHECKPOINTS

After every 3-4 phases, run a dedicated Architecture Review session:

```
This project is building an enterprise cloth retail ERP.
It is currently after Phase [N].

Read ALL files in ERP-PLANNING/phase-completions/

Perform a consistency review:
1. Are all services using the Platform SDK correctly?
2. Are all tables following the naming conventions?
3. Are all API responses following the response envelope format?
4. Are any outbox patterns missing from state-changing operations?
5. Are all permission guards applied to all API endpoints?
6. Are all tables missing tenant_id?
7. Are all dark mode classes applied in the frontend?

Report: list of inconsistencies, phase where they occurred, recommended fix.
```

---

## PROMPTING TIPS

### If you want a specific focus:
> "In this session, focus ONLY on Milestone 4.2 — Sales Invoice.
> Do not start Milestone 4.3 until I confirm Milestone 4.2 is complete."

### If you want code written without asking for permission:
> "Do not ask for my approval before writing code.
> Write the complete implementation, then show me what was done.
> Only ask if you encounter a genuine decision point."

### If you want explanations:
> "Before writing each function, explain in 2 sentences what it does and why."

### If you want tests written alongside code:
> "For every function you write, immediately write the corresponding unit test.
> Do not move to the next function until the current function's test is written."

---

## EMERGENCY CONTACTS (for technical decisions)

If Claude asks about a decision not covered in the architecture:

**Database:** Always add `tenant_id`, `created_at`, `updated_at`, `version`. Use BIGSERIAL PK.
**API:** Always: validate with Zod, require permission, log to audit, return envelope format.
**Events:** Always: write to outbox in same transaction, never publish directly.
**Stock:** Always: atomic SQL check (`UPDATE WHERE qty >= req`), never read-then-check.
**Security:** Always: encrypt PAN/GSTIN/bank accounts, never log sensitive fields.
**Frontend:** Always: permission-gate UI, dark mode, loading/error/empty states, title on icons.

When in doubt: **prefer correctness over speed, and security over convenience.**

---

*This planning kit was engineered to give a development team the best possible chance of building a 99% enterprise-grade ERP with consistent, high-quality code across 15 phases and 16 months of development.*
