import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { crmApi, categoryApi } from '../../api/endpoints.js';
import { useDebounce } from '../../hooks/useDebounce.js';
import ERPPageHeader from '../../components/erp/ERPPageHeader.js';
import ERPFormSection from '../../components/erp/ERPFormSection.js';
import ERPStickyFooter from '../../components/erp/ERPStickyFooter.js';
import Button from '../../components/ui/Button.js';
import Input from '../../components/ui/Input.js';
import Select from '../../components/ui/Select.js';

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
// CRM-ROADMAP Phase 2, Feature 7 — behavioral/RFM operators, each with its own value shape
// (not a single "value" string like the 7 above), so they're rendered with dedicated inputs
// below rather than the generic Value box.
const BEHAVIORAL_OPERATORS = ['between_dates', 'purchased_category', 'rfm_score'] as const;
type BehavioralOperator = (typeof BEHAVIORAL_OPERATORS)[number];
// between_dates only makes sense against a date-typed column — matches
// SegmentService.betweenDatesCondition's own restriction.
const DATE_FIELDS = ['createdAt', 'dateOfBirth', 'anniversary'];

interface Rule {
  field: string;
  operator: string;
  value: string;
  dateFrom: string;
  dateTo: string;
  categoryId: string;
  withinDays: string;
  maxRecencyDays: string;
  minFrequency: string;
  minMonetary: string;
}

function emptyRule(): Rule {
  return {
    field: 'status',
    operator: 'eq',
    value: '',
    dateFrom: '',
    dateTo: '',
    categoryId: '',
    withinDays: '',
    maxRecencyDays: '',
    minFrequency: '',
    minMonetary: '',
  };
}

function isBehavioral(operator: string): operator is BehavioralOperator {
  return (BEHAVIORAL_OPERATORS as readonly string[]).includes(operator);
}

// Maps the UI's flat Rule shape to the API's { field, operator, value } shape — value is a
// structured object for the 3 behavioral operators, a plain string for the original 7.
function toApiRule(r: Rule): { field: string; operator: string; value: unknown } {
  switch (r.operator) {
    case 'between_dates':
      return { field: r.field, operator: r.operator, value: { from: r.dateFrom, to: r.dateTo } };
    case 'purchased_category':
      return {
        field: 'purchases',
        operator: r.operator,
        value: {
          categoryId: Number(r.categoryId),
          ...(r.withinDays ? { withinDays: Number(r.withinDays) } : {}),
        },
      };
    case 'rfm_score':
      return {
        field: 'rfm',
        operator: r.operator,
        value: {
          ...(r.maxRecencyDays ? { maxRecencyDays: Number(r.maxRecencyDays) } : {}),
          ...(r.minFrequency ? { minFrequency: Number(r.minFrequency) } : {}),
          ...(r.minMonetary ? { minMonetary: Number(r.minMonetary) } : {}),
        },
      };
    default:
      return { field: r.field, operator: r.operator, value: r.value };
  }
}

function isRuleComplete(r: Rule): boolean {
  if (r.operator === 'between_dates') return !!r.dateFrom && !!r.dateTo;
  if (r.operator === 'purchased_category') return !!r.categoryId;
  if (r.operator === 'rfm_score') return !!r.maxRecencyDays || !!r.minFrequency || !!r.minMonetary;
  return r.value.trim() !== '';
}

const LIST_PATH = '/crm/segments';

