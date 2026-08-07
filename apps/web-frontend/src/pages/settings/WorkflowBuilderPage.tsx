import { useMemo, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { ReactFlow, Background, Controls, type Node, type Edge } from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import {
  automationApi,
  type WorkflowAutomationDefinition,
  type AutomationNode,
  type AutomationNodeType,
  type AutomationTriggerType,
  type AutomationDefinitionFormInput,
  type WorkflowExecutionHistoryRow,
} from '../../api/endpoints.js';
import { useConfirm } from '../../context/ConfirmContext.js';
import ERPPageHeader from '../../components/erp/ERPPageHeader.js';
import { ERPCardSkeleton } from '../../components/erp/ERPSkeleton.js';
import ERPEmptyState from '../../components/erp/ERPEmptyState.js';
import ERPSwitch from '../../components/erp/ERPSwitch.js';
import Button from '../../components/ui/Button.js';
import Badge from '../../components/ui/Badge.js';
import Input from '../../components/ui/Input.js';
import Select from '../../components/ui/Select.js';
import { formatDatetime } from '../../lib/format.js';

const NODE_TYPES: AutomationNodeType[] = [
  'CONDITION',
  'NOTIFICATION',
  'ACTION',
  'DELAY',
  'APPROVAL',
  'PARALLEL_APPROVAL',
];
const TRIGGER_TYPES: AutomationTriggerType[] = ['EVENT', 'CRON', 'WEBHOOK', 'API'];

function emptyForm(): AutomationDefinitionFormInput {
  return {
    name: '',
    triggerEvent: '',
    entityType: '',
    triggerType: 'EVENT',
    nodes: [
      { id: 'n1', name: 'Step 1', type: 'CONDITION', conditions: [], conditionOperator: 'AND' },
    ],
    isActive: true,
  };
}

function defToForm(d: WorkflowAutomationDefinition): AutomationDefinitionFormInput {
  return {
    name: d.name,
    triggerEvent: d.triggerEvent,
    entityType: d.entityType,
    triggerType: d.triggerType,
    ...(d.triggerConfig ? { triggerConfig: d.triggerConfig } : {}),
    nodes: d.nodes,
    timeoutHours: d.timeoutHours,
    isActive: d.isActive,
  };
}

// Simple top-to-bottom auto-layout by array position — this v1 builder authors the DAG via
// structured node rows (id/type/nextNodeId), same pattern as the Rules Engine's condition/
// action array editor, and uses the canvas purely to *visualize* the resulting topology, not
// for drag-and-drop authoring (a materially larger UI investment deferred to a later pass).
function toFlow(nodes: AutomationNode[]): { flowNodes: Node[]; flowEdges: Edge[] } {
  const flowNodes: Node[] = nodes.map((n, i) => ({
    id: n.id,
    position: { x: 250, y: i * 110 },
    data: { label: `${n.name}\n[${n.type}]` },
    style: {
      whiteSpace: 'pre-line',
      textAlign: 'center',
      fontSize: 12,
      borderRadius: 8,
      padding: 8,
    },
  }));
  const flowEdges: Edge[] = [];
  for (const n of nodes) {
    if (n.nextNodeId)
      flowEdges.push({ id: `${n.id}-${n.nextNodeId}`, source: n.id, target: n.nextNodeId });
    if (n.rejectedNodeId)
      flowEdges.push({
        id: `${n.id}-${n.rejectedNodeId}-rej`,
        source: n.id,
        target: n.rejectedNodeId,
        label: 'if false',
        style: { stroke: 'var(--color-danger)' },
      });
  }
  return { flowNodes, flowEdges };
}

export default function WorkflowBuilderPage() {
  const qc = useQueryClient();
  const confirm = useConfirm();
  const [selectedId, setSelectedId] = useState<number | 'new' | null>(null);
  const [form, setForm] = useState<AutomationDefinitionFormInput>(emptyForm());

  const { data: listData, isLoading } = useQuery({
    queryKey: ['automation-definitions'],
    queryFn: () => automationApi.list(),
  });
  const definitions: WorkflowAutomationDefinition[] = listData?.content ?? [];
  const selected =
    typeof selectedId === 'number' ? definitions.find((d) => d.id === selectedId) : null;

  const { data: historyData } = useQuery({
    queryKey: ['automation-history', selectedId],
    queryFn: () => automationApi.history(selectedId as number),
    enabled: typeof selectedId === 'number',
  });
  const history: WorkflowExecutionHistoryRow[] = historyData?.content ?? [];

  const { flowNodes, flowEdges } = useMemo(() => toFlow(form.nodes), [form.nodes]);

  function select(d: WorkflowAutomationDefinition) {
    setSelectedId(d.id);
    setForm(defToForm(d));
  }
  function startNew() {
    setSelectedId('new');
    setForm(emptyForm());
  }

  const saveMutation = useMutation({
    mutationFn: () =>
      selectedId && selectedId !== 'new'
        ? automationApi.update(selectedId, form)
        : automationApi.create(form),
    onSuccess: () => {
      toast.success('Automation saved');
      void qc.invalidateQueries({ queryKey: ['automation-definitions'] });
      setSelectedId(null);
    },
    onError: () => toast.error('Failed to save automation'),
  });

  const toggleMutation = useMutation({
    mutationFn: ({ id, isActive }: { id: number; isActive: boolean }) =>
      automationApi.toggle(id, isActive),
    onSuccess: () => {
      toast.success('Updated');
      void qc.invalidateQueries({ queryKey: ['automation-definitions'] });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => automationApi.remove(id),
    onSuccess: () => {
      toast.success('Deleted');
      void qc.invalidateQueries({ queryKey: ['automation-definitions'] });
      setSelectedId(null);
    },
    onError: () => toast.error('Failed to delete (system automations cannot be deleted)'),
  });

  const triggerMutation = useMutation({
    mutationFn: (id: number) => automationApi.trigger(id),
    onSuccess: () => {
      toast.success('Triggered');
      void qc.invalidateQueries({ queryKey: ['automation-history', selectedId] });
    },
    onError: () => toast.error('Failed to trigger'),
  });

  function updateNode(i: number, patch: Partial<AutomationNode>) {
    setForm((f) => ({
      ...f,
      nodes: f.nodes.map((n, idx) => (idx === i ? { ...n, ...patch } : n)),
    }));
  }
  function addNode() {
    setForm((f) => ({
      ...f,
      nodes: [
        ...f.nodes,
        { id: `n${f.nodes.length + 1}`, name: `Step ${f.nodes.length + 1}`, type: 'ACTION' },
      ],
    }));
  }
  function removeNode(i: number) {
    setForm((f) => ({ ...f, nodes: f.nodes.filter((_, idx) => idx !== i) }));
  }

  return (
    <div className="space-y-6">
      <ERPPageHeader
        variant="list"
        title="Workflow Automation"
        subtitle="Multi-trigger automations (event/cron/webhook/API) with condition, notification, action, and delay steps"
        actions={
          <Button variant="primary" onClick={startNew}>
            New Automation
          </Button>
        }
      />

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="card p-4 lg:col-span-1">
          <h3 className="text-sm font-semibold text-primary mb-3">Automations</h3>
          {isLoading ? (
            <ERPCardSkeleton lines={6} />
          ) : definitions.length === 0 ? (
            <ERPEmptyState
              type="no-data"
              title="No automations yet"
              description="Create one, or check that system approval chains have been seeded for this tenant."
            />
          ) : (
            <div className="space-y-2">
              {definitions.map((d) => (
                <div
                  key={d.id}
                  className={`px-3 py-3 rounded-lg border border-default cursor-pointer transition-colors ${
                    selectedId === d.id ? 'bg-surface-hover' : 'hover:bg-surface-hover'
                  }`}
                  onClick={() => select(d)}
                >
                  <div className="flex items-center justify-between gap-2 mb-1">
                    <span className="text-sm font-medium text-primary truncate">{d.name}</span>
                    <div className="flex items-center gap-1 shrink-0">
                      {d.isSystem && <Badge variant="default">SYSTEM</Badge>}
                      <Badge variant={d.isActive ? 'success' : 'default'}>
                        {d.isActive ? 'ACTIVE' : 'OFF'}
                      </Badge>
                    </div>
                  </div>
                  <p className="text-xs text-secondary">
                    {d.triggerType} · {d.triggerEvent} · {d.nodes.length} steps
                  </p>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="card p-4 lg:col-span-2 space-y-5">
          {selectedId === null ? (
            <p className="text-sm text-secondary">
              Select an automation to edit, or create a new one.
            </p>
          ) : (
            <>
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-semibold text-primary">
                  {selectedId === 'new' ? 'New Automation' : `Edit — ${selected?.name}`}
                </h3>
                {selected?.isSystem && (
                  <span className="text-xs text-secondary">System — editable, not deletable</span>
                )}
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <Input
                  label="Name"
                  value={form.name}
                  onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                />
                <Select
                  label="Trigger Type"
                  value={form.triggerType}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, triggerType: e.target.value as AutomationTriggerType }))
                  }
                  options={TRIGGER_TYPES.map((t) => ({ value: t, label: t }))}
                />
                <Input
                  label="Trigger Event"
                  value={form.triggerEvent}
                  onChange={(e) => setForm((f) => ({ ...f, triggerEvent: e.target.value }))}
                  hint={
                    form.triggerType === 'EVENT'
                      ? 'e.g. INVOICE_CONFIRMED, GRN_APPROVED'
                      : 'A label for this automation (cron/webhook/API triggers don’t match on this field)'
                  }
                />
                <Input
                  label="Entity Type"
                  value={form.entityType}
                  onChange={(e) => setForm((f) => ({ ...f, entityType: e.target.value }))}
                />
                {form.triggerType === 'CRON' && (
                  <Input
                    label="Cron Expression"
                    value={String(form.triggerConfig?.['cron'] ?? '')}
                    onChange={(e) =>
                      setForm((f) => ({
                        ...f,
                        triggerConfig: { ...f.triggerConfig, cron: e.target.value },
                      }))
                    }
                    placeholder="0 9 * * *"
                  />
                )}
                <div className="flex items-end pb-2">
                  <ERPSwitch
                    label="Active"
                    checked={form.isActive}
                    onChange={(v) => setForm((f) => ({ ...f, isActive: v }))}
                  />
                </div>
              </div>

              <div>
                <div className="flex items-center justify-between mb-2">
                  <h4 className="text-xs font-semibold text-secondary uppercase">Steps</h4>
                  <Button size="sm" variant="secondary" onClick={addNode}>
                    + Step
                  </Button>
                </div>
                <div className="space-y-2">
                  {form.nodes.map((n, i) => (
                    <div key={i} className="grid grid-cols-12 gap-2 items-center">
                      <div className="col-span-2">
                        <Input
                          value={n.id}
                          onChange={(e) => updateNode(i, { id: e.target.value })}
                          placeholder="id"
                        />
                      </div>
                      <div className="col-span-3">
                        <Input
                          value={n.name}
                          onChange={(e) => updateNode(i, { name: e.target.value })}
                          placeholder="name"
                        />
                      </div>
                      <div className="col-span-2">
                        <Select
                          value={n.type}
                          onChange={(e) =>
                            updateNode(i, { type: e.target.value as AutomationNodeType })
                          }
                          options={NODE_TYPES.map((t) => ({ value: t, label: t }))}
                        />
                      </div>
                      <div className="col-span-4">
                        <Input
                          value={n.nextNodeId ?? ''}
                          onChange={(e) => {
                            const value = e.target.value;
                            setForm((f) => ({
                              ...f,
                              nodes: f.nodes.map((node, idx) => {
                                if (idx !== i) return node;
                                const { nextNodeId: _drop, ...rest } = node;
                                void _drop;
                                return value ? { ...rest, nextNodeId: value } : rest;
                              }),
                            }));
                          }}
                          placeholder="next step id"
                        />
                      </div>
                      <div className="col-span-1 flex justify-end">
                        <Button size="sm" variant="ghost" onClick={() => removeNode(i)}>
                          ✕
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
                <p className="text-xs text-secondary mt-2">
                  CONDITION steps need field/operator/value pairs and are edited via the API for
                  now; this v1 builder covers step wiring (id/name/type/next-step) — full inline
                  condition editing follows the same pattern as the Business Rules page.
                </p>
              </div>

              <div>
                <h4 className="text-xs font-semibold text-secondary uppercase mb-2">
                  Flow Preview
                </h4>
                <div style={{ height: 240 }} className="rounded-lg border border-default">
                  <ReactFlow nodes={flowNodes} edges={flowEdges} fitView>
                    <Background />
                    <Controls showInteractive={false} />
                  </ReactFlow>
                </div>
              </div>

              <div className="flex items-center gap-2 pt-2 border-t border-default">
                <Button
                  variant="primary"
                  loading={saveMutation.isPending}
                  onClick={() => saveMutation.mutate()}
                >
                  Save
                </Button>
                {selectedId !== 'new' && (
                  <Button
                    variant="secondary"
                    loading={triggerMutation.isPending}
                    onClick={() => triggerMutation.mutate(selectedId)}
                  >
                    Trigger Now
                  </Button>
                )}
                {selectedId !== 'new' && !selected?.isSystem && (
                  <Button
                    variant="danger"
                    loading={deleteMutation.isPending}
                    onClick={async () => {
                      const ok = await confirm({
                        title: 'Delete this automation?',
                        message: `"${form.name}" will be permanently removed.`,
                        confirmLabel: 'Delete',
                        variant: 'danger',
                      });
                      if (ok) deleteMutation.mutate(selectedId as number);
                    }}
                  >
                    Delete
                  </Button>
                )}
                {selectedId !== 'new' && selected && (
                  <Button
                    variant="secondary"
                    loading={toggleMutation.isPending}
                    onClick={() =>
                      toggleMutation.mutate({ id: selected.id, isActive: !selected.isActive })
                    }
                  >
                    {selected.isActive ? 'Deactivate' : 'Activate'}
                  </Button>
                )}
              </div>

              {selectedId !== 'new' && (
                <div className="pt-4 border-t border-default">
                  <h4 className="text-xs font-semibold text-secondary uppercase mb-2">
                    Recent Executions
                  </h4>
                  {history.length === 0 ? (
                    <p className="text-sm text-secondary">No runs yet.</p>
                  ) : (
                    <div className="space-y-2 max-h-56 overflow-y-auto">
                      {history.map((h) => (
                        <div
                          key={h.id}
                          className="px-3 py-2 rounded-lg border border-default text-xs"
                        >
                          <div className="flex items-center justify-between">
                            <Badge
                              variant={
                                h.status === 'COMPLETED'
                                  ? 'success'
                                  : h.status === 'FAILED'
                                    ? 'danger'
                                    : 'warning'
                              }
                            >
                              {h.status}
                            </Badge>
                            <span className="text-secondary">{h.triggeredBy}</span>
                          </div>
                          <p className="text-secondary mt-1">{formatDatetime(h.startedAt)}</p>
                          {h.errorMessage && <p className="text-danger mt-1">{h.errorMessage}</p>}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
