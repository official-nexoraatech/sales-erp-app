import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { leadApi } from '../../api/endpoints.js';
import { useAuthStore } from '../../store/auth.store.js';
import { PERMISSIONS } from '../../constants/permissions.js';
import ERPPageHeader from '../../components/erp/ERPPageHeader.js';
import { ERPTableSkeleton } from '../../components/erp/ERPSkeleton.js';
import ERPEmptyState from '../../components/erp/ERPEmptyState.js';
import Button from '../../components/ui/Button.js';
import Badge from '../../components/ui/Badge.js';
import type { LEAD_STAGES } from '../../schemas/lead.schema.js';

interface Lead {
  id: number;
  displayName?: string;
  companyName?: string;
  phone: string;
  stage: (typeof LEAD_STAGES)[number];
  source: string;
  assignedTo?: number;
  version: number;
}

const STAGE_LABELS: Record<(typeof LEAD_STAGES)[number], string> = {
  NEW: 'New',
  CONTACTED: 'Contacted',
  QUALIFIED: 'Qualified',
  CONVERTED: 'Converted',
  LOST: 'Lost',
};

const BOARD_STAGES = ['NEW', 'CONTACTED', 'QUALIFIED'] as const;

export default function LeadsKanbanPage() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const hasPermission = useAuthStore((s) => s.hasPermission);
  const canUpdate = hasPermission(PERMISSIONS.LEAD_UPDATE);
  const canCreate = hasPermission(PERMISSIONS.LEAD_CREATE);
  const canImport = hasPermission(PERMISSIONS.LEAD_IMPORT);
  const [draggingId, setDraggingId] = useState<number | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ['leads'],
    queryFn: () => leadApi.list(),
  });
  const leads: Lead[] = (data as { content?: Lead[] })?.content ?? [];

  const stageMutation = useMutation({
    mutationFn: ({ lead, stage }: { lead: Lead; stage: string }) =>
      leadApi.update(lead.id, { version: lead.version, stage }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['leads'] });
    },
    onError: (err: Error) => toast.error(err.message),
  });

  function onDrop(stage: (typeof BOARD_STAGES)[number]) {
    if (draggingId === null) return;
    const lead = leads.find((l) => l.id === draggingId);
    setDraggingId(null);
    if (!lead || lead.stage === stage) return;
    stageMutation.mutate({ lead, stage });
  }

  return (
    <div>
      <ERPPageHeader
        variant="list"
        title="Leads"
        subtitle="Pre-purchase interest, captured before a customer exists."
        actions={
          <>
            {canImport && (
              <Button variant="secondary" onClick={() => navigate('/crm/leads/import')}>
                Import
              </Button>
            )}
            {canCreate && <Button onClick={() => navigate('/crm/leads/new')}>+ New Lead</Button>}
          </>
        }
      />

      {isLoading ? (
        <ERPTableSkeleton rows={4} cols={3} />
      ) : leads.length === 0 ? (
        <ERPEmptyState
          type="no-data"
          title="No leads yet"
          description="Leads captured from the public form or added manually will appear here."
          {...(canCreate
            ? { action: { label: '+ New Lead', onClick: () => navigate('/crm/leads/new') } }
            : {})}
        />
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {BOARD_STAGES.map((stage) => {
            const stageLeads = leads.filter((l) => l.stage === stage);
            return (
              <div
                key={stage}
                onDragOver={(e) => canUpdate && e.preventDefault()}
                onDrop={() => canUpdate && onDrop(stage)}
                className="bg-surface-card rounded-xl border border-default flex flex-col"
              >
                <div className="px-4 py-3 border-b border-default flex items-center justify-between">
                  <h2 className="text-sm font-semibold text-primary">{STAGE_LABELS[stage]}</h2>
                  <Badge label={String(stageLeads.length)} color="gray" />
                </div>
                <div className="p-3 space-y-2 min-h-[120px]">
                  {stageLeads.map((lead) => (
                    <div
                      key={lead.id}
                      draggable={canUpdate}
                      onDragStart={() => setDraggingId(lead.id)}
                      className="bg-surface-raised rounded-lg border border-default px-3 py-2.5 hover:border-primary transition-colors"
                    >
                      <div
                        className="cursor-pointer"
                        onClick={() => navigate(`/crm/leads/${lead.id}`)}
                      >
                        <p className="text-sm font-medium text-primary truncate">
                          {lead.displayName || lead.companyName || lead.phone}
                        </p>
                        <p className="text-xs text-secondary mt-0.5">{lead.phone}</p>
                        <div className="flex items-center gap-1.5 mt-1.5">
                          <Badge label={lead.source.replace(/_/g, ' ')} color="blue" />
                          {lead.assignedTo && <Badge label="Assigned" color="green" />}
                        </div>
                      </div>
                      {/* CRM-ROADMAP Phase 3, Feature 4 (Mobile CRM) — native HTML5 drag-and-drop
                          has no touch equivalent; this is the only way to move a lead on a phone. */}
                      {canUpdate && (
                        <select
                          aria-label={`Move ${lead.displayName || lead.phone} to a different stage`}
                          value={lead.stage}
                          onClick={(e) => e.stopPropagation()}
                          onChange={(e) => stageMutation.mutate({ lead, stage: e.target.value })}
                          className="mt-1.5 w-full rounded-md border border-default bg-surface-card text-xs px-2 py-1.5"
                        >
                          {BOARD_STAGES.map((s) => (
                            <option key={s} value={s}>
                              {STAGE_LABELS[s]}
                            </option>
                          ))}
                        </select>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
