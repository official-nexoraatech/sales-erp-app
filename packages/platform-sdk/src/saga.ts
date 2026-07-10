import { ulid } from 'ulid';
import { and, eq } from 'drizzle-orm';
import { sagaLog, type ErpDatabase } from '@erp/db';
import { BusinessError, NotFoundError } from '@erp/types';

export type SagaStepType = 'COMPENSATABLE' | 'RETRYABLE' | 'IRREVERSIBLE';

export interface SagaStepDefinition<TContext> {
  name: string;
  type: SagaStepType;
  execute: (ctx: TContext) => Promise<void>;
  // Required for COMPENSATABLE steps — the orchestrator does not enforce this at the
  // type level (compensate needs to close over the same TContext as execute), so a step
  // registered as COMPENSATABLE without one is treated as a no-op compensation at runtime.
  compensate?: (ctx: TContext) => Promise<void>;
}

export interface SagaStepRecord {
  name: string;
  type: SagaStepType;
  status: 'SUCCESS' | 'FAILED' | 'COMPENSATED' | 'COMPENSATION_FAILED';
  startedAt: string;
  completedAt?: string;
  error?: string;
}

export type SagaStatus = 'STARTED' | 'COMPLETED' | 'COMPENSATING' | 'COMPENSATED' | 'FAILED';

export interface SagaResult {
  sagaId: string;
  status: SagaStatus;
}

// A saga "factory" reconstructs the executable step list + context for a saga type from
// its persisted payload — this is what makes retry()/compensate() work from just a
// sagaId (e.g. from an admin API call in a different process than the one that started
// the saga): the factory is registered once at service startup, not per-run.
export type SagaStepFactory<TContext> = (
  payload: Record<string, unknown>,
  tenantId: number
) => Promise<{ steps: SagaStepDefinition<TContext>[]; context: TContext }>;

export class SagaExecutionError extends Error {
  constructor(
    public readonly sagaId: string,
    public readonly stepName: string,
    public readonly cause: unknown
  ) {
    super(`Saga ${sagaId} step "${stepName}" failed: ${cause instanceof Error ? cause.message : String(cause)}`);
  }
}

export class SagaOrchestrator {
  private readonly factories = new Map<string, SagaStepFactory<unknown>>();

  constructor(private readonly db: ErpDatabase) {}

  // Registers how to rebuild a saga's steps+context from its persisted payload — required
  // before retry()/compensate() can be called for that sagaType. run() doesn't need this
  // if the caller already has live steps+context in hand (the common case: starting a
  // saga inline as part of handling the original request).
  register<TContext>(sagaType: string, factory: SagaStepFactory<TContext>): void {
    this.factories.set(sagaType, factory as SagaStepFactory<unknown>);
  }

  async run<TContext>(params: {
    sagaType: string;
    tenantId: number;
    correlationId: string;
    steps: SagaStepDefinition<TContext>[];
    context: TContext;
    payload?: Record<string, unknown>;
  }): Promise<SagaResult> {
    const sagaId = ulid();
    await this.db.insert(sagaLog).values({
      sagaId,
      sagaType: params.sagaType,
      tenantId: params.tenantId,
      correlationId: params.correlationId,
      status: 'STARTED',
      currentStep: 0,
      stepHistory: [],
      payload: params.payload ?? {},
    });

    return this.execute(sagaId, params.tenantId, params.steps, params.context, [], 0);
  }

  // Re-runs a saga from its last successfully-completed step (not from scratch),
  // reconstructing steps+context via the registered factory for its sagaType.
  async retry(sagaId: string, tenantId: number): Promise<SagaResult> {
    const row = await this.loadSaga(sagaId, tenantId);
    if (row.status !== 'FAILED' && row.status !== 'COMPENSATING') {
      throw new BusinessError('INVALID_SAGA_STATE', `Cannot retry saga in status: ${row.status}`);
    }

    const factory = this.factories.get(row.sagaType);
    if (!factory) {
      throw new BusinessError('SAGA_TYPE_NOT_REGISTERED', `No step factory registered for saga type "${row.sagaType}" in this process`);
    }

    const { steps, context } = await factory(row.payload as Record<string, unknown>, tenantId);
    const history = (row.stepHistory as SagaStepRecord[]) ?? [];
    const remainingSteps = steps.slice(row.currentStep);

    await this.db
      .update(sagaLog)
      .set({ status: 'STARTED', error: null, updatedAt: new Date() })
      .where(and(eq(sagaLog.sagaId, sagaId), eq(sagaLog.tenantId, tenantId)));

    return this.execute(sagaId, tenantId, remainingSteps, context, history, row.currentStep, steps.slice(0, row.currentStep));
  }

