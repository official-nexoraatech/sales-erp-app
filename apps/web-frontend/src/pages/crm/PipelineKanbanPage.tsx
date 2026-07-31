import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { opportunityApi } from '../../api/endpoints.js';
import { markWonFormSchema, type MarkWonFormData } from '../../schemas/opportunity.schema.js';
import { useAuthStore } from '../../store/auth.store.js';
import { PERMISSIONS } from '../../constants/permissions.js';
import ERPPageHeader from '../../components/erp/ERPPageHeader.js';
import { ERPTableSkeleton } from '../../components/erp/ERPSkeleton.js';
import ERPEmptyState from '../../components/erp/ERPEmptyState.js';
import ERPStatCard from '../../components/erp/ERPStatCard.js';
import Button from '../../components/ui/Button.js';
import Input from '../../components/ui/Input.js';
import Modal from '../../components/ui/Modal.js';

// CRM-ROADMAP Phase 2, Feature 1 — Sales Pipeline & Opportunity Management. Drag-and-drop
// pattern mirrors LeadsKanbanPage.tsx exactly (Phase 1, Feature 2). The one addition: dropping
// into a Won- or Lost-flagged column opens a dedicated modal instead of the plain generic
// stage-change call, since both terminal transitions require extra input the generic move
// doesn't (Won needs quotation params; Lost needs a reason) — this is the "exit criteria"
// enforcement point at the UI layer (the backend enforces it regardless).

interface Stage {
  code: string;
  name: string;
  sequence: number;
  probability: number;
  isWon: boolean;
  isLost: boolean;
}

interface Opportunity {
  id: number;
  name: string;
  stage: string;
  // CRM-ROADMAP Phase 3, Feature 6: omitted (not present at all), not null, when the caller
  // lacks OPPORTUNITY_VALUE_VIEW — optional here, not a required string.
  value?: string;
  probability: number;
  customerId?: number;
  version: number;
}

function fmtCurrency(n: number): string {
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: 0,
  }).format(n);
}

// Renders "—" rather than "₹NaN" when the backend omitted the value field for this caller.
function fmtCurrencyOrHidden(v: string | undefined): string {
  return v === undefined ? '—' : fmtCurrency(parseFloat(v));
}

