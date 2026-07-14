# 18 — Performance & Scalability Considerations

## Current Bottlenecks (factual, from `00_CURRENT_STATE_ASSESSMENT.md`)

1. **Recipient fan-out is in-request, fixed batches of 25 via `Promise.all`.** Works fine for hundreds of
   recipients; risks HTTP timeouts and blocks the sending service instance for thousands+.
2. **Scheduling precision is a 5-minute cron poll.** Fine for today's single-shot scheduling; becomes a
   real constraint once recurring/timezone/business-hours scheduling (CP-5) needs finer control.
3. **Segments are computed on every read**, no materialization. Fine at current customer-table sizes;
   watch as new behavioral/aggregate fields (CP-3) add subquery cost.
4. **No table partitioning** on `campaigns`/`campaign_recipients`. Fine at current volume; a concern only at
   enterprise-scale multi-tenant send volume (thousands of campaigns × tens of thousands of recipients each).

## Design Responses

| Bottleneck             | Response                                                                                                                                                                                                   | Phase                                            |
| ---------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------ |
| In-request fan-out     | Move to a background worker/queue consuming recipient batches; HTTP request only enqueues                                                                                                                  | CP-5                                             |
| 5-minute poll          | Event-driven dispatch trigger (queue-based) once CP-5's worker exists, replacing poll-based precision limits; exact mechanism (shorter poll vs. push-based) is a CP-5 implementation decision              | CP-5                                             |
| Segment recompute cost | Add indexes for new aggregate fields as needed; consider a materialized summary table (e.g. nightly-refreshed purchase aggregates) only if CP-3 profiling shows it's needed — don't build it speculatively | CP-3 (indexes), CP-8 (materialization if needed) |
| No partitioning        | Defer until data volume actually warrants it; not a launch blocker                                                                                                                                         | CP-8, watch-item only                            |

## Volume Assumptions (for capacity planning during implementation)

- Single tenant: up to ~50,000 customers, campaigns targeting up to ~10,000 recipients per send.
- Platform-wide: multiple tenants, each isolated by `tenant_id` — no cross-tenant query ever, so per-tenant
  volume is the relevant scaling unit, not aggregate platform volume, for most of this design.
- Provider rate limits (MSG91/SendGrid/Meta) are the practical ceiling on send throughput regardless of
  internal architecture — the queue/worker design (CP-5) must respect per-provider rate limits, not just
  maximize internal throughput.

## Multi-Tenant Scale Requirements

- **NFR-06** (tenant isolation) applies to every new table introduced in `17_DATA_MODEL_AND_API_DESIGN.md` —
  no exceptions.
- Background workers (CP-5) must not let one tenant's large campaign starve another tenant's smaller one —
  fair-queueing or per-tenant concurrency caps should be considered during CP-5 implementation (matches the
  existing `local_dev_run_gotchas` lesson that a shared concurrency cap can starve services — the same
  failure mode applies here across tenants, not just across dev services).

## What NOT to Build Ahead of Need

Per CLAUDE.md's simplicity guidance: do not introduce a new message-broker technology, a new caching layer,
or table partitioning until profiling under this roadmap's actual phases shows they're needed. The
architecture should make adding them possible later (queue-based dispatch design, additive schema) without
requiring them on day one.
