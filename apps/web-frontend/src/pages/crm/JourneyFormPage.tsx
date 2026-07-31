import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { crmApi } from '../../api/endpoints.js';
import ERPPageHeader from '../../components/erp/ERPPageHeader.js';
import ERPFormSection from '../../components/erp/ERPFormSection.js';
import ERPStickyFooter from '../../components/erp/ERPStickyFooter.js';
import Button from '../../components/ui/Button.js';
import Input from '../../components/ui/Input.js';
import Select from '../../components/ui/Select.js';

type StepType = 'DELAY' | 'ACTION' | 'BRANCH';
type Channel = 'SMS' | 'WHATSAPP' | 'EMAIL' | 'IN_APP';

// CRM-ROADMAP Phase 2, Feature 2 — no drag-and-drop/graph library exists anywhere in this
// codebase (confirmed via grep: reactflow/@xyflow/react/dagre/react-dnd/dnd-kit/cytoscape all
// zero hits) and none is justified here per 05-UI-UX-PLAN.md §1. A BRANCH step's two outcomes
// are short nested step lists that terminate the journey, not an arbitrary graph — this ordered
// nested-list model (mirroring SegmentFormPage.tsx's flat Rule[] pattern one level deeper)
// covers the roadmap's own "welcome → wait 3 days → conditional offer" example exactly.
interface StepUI {
  key: string;
  stepType: StepType;
  delayDays: string;
  channel: Channel;
  messageTemplate: string;
  branchWithinDays: string;
  truePath: StepUI[];
  falsePath: StepUI[];
}

let keySeq = 0;
function emptyStep(): StepUI {
  keySeq += 1;
  return {
    key: `step-${keySeq}`,
    stepType: 'DELAY',
    delayDays: '3',
    channel: 'SMS',
    messageTemplate: '',
    branchWithinDays: '7',
    truePath: [],
    falsePath: [],
  };
}

function isStepComplete(s: StepUI): boolean {
  if (s.stepType === 'DELAY') return !!s.delayDays && Number(s.delayDays) >= 1;
  if (s.stepType === 'ACTION') return s.messageTemplate.trim() !== '';
  if (s.stepType === 'BRANCH') {
    return (
      (s.truePath.length > 0 || s.falsePath.length > 0) &&
      s.truePath.every(isStepComplete) &&
      s.falsePath.every(isStepComplete)
    );
  }
  return false;
}

function toApiStep(s: StepUI): Record<string, unknown> {
  if (s.stepType === 'DELAY') return { stepType: 'DELAY', delayDays: Number(s.delayDays) };
  if (s.stepType === 'ACTION')
    return { stepType: 'ACTION', channel: s.channel, messageTemplate: s.messageTemplate };
  return {
    stepType: 'BRANCH',
    branchConditionType: 'MADE_PURCHASE',
    branchWithinDays: Number(s.branchWithinDays),
    ...(s.truePath.length ? { truePath: s.truePath.map(toApiStep) } : {}),
    ...(s.falsePath.length ? { falsePath: s.falsePath.map(toApiStep) } : {}),
  };
}