export default function PipelineKanbanPage() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const hasPermission = useAuthStore((s) => s.hasPermission);
  const canCreate = hasPermission(PERMISSIONS.OPPORTUNITY_CREATE);
  const canChangeStage = hasPermission(PERMISSIONS.OPPORTUNITY_STAGE_CHANGE);
  const [draggingId, setDraggingId] = useState<number | null>(null);
  const [wonModalOpp, setWonModalOpp] = useState<Opportunity | null>(null);
  const [lostModalOpp, setLostModalOpp] = useState<Opportunity | null>(null);
  const [lostReason, setLostReason] = useState('');
  const [wonForm, setWonForm] = useState<Partial<MarkWonFormData>>({});
  const [wonFormError, setWonFormError] = useState<string | null>(null);

  const { data: stagesData, isLoading: stagesLoading } = useQuery({
    queryKey: ['pipeline-stages'],
    queryFn: () => opportunityApi.pipelineStages(),
  });
  const stages: Stage[] = ((stagesData as unknown as Stage[]) ?? [])
    .slice()
    .sort((a, b) => a.sequence - b.sequence);

  const { data, isLoading } = useQuery({
    queryKey: ['opportunities'],
    queryFn: () => opportunityApi.list(),
  });
  const opportunities: Opportunity[] = (data as { content?: Opportunity[] })?.content ?? [];

  const { data: forecast } = useQuery({
    queryKey: ['opportunities-forecast'],
    queryFn: () => opportunityApi.forecast(),
  });

  function invalidate() {
    qc.invalidateQueries({ queryKey: ['opportunities'] });
    qc.invalidateQueries({ queryKey: ['opportunities-forecast'] });
  }

  const stageMutation = useMutation({
    mutationFn: ({ opp, toStageCode }: { opp: Opportunity; toStageCode: string }) =>
      opportunityApi.changeStage(opp.id, { toStageCode, version: opp.version }),
    onSuccess: invalidate,
    onError: (err: Error) => toast.error(err.message),
  });

  const wonMutation = useMutation({
    mutationFn: ({ opp, form }: { opp: Opportunity; form: MarkWonFormData }) =>
      opportunityApi.markWon(opp.id, { version: opp.version, ...form }),
    onSuccess: () => {
      invalidate();
      setWonModalOpp(null);
      setWonForm({});
      toast.success('Opportunity marked Won — a quotation was created');
    },
    onError: (err: Error) => {
      setWonFormError(err.message);
    },
  });

  const lostMutation = useMutation({
    mutationFn: ({ opp, reason }: { opp: Opportunity; reason: string }) =>
      opportunityApi.markLost(opp.id, { version: opp.version, lostReason: reason }),
    onSuccess: () => {
      invalidate();
      setLostModalOpp(null);
      setLostReason('');
    },
    onError: (err: Error) => toast.error(err.message),
  });

  // CRM-ROADMAP Phase 3, Feature 4 (Mobile CRM) — the actual stage move, shared by both the
  // desktop drag-and-drop path and the tap/select-based path below (native HTML5 drag-and-drop
  // has no touch equivalent, so a phone user has no way to reach this at all without it).
  function moveToStage(opp: Opportunity, stage: Stage) {
    if (opp.stage === stage.code) return;
    if (stage.isWon) {
      setWonFormError(null);
      setWonModalOpp(opp);
      return;
    }
    if (stage.isLost) {
      setLostModalOpp(opp);
      return;
    }
    stageMutation.mutate({ opp, toStageCode: stage.code });
  }

  function onDrop(stage: Stage) {
    if (draggingId === null) return;
    const opp = opportunities.find((o) => o.id === draggingId);
    setDraggingId(null);
    if (!opp) return;
    moveToStage(opp, stage);
  }

  function submitWon() {
    if (!wonModalOpp) return;
    const parsed = markWonFormSchema.safeParse(wonForm);
    if (!parsed.success) {
      setWonFormError(parsed.error.errors[0]?.message ?? 'Please fill every field');
      return;
    }
    wonMutation.mutate({
      opp: wonModalOpp,
      form: { ...parsed.data, validUntil: new Date(parsed.data.validUntil).toISOString() },
    });
  }

  const isLoadingAny = isLoading || stagesLoading;

  return (
    <div>
      <ERPPageHeader
        variant="list"
        title="Sales Pipeline"
        subtitle="Bulk/wholesale deals from first contact through Won/Lost."
        actions={
          canCreate ? (
            <Button onClick={() => navigate('/crm/pipeline/new')}>+ New Opportunity</Button>
          ) : undefined
        }
      />

      {forecast && (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-4">
          <ERPStatCard
            label="Pipeline (Total)"
            value={forecast.pipelineValue === undefined ? '—' : fmtCurrency(forecast.pipelineValue)}
          />
          <ERPStatCard
            label="Best Case (Weighted)"
            value={forecast.weightedValue === undefined ? '—' : fmtCurrency(forecast.weightedValue)}
          />
          <ERPStatCard
            label="Commit (High Confidence)"
            value={forecast.commitValue === undefined ? '—' : fmtCurrency(forecast.commitValue)}
          />
        </div>
      )}

      {isLoadingAny ? (
        <ERPTableSkeleton />
      ) : stages.length === 0 ? (
        <ERPEmptyState type="no-data" title="No pipeline stages configured" />
      ) : (
        // Below `md`, stages stack into a full-width vertical list instead of a horizontally-
        // scrolling row of fixed-width columns — a phone-width Kanban board squeezed into ~1.3
        // columns is unusable (this feature's own stated edge case), and a stacked list needs
        // no horizontal gesture at all. Unchanged at `md+` (same layout as before this feature).
        <div className="grid grid-cols-1 gap-3 md:flex md:gap-3 md:overflow-x-auto md:pb-2">
          {stages.map((stage) => {
            const stageOpps = opportunities.filter((o) => o.stage === stage.code);
            // Value is either present on every opportunity or none (all-or-nothing per caller
            // permission) — if the first one lacks it, don't sum a mix of numbers and NaN.
            const stageValueVisible = stageOpps.length === 0 || stageOpps[0]!.value !== undefined;
            const stageTotal = stageOpps.reduce(
              (sum, o) => sum + (o.value ? parseFloat(o.value) : 0),
              0
            );
            return (
              <div
                key={stage.code}
                className="w-full md:flex-shrink-0 md:w-72 bg-surface-subtle rounded-xl border border-default p-3"
                onDragOver={(e) => canChangeStage && e.preventDefault()}
                onDrop={() => canChangeStage && onDrop(stage)}
              >
                <div className="flex items-center justify-between mb-2">
                  <h3 className="text-sm font-semibold text-primary">{stage.name}</h3>
                  <span className="text-xs text-secondary">{stageOpps.length}</span>
                </div>
                <p className="text-xs text-secondary mb-3">
                  {stageValueVisible ? fmtCurrency(stageTotal) : '—'}
                </p>

                <div className="space-y-2 min-h-[80px]">
                  {stageOpps.map((opp) => (
                    <div
                      key={opp.id}
                      draggable={canChangeStage}
                      onDragStart={() => setDraggingId(opp.id)}
                      className="bg-surface-card border border-default rounded-lg p-3 hover:shadow-sm"
                    >
                      <div
                        className="cursor-pointer"
                        onClick={() => navigate(`/crm/pipeline/${opp.id}`)}
                      >
                        <p className="text-sm font-medium text-primary truncate">{opp.name}</p>
                        <p className="text-xs text-secondary mt-1">
                          {fmtCurrencyOrHidden(opp.value)}
                        </p>
                      </div>
                      {/* Native HTML5 drag-and-drop has no touch equivalent — this select is
                          the only way to change stage on a phone, and works everywhere else too. */}
                      {canChangeStage && (
                        <select
                          aria-label={`Move ${opp.name} to a different stage`}
                          value={opp.stage}
                          onClick={(e) => e.stopPropagation()}
                          onChange={(e) => {
                            const target = stages.find((s) => s.code === e.target.value);
                            if (target) moveToStage(opp, target);
                          }}
                          className="mt-2 w-full rounded-md border border-default bg-surface-card text-xs px-2 py-1.5"
                        >
                          {stages.map((s) => (
                            <option key={s.code} value={s.code}>
                              {s.name}
                            </option>
                          ))}
                        </select>
                      )}
                    </div>
                  ))}
                  {stageOpps.length === 0 && (
                    <p className="text-xs text-disabled italic">No deals</p>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Mark Won modal — collects the required quotation params (AR-2: reuses QuotationService). */}
      <Modal
        open={wonModalOpp !== null}
        onClose={() => setWonModalOpp(null)}
        title="Mark Opportunity Won"
        size="sm"
      >
        <div className="space-y-3">
          <p className="text-sm text-secondary">
            Marking <strong>{wonModalOpp?.name}</strong> Won will create a quotation from its line
            items.
          </p>
          <Input
            aria-label="Branch ID"
            placeholder="Branch ID"
            type="number"
            value={wonForm.branchId ?? ''}
            onChange={(e) => setWonForm((f) => ({ ...f, branchId: Number(e.target.value) }))}
          />
          <Input
            aria-label="Place of supply (2-letter state code)"
            placeholder="Place of supply (e.g. MH)"
            maxLength={2}
            value={wonForm.placeOfSupply ?? ''}
            onChange={(e) =>
              setWonForm((f) => ({ ...f, placeOfSupply: e.target.value.toUpperCase() }))
            }
          />
          <Input
            aria-label="Seller state code"
            placeholder="Seller state code (e.g. MH)"
            maxLength={2}
            value={wonForm.sellerStateCode ?? ''}
            onChange={(e) =>
              setWonForm((f) => ({ ...f, sellerStateCode: e.target.value.toUpperCase() }))
            }
          />
          <Input
            aria-label="Quotation valid until"
            type="date"
            value={wonForm.validUntil ?? ''}
            onChange={(e) => setWonForm((f) => ({ ...f, validUntil: e.target.value }))}
          />
          {wonFormError && <p className="text-xs text-danger">{wonFormError}</p>}
          <div className="flex gap-3">
            <Button variant="secondary" className="flex-1" onClick={() => setWonModalOpp(null)}>
              Cancel
            </Button>
            <Button className="flex-1" isLoading={wonMutation.isPending} onClick={submitWon}>
              Mark Won
            </Button>
          </div>
        </div>
      </Modal>

      {/* Mark Lost modal — a reason is mandatory (this feature's other exit criterion). */}
      <Modal
        open={lostModalOpp !== null}
        onClose={() => setLostModalOpp(null)}
        title="Mark Opportunity Lost"
        size="sm"
      >
        <div className="space-y-3">
          <p className="text-sm text-secondary">
            Why was <strong>{lostModalOpp?.name}</strong> lost?
          </p>
          <textarea
            className="w-full rounded-md border border-default bg-surface-card p-2 text-sm"
            rows={3}
            value={lostReason}
            onChange={(e) => setLostReason(e.target.value)}
            placeholder="Reason (required)"
          />
          <div className="flex gap-3">
            <Button variant="secondary" className="flex-1" onClick={() => setLostModalOpp(null)}>
              Cancel
            </Button>
            <Button
              variant="danger"
              className="flex-1"
              isLoading={lostMutation.isPending}
              disabled={!lostReason.trim()}
              onClick={() =>
                lostModalOpp && lostMutation.mutate({ opp: lostModalOpp, reason: lostReason })
              }
            >
              Mark Lost
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
