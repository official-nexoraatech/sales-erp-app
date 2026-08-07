import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import {
  ruleApi,
  type BusinessRule,
  type RuleCondition,
  type RuleAction,
  type RuleActionType,
  type RuleConditionOperator,
  type RuleFormInput,
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

const CONDITION_OPERATORS: RuleConditionOperator[] = [
  'EQUALS',
  'NOT_EQUALS',
  'GREATER_THAN',
  'LESS_THAN',
  'GREATER_THAN_EQUALS',
  'LESS_THAN_EQUALS',
  'BETWEEN',
  'IN',
  'NOT_IN',
  'CONTAINS',
  'STARTS_WITH',
];

const ACTION_TYPES: RuleActionType[] = [
  'BLOCK',
  'WARN',
  'NOTIFY',
  'TRIGGER_APPROVAL',
  'SET_FIELD',
  'ADD_DISCOUNT',
];

function emptyForm(): RuleFormInput {
  return {
    name: '',
    entityType: 'SALE',
    eventType: 'SALE_CREATE',
    conditionOperator: 'AND',
    conditions: [{ field: '', operator: 'EQUALS', value: '' }],
    actions: [{ type: 'WARN', message: '' }],
    priority: 100,
    isActive: true,
  };
}

function ruleToForm(r: BusinessRule): RuleFormInput {
  return {
    name: r.name,
    entityType: r.entityType,
    eventType: r.eventType,
    conditionOperator: r.conditionOperator,
    conditions:
      r.conditions.length > 0 ? r.conditions : [{ field: '', operator: 'EQUALS', value: '' }],
    actions: r.actions.length > 0 ? r.actions : [{ type: 'WARN', message: '' }],
    priority: r.priority,
    isActive: r.isActive,
  };
}

export default function RulesPage() {
  const qc = useQueryClient();
  const confirm = useConfirm();
  const [selectedId, setSelectedId] = useState<number | 'new' | null>(null);
  const [form, setForm] = useState<RuleFormInput>(emptyForm());
  const [simTestData, setSimTestData] = useState('{}');
  const [simResult, setSimResult] = useState<{
    matched: boolean;
    actions: RuleAction[];
    conditionResults: Array<{ condition: RuleCondition; passed: boolean }>;
  } | null>(null);

  const { data: listData, isLoading } = useQuery({
    queryKey: ['business-rules'],
    queryFn: () => ruleApi.list(),
  });
  const rules: BusinessRule[] = listData?.content ?? [];
  const selectedRule =
    typeof selectedId === 'number' ? rules.find((r) => r.id === selectedId) : null;

  function selectRule(rule: BusinessRule) {
    setSelectedId(rule.id);
    setForm(ruleToForm(rule));
    setSimResult(null);
  }

  function startNew() {
    setSelectedId('new');
    setForm(emptyForm());
    setSimResult(null);
  }

  const saveMutation = useMutation({
    mutationFn: () =>
      selectedId && selectedId !== 'new' ? ruleApi.update(selectedId, form) : ruleApi.create(form),
    onSuccess: () => {
      toast.success('Rule saved');
      void qc.invalidateQueries({ queryKey: ['business-rules'] });
      setSelectedId(null);
    },
    onError: () => toast.error('Failed to save rule'),
  });

  const toggleMutation = useMutation({
    mutationFn: ({ id, isActive }: { id: number; isActive: boolean }) =>
      ruleApi.toggle(id, isActive),
    onSuccess: () => {
      toast.success('Rule updated');
      void qc.invalidateQueries({ queryKey: ['business-rules'] });
    },
    onError: () => toast.error('Failed to update rule'),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => ruleApi.remove(id),
    onSuccess: () => {
      toast.success('Rule deleted');
      void qc.invalidateQueries({ queryKey: ['business-rules'] });
      setSelectedId(null);
    },
    onError: () => toast.error('Failed to delete rule (system rules cannot be deleted)'),
  });

  const simulateMutation = useMutation({
    mutationFn: () => {
      let parsed: Record<string, unknown>;
      try {
        parsed = JSON.parse(simTestData) as Record<string, unknown>;
      } catch {
        throw new Error('Test data must be valid JSON');
      }
      return ruleApi.simulate(selectedId as number, parsed);
    },
    onSuccess: (data) => setSimResult(data),
    onError: (err: Error) => toast.error(err.message || 'Simulation failed'),
  });

  function updateCondition(i: number, patch: Partial<RuleCondition>) {
    setForm((f) => ({
      ...f,
      conditions: f.conditions.map((c, idx) => (idx === i ? { ...c, ...patch } : c)),
    }));
  }
  function addCondition() {
    setForm((f) => ({
      ...f,
      conditions: [...f.conditions, { field: '', operator: 'EQUALS', value: '' }],
    }));
  }
  function removeCondition(i: number) {
    setForm((f) => ({ ...f, conditions: f.conditions.filter((_, idx) => idx !== i) }));
  }

  function updateAction(i: number, patch: Partial<RuleAction>) {
    setForm((f) => ({
      ...f,
      actions: f.actions.map((a, idx) => (idx === i ? { ...a, ...patch } : a)),
    }));
  }
  function addAction() {
    setForm((f) => ({ ...f, actions: [...f.actions, { type: 'WARN', message: '' }] }));
  }
  function removeAction(i: number) {
    setForm((f) => ({ ...f, actions: f.actions.filter((_, idx) => idx !== i) }));
  }

  return (
    <div className="space-y-6">
      <ERPPageHeader
        variant="list"
        title="Business Rules"
        subtitle="Tenant-configurable pricing, discount, approval, credit, and validation rules — evaluated at the point of transaction (RuleEngine)"
        actions={
          <Button variant="primary" onClick={startNew}>
            New Rule
          </Button>
        }
      />

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="card p-4 lg:col-span-1">
          <h3 className="text-sm font-semibold text-primary mb-3">Rules</h3>
          {isLoading ? (
            <ERPCardSkeleton lines={6} />
          ) : rules.length === 0 ? (
            <ERPEmptyState
              type="no-data"
              title="No rules yet"
              description="Create a rule, or check that system rules have been seeded for this tenant."
            />
          ) : (
            <div className="space-y-2">
              {rules.map((rule) => (
                <div
                  key={rule.id}
                  className={`px-3 py-3 rounded-lg border border-default cursor-pointer transition-colors ${
                    selectedId === rule.id ? 'bg-surface-hover' : 'hover:bg-surface-hover'
                  }`}
                  onClick={() => selectRule(rule)}
                >
                  <div className="flex items-center justify-between gap-2 mb-1">
                    <span className="text-sm font-medium text-primary truncate">{rule.name}</span>
                    <div className="flex items-center gap-1 shrink-0">
                      {rule.isSystem && <Badge variant="default">SYSTEM</Badge>}
                      <Badge variant={rule.isActive ? 'success' : 'default'}>
                        {rule.isActive ? 'ACTIVE' : 'OFF'}
                      </Badge>
                    </div>
                  </div>
                  <p className="text-xs text-secondary">
                    {rule.entityType} / {rule.eventType} · priority {rule.priority}
                  </p>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="card p-4 lg:col-span-2">
          {selectedId === null ? (
            <p className="text-sm text-secondary">Select a rule to edit, or create a new one.</p>
          ) : (
            <div className="space-y-5">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-semibold text-primary">
                  {selectedId === 'new' ? 'New Rule' : `Edit — ${selectedRule?.name}`}
                </h3>
                {selectedRule?.isSystem && (
                  <span className="text-xs text-secondary">
                    System rule — editable, not deletable
                  </span>
                )}
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <Input
                  label="Name"
                  value={form.name}
                  onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                />
                <Input
                  label="Priority (lower runs first)"
                  type="number"
                  value={form.priority}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, priority: Number(e.target.value) || 0 }))
                  }
                />
                <Input
                  label="Entity Type"
                  value={form.entityType}
                  onChange={(e) => setForm((f) => ({ ...f, entityType: e.target.value }))}
                  hint="e.g. SALE, PURCHASE_ORDER, STOCK, COMMISSION"
                />
                <Input
                  label="Event Type"
                  value={form.eventType}
                  onChange={(e) => setForm((f) => ({ ...f, eventType: e.target.value }))}
                  hint="e.g. SALE_CREATE, SALE_DISCOUNT, STOCK_REDUCE"
                />
                <Select
                  label="Match"
                  value={form.conditionOperator}
                  onChange={(e) =>
                    setForm((f) => ({
                      ...f,
                      conditionOperator: e.target.value as 'AND' | 'OR',
                    }))
                  }
                  options={[
                    { value: 'AND', label: 'ALL conditions (AND)' },
                    { value: 'OR', label: 'ANY condition (OR)' },
                  ]}
                />
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
                  <h4 className="text-xs font-semibold text-secondary uppercase">Conditions</h4>
                  <Button size="sm" variant="secondary" onClick={addCondition}>
                    + Condition
                  </Button>
                </div>
                <div className="space-y-2">
                  {form.conditions.map((c, i) => (
                    <div key={i} className="grid grid-cols-12 gap-2 items-center">
                      <div className="col-span-4">
                        <Input
                          placeholder="field (e.g. isOverCreditLimit)"
                          value={c.field}
                          onChange={(e) => updateCondition(i, { field: e.target.value })}
                        />
                      </div>
                      <div className="col-span-3">
                        <Select
                          value={c.operator}
                          onChange={(e) =>
                            updateCondition(i, {
                              operator: e.target.value as RuleConditionOperator,
                            })
                          }
                          options={CONDITION_OPERATORS.map((op) => ({ value: op, label: op }))}
                        />
                      </div>
                      <div className="col-span-4">
                        <Input
                          placeholder="value"
                          value={String(c.value ?? '')}
                          onChange={(e) => updateCondition(i, { value: e.target.value })}
                        />
                      </div>
                      <div className="col-span-1 flex justify-end">
                        <Button
                          size="sm"
                          variant="ghost"
                          disabled={form.conditions.length <= 1}
                          onClick={() => removeCondition(i)}
                        >
                          ✕
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              <div>
                <div className="flex items-center justify-between mb-2">
                  <h4 className="text-xs font-semibold text-secondary uppercase">Actions</h4>
                  <Button size="sm" variant="secondary" onClick={addAction}>
                    + Action
                  </Button>
                </div>
                <div className="space-y-2">
                  {form.actions.map((a, i) => (
                    <div key={i} className="grid grid-cols-12 gap-2 items-center">
                      <div className="col-span-3">
                        <Select
                          value={a.type}
                          onChange={(e) =>
                            updateAction(i, { type: e.target.value as RuleActionType })
                          }
                          options={ACTION_TYPES.map((t) => ({ value: t, label: t }))}
                        />
                      </div>
                      <div className="col-span-8">
                        <Input
                          placeholder="message / role (context-dependent)"
                          value={a.message ?? a.role ?? ''}
                          onChange={(e) => updateAction(i, { message: e.target.value })}
                        />
                      </div>
                      <div className="col-span-1 flex justify-end">
                        <Button
                          size="sm"
                          variant="ghost"
                          disabled={form.actions.length <= 1}
                          onClick={() => removeAction(i)}
                        >
                          ✕
                        </Button>
                      </div>
                    </div>
                  ))}
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
                {selectedId !== 'new' && !selectedRule?.isSystem && (
                  <Button
                    variant="danger"
                    loading={deleteMutation.isPending}
                    onClick={async () => {
                      const ok = await confirm({
                        title: 'Delete this rule?',
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
                {selectedId !== 'new' && selectedRule && (
                  <Button
                    variant="secondary"
                    loading={toggleMutation.isPending}
                    onClick={() =>
                      toggleMutation.mutate({
                        id: selectedRule.id,
                        isActive: !selectedRule.isActive,
                      })
                    }
                  >
                    {selectedRule.isActive ? 'Deactivate' : 'Activate'}
                  </Button>
                )}
              </div>

              {selectedId !== 'new' && (
                <div className="pt-4 border-t border-default space-y-2">
                  <h4 className="text-xs font-semibold text-secondary uppercase">
                    Simulate (dry run against test data)
                  </h4>
                  <textarea
                    value={simTestData}
                    onChange={(e) => setSimTestData(e.target.value)}
                    rows={4}
                    className="w-full rounded-lg border border-default bg-surface-card text-primary text-sm font-mono px-3 py-2"
                    placeholder='{"isOverCreditLimit": true}'
                  />
                  <Button
                    variant="secondary"
                    loading={simulateMutation.isPending}
                    onClick={() => simulateMutation.mutate()}
                  >
                    Run Simulation
                  </Button>
                  {simResult && (
                    <div className="mt-2 p-3 rounded-lg border border-default text-sm">
                      <p className="mb-2">
                        Result:{' '}
                        <Badge variant={simResult.matched ? 'success' : 'default'}>
                          {simResult.matched ? 'MATCHED' : 'NOT MATCHED'}
                        </Badge>
                      </p>
                      {simResult.conditionResults.map((cr, i) => (
                        <p key={i} className="text-xs text-secondary">
                          {cr.condition.field} {cr.condition.operator} {String(cr.condition.value)}{' '}
                          → {cr.passed ? '✓' : '✗'}
                        </p>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