function StepListEditor({
  steps,
  onChange,
  depth,
}: {
  steps: StepUI[];
  onChange: (steps: StepUI[]) => void;
  depth: number;
}) {
  const update = (index: number, patch: Partial<StepUI>) =>
    onChange(steps.map((s, i) => (i === index ? { ...s, ...patch } : s)));
  const remove = (index: number) => onChange(steps.filter((_, i) => i !== index));

  return (
    <div className="space-y-3">
      {steps.map((step, index) => (
        <div
          key={step.key}
          className="rounded-lg border border-default p-3 space-y-3 bg-surface-card"
        >
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-xs font-semibold text-secondary shrink-0">Step {index + 1}</span>
            <Select
              aria-label={`Step ${index + 1} type`}
              value={step.stepType}
              onChange={(e) => update(index, { stepType: e.target.value as StepType })}
              className="w-48"
            >
              <option value="DELAY">Delay</option>
              <option value="ACTION">Action — send a message</option>
              <option value="BRANCH">Branch — condition</option>
            </Select>
            <div className="flex-1" />
            <Button variant="ghost" size="sm" onClick={() => remove(index)}>
              Remove
            </Button>
          </div>

          {step.stepType === 'DELAY' && (
            <Input
              type="number"
              min={1}
              label="Wait (days) before the next step"
              value={step.delayDays}
              onChange={(e) => update(index, { delayDays: e.target.value })}
              aria-label={`Step ${index + 1} delay days`}
            />
          )}

          {step.stepType === 'ACTION' && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <Select
                label="Channel"
                value={step.channel}
                onChange={(e) => update(index, { channel: e.target.value as Channel })}
                aria-label={`Step ${index + 1} channel`}
              >
                <option value="SMS">SMS</option>
                <option value="WHATSAPP">WhatsApp</option>
                <option value="EMAIL">Email</option>
                <option value="IN_APP">In-App</option>
              </Select>
              <Input
                label="Message"
                placeholder="Hi {{customerName}}!"
                value={step.messageTemplate}
                onChange={(e) => update(index, { messageTemplate: e.target.value })}
                aria-label={`Step ${index + 1} message template`}
              />
            </div>
          )}

          {step.stepType === 'BRANCH' && (
            <>
              <Input
                type="number"
                min={1}
                label="Condition: made a purchase within (days)"
                value={step.branchWithinDays}
                onChange={(e) => update(index, { branchWithinDays: e.target.value })}
                aria-label={`Step ${index + 1} branch window days`}
              />
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-1">
                <div>
                  <p className="text-xs font-semibold text-success mb-2">
                    If TRUE — made a purchase
                  </p>
                  <StepListEditor
                    steps={step.truePath}
                    onChange={(s) => update(index, { truePath: s })}
                    depth={depth + 1}
                  />
                  <Button
                    variant="secondary"
                    size="sm"
                    className="mt-2"
                    onClick={() => update(index, { truePath: [...step.truePath, emptyStep()] })}
                  >
                    + Add step
                  </Button>
                </div>
                <div>
                  <p className="text-xs font-semibold text-danger mb-2">If FALSE — no purchase</p>
                  <StepListEditor
                    steps={step.falsePath}
                    onChange={(s) => update(index, { falsePath: s })}
                    depth={depth + 1}
                  />
                  <Button
                    variant="secondary"
                    size="sm"
                    className="mt-2"
                    onClick={() => update(index, { falsePath: [...step.falsePath, emptyStep()] })}
                  >
                    + Add step
                  </Button>
                </div>
              </div>
            </>
          )}
        </div>
      ))}
      <Button variant="secondary" size="sm" onClick={() => onChange([...steps, emptyStep()])}>
        + Add Step
      </Button>
    </div>
  );
}

const LIST_PATH = '/crm/journeys';

export default function JourneyFormPage() {
  const navigate = useNavigate();
  const qc = useQueryClient();

  const [name, setName] = useState('');
  const [segmentId, setSegmentId] = useState('');
  const [steps, setSteps] = useState<StepUI[]>([emptyStep()]);

  const { data: segmentsData } = useQuery({
    queryKey: ['crm-segments'],
    queryFn: () => crmApi.listSegments(),
  });
  const segments =
    (segmentsData as { content?: Array<{ id: number; name: string }> })?.content ?? [];

  const stepsValid = steps.length > 0 && steps.every(isStepComplete);

  const createMut = useMutation({
    mutationFn: () =>
      crmApi.createJourney({
        name,
        ...(segmentId ? { segmentId: Number(segmentId) } : {}),
        steps: steps.map(toApiStep),
      }),
    onSuccess: () => {
      toast.success('Journey created as a draft');
      qc.invalidateQueries({ queryKey: ['journeys'] });
      navigate(LIST_PATH);
    },
    onError: () => toast.error('Failed to create journey'),
  });

  return (
    <div>
      <ERPPageHeader
        variant="detail"
        title="New Customer Journey"
        subtitle="A multi-step, branching automation sequence — saved as a draft until published"
        backTo={LIST_PATH}
      />

      <ERPFormSection title="Journey Details" columns={2}>
        <Input
          label="Journey Name"
          required
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
        <Select
          label="Target Segment (optional)"
          value={segmentId}
          onChange={(e) => setSegmentId(e.target.value)}
          hint="Leave blank to only enroll customers manually"
        >
          <option value="">No segment — manual enrollment only</option>
          {segments.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </Select>
      </ERPFormSection>

      <ERPFormSection title="Steps" columns={1}>
        <StepListEditor steps={steps} onChange={setSteps} depth={0} />
      </ERPFormSection>

      <ERPStickyFooter>
        <Button variant="secondary" onClick={() => navigate(LIST_PATH)}>
          Cancel
        </Button>
        <Button
          onClick={() => createMut.mutate()}
          disabled={createMut.isPending || !name || !stepsValid}
        >
          {createMut.isPending ? 'Saving…' : 'Save Draft'}
        </Button>
      </ERPStickyFooter>
    </div>
  );
}