export default function SegmentFormPage() {
  const navigate = useNavigate();
  const qc = useQueryClient();

  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [logic, setLogic] = useState<'AND' | 'OR'>('AND');
  const [rules, setRules] = useState<Rule[]>([emptyRule()]);

  const { data: categoriesData } = useQuery({
    queryKey: ['categories'],
    queryFn: () => categoryApi.list(),
  });
  const categories =
    (categoriesData as { content?: Array<{ id: number; name: string }> })?.content ?? [];

  const updateRule = (index: number, patch: Partial<Rule>) =>
    setRules((prev) => prev.map((r, i) => (i === index ? { ...r, ...patch } : r)));
  const addRule = () => setRules((prev) => [...prev, emptyRule()]);
  const removeRule = (index: number) => setRules((prev) => prev.filter((_, i) => i !== index));

  const rulesValid = rules.length > 0 && rules.every(isRuleComplete);

  // CRM-ROADMAP Phase 2, Feature 7 — live membership-count preview. The backend route
  // (POST /crm/segments/preview) already existed before this feature; only this UI wiring was
  // missing (per the phase doc's own "verify it exists today — if not, add it here" note).
  const apiRules = rules.map(toApiRule);
  const debouncedRules = useDebounce(JSON.stringify(apiRules), 500);
  const debouncedLogic = useDebounce(logic, 500);
  const { data: previewData, isFetching: previewLoading } = useQuery({
    queryKey: ['segment-preview', debouncedRules, debouncedLogic],
    queryFn: () =>
      crmApi.previewSegment({ rules: JSON.parse(debouncedRules), logic: debouncedLogic }),
    enabled: rulesValid,
  });
  const matchingCount = (previewData as { matchingCount?: number } | undefined)?.matchingCount;

  const createMut = useMutation({
    mutationFn: () =>
      crmApi.createSegment({
        name,
        description,
        rules: apiRules,
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
        <div className="space-y-3">
          {rules.map((rule, index) => (
            <div key={index} className="flex items-start gap-2 flex-wrap">
              {index > 0 && (
                <select
                  value={logic}
                  onChange={(e) => setLogic(e.target.value as 'AND' | 'OR')}
                  aria-label="Rule combination logic"
                  className="w-20 rounded-lg border border-default bg-surface-card text-primary text-sm px-2 py-2 font-semibold mt-0.5"
                >
                  <option value="AND">AND</option>
                  <option value="OR">OR</option>
                </select>
              )}

              {!isBehavioral(rule.operator) && (
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
              )}
              {rule.operator === 'between_dates' && (
                <select
                  value={DATE_FIELDS.includes(rule.field) ? rule.field : DATE_FIELDS[0]}
                  onChange={(e) => updateRule(index, { field: e.target.value })}
                  aria-label={`Rule ${index + 1} date field`}
                  className="flex-1 min-w-[10rem] rounded-lg border border-default bg-surface-card text-primary text-sm px-3 py-2"
                >
                  {DATE_FIELDS.map((f) => (
                    <option key={f} value={f}>
                      {f}
                    </option>
                  ))}
                </select>
              )}

              <select
                value={rule.operator}
                onChange={(e) =>
                  updateRule(index, {
                    operator: e.target.value,
                    field: e.target.value === 'between_dates' ? DATE_FIELDS[0]! : rule.field,
                  })
                }
                aria-label={`Rule ${index + 1} operator`}
                className="w-40 rounded-lg border border-default bg-surface-card text-primary text-sm px-3 py-2"
              >
                <optgroup label="Standard">
                  {OPERATORS.map((o) => (
                    <option key={o} value={o}>
                      {o}
                    </option>
                  ))}
                </optgroup>
                <optgroup label="Behavioral / RFM">
                  <option value="between_dates">between dates</option>
                  <option value="purchased_category">purchased category</option>
                  <option value="rfm_score">RFM threshold</option>
                </optgroup>
              </select>

              {rule.operator === 'between_dates' && (
                <>
                  <Input
                    type="date"
                    aria-label={`Rule ${index + 1} from date`}
                    value={rule.dateFrom}
                    onChange={(e) => updateRule(index, { dateFrom: e.target.value })}
                    className="w-40"
                  />
                  <Input
                    type="date"
                    aria-label={`Rule ${index + 1} to date`}
                    value={rule.dateTo}
                    onChange={(e) => updateRule(index, { dateTo: e.target.value })}
                    className="w-40"
                  />
                </>
              )}

              {rule.operator === 'purchased_category' && (
                <>
                  <Select
                    aria-label={`Rule ${index + 1} category`}
                    value={rule.categoryId}
                    onChange={(e) => updateRule(index, { categoryId: e.target.value })}
                    className="w-40"
                  >
                    <option value="">Select category…</option>
                    {categories.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </Select>
                  <Input
                    type="number"
                    placeholder="Within last N days"
                    aria-label={`Rule ${index + 1} within days`}
                    value={rule.withinDays}
                    onChange={(e) => updateRule(index, { withinDays: e.target.value })}
                    className="w-40"
                  />
                </>
              )}

              {rule.operator === 'rfm_score' && (
                <>
                  <Input
                    type="number"
                    placeholder="Max days since last order"
                    aria-label={`Rule ${index + 1} max recency days`}
                    value={rule.maxRecencyDays}
                    onChange={(e) => updateRule(index, { maxRecencyDays: e.target.value })}
                    className="w-44"
                  />
                  <Input
                    type="number"
                    placeholder="Min order count"
                    aria-label={`Rule ${index + 1} min frequency`}
                    value={rule.minFrequency}
                    onChange={(e) => updateRule(index, { minFrequency: e.target.value })}
                    className="w-36"
                  />
                  <Input
                    type="number"
                    placeholder="Min lifetime value"
                    aria-label={`Rule ${index + 1} min monetary`}
                    value={rule.minMonetary}
                    onChange={(e) => updateRule(index, { minMonetary: e.target.value })}
                    className="w-36"
                  />
                </>
              )}

              {!isBehavioral(rule.operator) && (
                <Input
                  placeholder="Value"
                  value={rule.value}
                  onChange={(e) => updateRule(index, { value: e.target.value })}
                  aria-label={`Rule ${index + 1} value`}
                />
              )}

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

          <div className="rounded-lg border border-default bg-surface-subtle px-3 py-2 text-sm">
            {!rulesValid ? (
              <span className="text-secondary">Complete every rule to see a live match count.</span>
            ) : previewLoading ? (
              <span className="text-secondary">Counting matching customers…</span>
            ) : (
              <span className="text-primary">
                <strong>{matchingCount ?? 0}</strong> customer{matchingCount === 1 ? '' : 's'} match
                right now
              </span>
            )}
          </div>
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
