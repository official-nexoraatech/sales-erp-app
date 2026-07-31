import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { dltTemplateApi } from '../../api/endpoints.js';
import ERPPageHeader from '../../components/erp/ERPPageHeader.js';
import ERPEmptyState from '../../components/erp/ERPEmptyState.js';
import { ERPTableSkeleton } from '../../components/erp/ERPSkeleton.js';
import Button from '../../components/ui/Button.js';
import Badge from '../../components/ui/Badge.js';
import Modal from '../../components/ui/Modal.js';
import Input from '../../components/ui/Input.js';
import Checkbox from '../../components/ui/Checkbox.js';
import { formatDatetime } from '../../lib/format.js';
import {
  dltTemplateFormSchema,
  type DltTemplateFormData,
} from '../../schemas/dltTemplate.schema.js';

interface DltTemplate {
  id: number;
  templateId: string;
  header: string;
  messagePattern: string;
  isActive: boolean;
  expiresAt?: string;
  version: number;
}

// CRM-ROADMAP Phase 1, Feature 6 — DLT/TRAI SMS Compliance. Admin-only registration UI for
// templates the tenant has actually registered with their telecom operator — this page does
// not register anything with DLT itself (that's an out-of-band, legal process), it just
// records what's already been registered so NotificationEngine can enforce the gate.
export default function DltTemplatesPage() {
  const qc = useQueryClient();
  const [modalOpen, setModalOpen] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ['dlt-templates'],
    queryFn: () => dltTemplateApi.list(),
  });
  const templates: DltTemplate[] = (data as { content?: DltTemplate[] })?.content ?? [];

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<DltTemplateFormData>({
    resolver: zodResolver(dltTemplateFormSchema),
    defaultValues: { isActive: true },
  });

  const createMut = useMutation({
    mutationFn: (d: DltTemplateFormData) => dltTemplateApi.create(d),
    onSuccess: () => {
      toast.success('DLT template registered');
      qc.invalidateQueries({ queryKey: ['dlt-templates'] });
      setModalOpen(false);
      reset({ isActive: true });
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const deleteMut = useMutation({
    mutationFn: (id: number) => dltTemplateApi.delete(id),
    onSuccess: () => {
      toast.success('Template removed');
      qc.invalidateQueries({ queryKey: ['dlt-templates'] });
    },
    onError: (err: Error) => toast.error(err.message),
  });

  return (
    <div>
      <ERPPageHeader
        variant="list"
        title="DLT Templates"
        subtitle="Templates registered with your telecom operator for promotional SMS — required by TRAI regulation before any campaign SMS can be sent."
        actions={<Button onClick={() => setModalOpen(true)}>+ Register Template</Button>}
      />

      {isLoading ? (
        <ERPTableSkeleton rows={4} cols={4} />
      ) : templates.length === 0 ? (
        <ERPEmptyState
          type="no-data"
          title="No DLT templates registered"
          description="No promotional SMS campaign can be sent until at least one matching template is registered here."
          action={{ label: '+ Register Template', onClick: () => setModalOpen(true) }}
        />
      ) : (
        <div className="bg-surface-card rounded-xl border border-default divide-y divide-default">
          {templates.map((t) => (
            <div key={t.id} className="flex items-start justify-between gap-4 px-5 py-4">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-sm font-semibold text-primary">{t.templateId}</span>
                  <Badge label={t.header} color="blue" />
                  <Badge
                    label={t.isActive ? 'ACTIVE' : 'INACTIVE'}
                    color={t.isActive ? 'green' : 'gray'}
                  />
                  {t.expiresAt && new Date(t.expiresAt) < new Date() && (
                    <Badge label="EXPIRED" color="red" />
                  )}
                </div>
                <p className="text-xs text-secondary mt-1 font-mono">{t.messagePattern}</p>
                {t.expiresAt && (
                  <p className="text-xs text-disabled mt-1">
                    Expires: {formatDatetime(t.expiresAt)}
                  </p>
                )}
              </div>
              <Button variant="ghost" size="sm" onClick={() => deleteMut.mutate(t.id)}>
                Remove
              </Button>
            </div>
          ))}
        </div>
      )}

      <Modal open={modalOpen} onClose={() => setModalOpen(false)} title="Register DLT Template">
        <form onSubmit={handleSubmit((d) => createMut.mutate(d))} className="space-y-4" noValidate>
          <Input
            label="DLT Template ID"
            required
            {...register('templateId')}
            error={errors.templateId?.message}
          />
          <Input
            label="Approved Sender Header"
            required
            placeholder="e.g. TXTIND"
            {...register('header')}
            error={errors.header?.message}
          />
          <div>
            <label className="block text-xs font-medium text-secondary mb-1.5">
              Registered Message Pattern
            </label>
            <textarea
              {...register('messagePattern')}
              rows={3}
              placeholder="Dear {#var#}, your order {#var#} has been shipped."
              className="w-full rounded-lg border border-default bg-surface-card text-primary text-sm px-3 py-2 font-mono resize-none"
            />
            {errors.messagePattern && (
              <p className="text-xs text-danger mt-1">{errors.messagePattern.message}</p>
            )}
            <p className="text-xs text-disabled mt-1">
              Use <code>{'{#var#}'}</code> exactly as registered with your telecom operator for each
              variable.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Checkbox {...register('isActive')} />
            <label className="text-sm text-primary">Active</label>
          </div>
          <div className="flex gap-2 justify-end pt-2">
            <Button variant="ghost" type="button" onClick={() => setModalOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" loading={isSubmitting || createMut.isPending}>
              Register
            </Button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