  // Manually triggers compensation of every previously-succeeded COMPENSATABLE step,
  // from the saga's current persisted state — used when a saga is stuck (e.g. its
  // IRREVERSIBLE step failed and it needs a human-approved rollback of what came before).
  async compensate(sagaId: string, tenantId: number): Promise<SagaResult> {
    const row = await this.loadSaga(sagaId, tenantId);
    const factory = this.factories.get(row.sagaType);
    if (!factory) {
      throw new BusinessError('SAGA_TYPE_NOT_REGISTERED', `No step factory registered for saga type "${row.sagaType}" in this process`);
    }

    const { steps, context } = await factory(row.payload as Record<string, unknown>, tenantId);
    const succeededSteps = steps.slice(0, row.currentStep);
    const history = (row.stepHistory as SagaStepRecord[]) ?? [];

    await this.db
      .update(sagaLog)
      .set({ status: 'COMPENSATING', updatedAt: new Date() })
      .where(and(eq(sagaLog.sagaId, sagaId), eq(sagaLog.tenantId, tenantId)));

    await this.compensateSteps(sagaId, tenantId, succeededSteps, context, history);
    return { sagaId, status: 'COMPENSATED' };
  }

  private async loadSaga(sagaId: string, tenantId: number) {
    const [row] = await this.db
      .select()
      .from(sagaLog)
      .where(and(eq(sagaLog.sagaId, sagaId), eq(sagaLog.tenantId, tenantId)))
      .limit(1);
    if (!row) throw new NotFoundError('Saga', sagaId);
    return row;
  }

  private async execute<TContext>(
    sagaId: string,
    tenantId: number,
    steps: SagaStepDefinition<TContext>[],
    context: TContext,
    priorHistory: SagaStepRecord[],
    startingStepIndex: number,
    priorSucceededSteps: SagaStepDefinition<TContext>[] = []
  ): Promise<SagaResult> {
    const history = [...priorHistory];
    const succeededSteps = [...priorSucceededSteps];

    for (let i = 0; i < steps.length; i++) {
      const step = steps[i]!;
      const absoluteIndex = startingStepIndex + i;
      const startedAt = new Date().toISOString();

      try {
        await step.execute(context);
        history.push({ name: step.name, type: step.type, status: 'SUCCESS', startedAt, completedAt: new Date().toISOString() });
        succeededSteps.push(step);

        await this.db
          .update(sagaLog)
          .set({ currentStep: absoluteIndex + 1, stepHistory: history, updatedAt: new Date() })
          .where(and(eq(sagaLog.sagaId, sagaId), eq(sagaLog.tenantId, tenantId)));
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : String(err);
        history.push({ name: step.name, type: step.type, status: 'FAILED', startedAt, completedAt: new Date().toISOString(), error: errMsg });

        if (step.type === 'IRREVERSIBLE') {
          // Spec: do not attempt compensation of prior steps automatically — this needs
          // a human to decide (the step may have partially succeeded externally, e.g. an
          // event was published and other services may already be reacting to it).
          await this.db
            .update(sagaLog)
            .set({ status: 'FAILED', stepHistory: history, error: errMsg, updatedAt: new Date() })
            .where(and(eq(sagaLog.sagaId, sagaId), eq(sagaLog.tenantId, tenantId)));
          return { sagaId, status: 'FAILED' };
        }

        await this.db
          .update(sagaLog)
          .set({ status: 'COMPENSATING', stepHistory: history, error: errMsg, updatedAt: new Date() })
          .where(and(eq(sagaLog.sagaId, sagaId), eq(sagaLog.tenantId, tenantId)));

        await this.compensateSteps(sagaId, tenantId, succeededSteps, context, history);
        throw new SagaExecutionError(sagaId, step.name, err);
      }
    }

    await this.db
      .update(sagaLog)
      .set({ status: 'COMPLETED', stepHistory: history, updatedAt: new Date() })
      .where(and(eq(sagaLog.sagaId, sagaId), eq(sagaLog.tenantId, tenantId)));
    return { sagaId, status: 'COMPLETED' };
  }

  private async compensateSteps<TContext>(
    sagaId: string,
    tenantId: number,
    succeededSteps: SagaStepDefinition<TContext>[],
    context: TContext,
    history: SagaStepRecord[]
  ): Promise<void> {
    let compensationFailed = false;

    for (let i = succeededSteps.length - 1; i >= 0; i--) {
      const step = succeededSteps[i]!;
      if (step.type !== 'COMPENSATABLE' || !step.compensate) continue;

      const startedAt = new Date().toISOString();
      try {
        await step.compensate(context);
        history.push({ name: step.name, type: step.type, status: 'COMPENSATED', startedAt, completedAt: new Date().toISOString() });
      } catch (compErr) {
        // Best-effort: keep compensating the remaining steps even if one fails, but
        // flag the saga as needing manual review rather than claiming a clean COMPENSATED.
        compensationFailed = true;
        history.push({
          name: step.name,
          type: step.type,
          status: 'COMPENSATION_FAILED',
          startedAt,
          completedAt: new Date().toISOString(),
          error: compErr instanceof Error ? compErr.message : String(compErr),
        });
      }
    }

    await this.db
      .update(sagaLog)
      .set({ status: compensationFailed ? 'FAILED' : 'COMPENSATED', stepHistory: history, updatedAt: new Date() })
      .where(and(eq(sagaLog.sagaId, sagaId), eq(sagaLog.tenantId, tenantId)));
  }
}
