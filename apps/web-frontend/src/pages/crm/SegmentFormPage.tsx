import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { crmApi } from '../../api/endpoints.js';
import ERPPageHeader from '../../components/erp/ERPPageHeader.js';
import ERPFormSection from '../../components/erp/ERPFormSection.js';
import ERPStickyFooter from '../../components/erp/ERPStickyFooter.js';
import Button from '../../components/ui/Button.js';
import Input from '../../components/ui/Input.js';

// CP-3 (Campaign Management Platform initiative): expanded to match the field whitelist
// SegmentService.ts actually supports — see FIELD_COLUMNS/JSON_TEXT_FIELDS/COMPUTED_NUMERIC_FIELDS
// there. branchId (needs a branch picker, not free text) and customField:<key> (needs a
// key+value pair, not a single value) are intentionally left for a future builder iteration.
const SEGMENT_FIELDS = [
  'customerType',
  'status',
  'creditLimit',
  'loyaltyPoints',
  'openingBalance',
  'healthSegment',
  'healthScore',
  'gender',
  'dateOfBirth',
  'createdAt',
  'displayName',
  'phone',
  'email',
  'city',
  'state',
  'pincode',
  'orderCount',
  'averageOrderValue',
  'lifetimeValue',
  'daysSinceLastPurchase',
];
const OPERATORS = ['eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'contains'];

interface Rule {
  field: string;
  operator: string;
  value: string;
}

function emptyRule(): Rule {
  return { field: 'status', operator: 'eq', value: '' };
}

const LIST_PATH = '/crm/segments';

export default function SegmentFormPage() {
  const navigate = useNavigate();
  const qc = useQueryClient();

  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [logic, setLogic] = useState<'AND' | 'OR'>('AND');
  const [rules, setRules] = useState<Rule[]>([emptyRule()]);

  const updateRule = (index: number, patch: Partial<Rule>) =>
    setRules((prev) => prev.map((r, i) => (i === index ? { ...r, ...patch } : r)));
  const addRule = () => setRules((prev) => [...prev, emptyRule()]);
  const removeRule = (index: number) => setRules((prev) => prev.filter((_, i) => i !== index));

  const rulesValid = rules.length > 0 && rules.every((r) => r.value.trim() !== '');

  const createMut = useMutation({
    mutationFn: () =>
      crmApi.createSegment({
        name,
        description,
        rules: rules.map((r) => ({ field: r.field, operator: r.operator, value: r.value })),
        logic,
      }),
    onSuccess: () => {
      toast.success('Segment created');
      qc.invalidateQueries({ queryKey: ['crm-segments'] });
      navigate(LIST_PATH);
    },
    onError: () => toast.error('Failed to create segment'),
  });

  return (
    <div>
      <ERPPageHeader
        variant="detail"
        title="New Custom Segment"
        subtitle="Build a filter-based customer segment for targeted campaigns"
        backTo={LIST_PATH}
      />

      <ERPFormSection title="Segment Details" columns={2}>
        <Input
          label="Segment Name"
          required
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
        <Input
          label="Description (optional)"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
        />
      </ERPFormSection>

      <ERPFormSection title="Filter Rules" columns={1}>
        <div className="space-y-2">
          {rules.map((rule, index) => (
            <div key={index} className="flex items-center gap-2 flex-wrap">
              {index > 0 && (
                <select
                  value={logic}
                  onChange={(e) => setLogic(e.target.value as 'AND' | 'OR')}
                  aria-label="Rule combination logic"
                  className="w-20 rounded-lg border border-default bg-surface-card text-primary text-sm px-2 py-2 font-semibold"
                >
                  <option value="AND">AND</option>
                  <option value="OR">OR</option>
                </select>
              )}
              <select
                value={rule.field}
                onChange={(e) => updateRule(index, { field: e.target.value })}
                aria-label={`Rule ${index + 1} field`}
                className="flex-1 min-w-[10rem] rounded-lg border border-default bg-surface-card text-primary text-sm px-3 py-2"
              >
                {SEGMENT_FIELDS.map((f) => (
                  <option key={f} value={f}>
                    {f}
                  </option>
                ))}
              </select>
              <select
                value={rule.operator}
                onChange={(e) => updateRule(index, { operator: e.target.value })}
                aria-label={`Rule ${index + 1} operator`}
                className="w-28 rounded-lg border border-default bg-surface-card text-primary text-sm px-3 py-2"
              >
                {OPERATORS.map((o) => (
                  <option key={o} value={o}>
                    {o}
                  </option>
                ))}
              </select>
              <Input
                placeholder="Value"
                value={rule.value}
                onChange={(e) => updateRule(index, { value: e.target.value })}
                aria-label={`Rule ${index + 1} value`}
              />
              {rules.length > 1 && (
                <Button
                  variant="ghost"
                  onClick={() => removeRule(index)}
                  aria-label={`Remove rule ${index + 1}`}
                >
                  Remove
                </Button>
              )}
            </div>
          ))}
          <Button variant="secondary" onClick={addRule}>
            + Add Rule
          </Button>
          {rules.length > 1 && (
            <p className="text-xs text-secondary">
              All rules are combined with <strong>{logic}</strong> logic.
            </p>
          )}
        </div>
      </ERPFormSection>

      <ERPStickyFooter>
        <Button variant="secondary" onClick={() => navigate(LIST_PATH)}>
          Cancel
        </Button>
        <Button
          onClick={() => createMut.mutate()}
          disabled={createMut.isPending || !name || !rulesValid}
        >
          {createMut.isPending ? 'Creating…' : 'Create Segment'}
        </Button>
      </ERPStickyFooter>
    </div>
  );
}
