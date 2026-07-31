import { useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { crmAccountApi } from '../../api/endpoints.js';
import { useDebounce } from '../../hooks/useDebounce.js';
import { useAuthStore } from '../../store/auth.store.js';
import { PERMISSIONS } from '../../constants/permissions.js';
import ERPPageHeader from '../../components/erp/ERPPageHeader.js';
import { ERPDetailSkeleton } from '../../components/erp/ERPSkeleton.js';
import ERPEmptyState from '../../components/erp/ERPEmptyState.js';
import Button from '../../components/ui/Button.js';
import Badge from '../../components/ui/Badge.js';
import Modal from '../../components/ui/Modal.js';
import Input from '../../components/ui/Input.js';
import Select from '../../components/ui/Select.js';
import Checkbox from '../../components/ui/Checkbox.js';
import {
  crmContactFormSchema,
  CRM_CONTACT_ROLES,
  type CrmContactFormData,
} from '../../schemas/crmAccount.schema.js';
import { formatDatetime } from '../../lib/format.js';

interface CrmAccountContact {
  id: number;
  name: string;
  role: (typeof CRM_CONTACT_ROLES)[number];
  email?: string;
  phone?: string;
  isPrimary: boolean;
  lastContactedAt?: string;
}

interface CrmAccountSummary {
  id: number;
  name: string;
}

const ROLE_LABELS: Record<(typeof CRM_CONTACT_ROLES)[number], string> = {
  BILLING: 'Billing',
  DECISION_MAKER: 'Decision Maker',
  SHIPPING: 'Shipping',
  PRIMARY: 'Primary',
  OTHER: 'Other',
};

const BLANK_CONTACT: CrmContactFormData = {
  name: '',
  role: 'OTHER',
  email: '',
  phone: '',
  isPrimary: false,
  notes: '',
};

export default function CrmAccountDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const accountId = Number(id);
  const hasPermission = useAuthStore((s) => s.hasPermission);
  const canUpdate = hasPermission(PERMISSIONS.CRM_ACCOUNT_UPDATE);
  const canMerge = hasPermission(PERMISSIONS.CRM_ACCOUNT_MERGE);

  const [contactModalOpen, setContactModalOpen] = useState(false);
  const [editingContactId, setEditingContactId] = useState<number | null>(null);
  const [mergeOpen, setMergeOpen] = useState(false);
  const [mergeSearch, setMergeSearch] = useState('');
  const [mergeTarget, setMergeTarget] = useState<CrmAccountSummary | null>(null);
  const debouncedMergeSearch = useDebounce(mergeSearch, 250);

  const { data, isLoading } = useQuery({
    queryKey: ['crm-accounts', id],
    queryFn: () => crmAccountApi.getById(accountId),
  });
  const account = data as Record<string, unknown> | undefined;

  const { data: contactsData } = useQuery({
    queryKey: ['crm-account-contacts', id],
    queryFn: () => crmAccountApi.listContacts(accountId),
  });
  const contacts: CrmAccountContact[] =
    (contactsData as { content?: CrmAccountContact[] })?.content ?? [];

  const { data: mergeResults } = useQuery({
    queryKey: ['crm-account-merge-search', debouncedMergeSearch],
    queryFn: () => crmAccountApi.list({ search: debouncedMergeSearch, size: 10 }),
    enabled: mergeOpen && debouncedMergeSearch.length >= 2,
  });
  const mergeCandidates: CrmAccountSummary[] = (
    (mergeResults as { content?: CrmAccountSummary[] })?.content ?? []
  ).filter((a) => a.id !== accountId);

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<CrmContactFormData>({
    resolver: zodResolver(crmContactFormSchema),
    defaultValues: BLANK_CONTACT,
  });

  const contactMutation = useMutation({
    mutationFn: (d: CrmContactFormData) =>
      editingContactId
        ? crmAccountApi.updateContact(accountId, editingContactId, d)
        : crmAccountApi.addContact(accountId, d),
    onSuccess: () => {
      toast.success(editingContactId ? 'Contact updated' : 'Contact added');
      qc.invalidateQueries({ queryKey: ['crm-account-contacts', id] });
      setContactModalOpen(false);
      setEditingContactId(null);
      reset(BLANK_CONTACT);
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const deleteContactMutation = useMutation({
    mutationFn: (contactId: number) => crmAccountApi.deleteContact(accountId, contactId),
    onSuccess: () => {
      toast.success('Contact removed');
      qc.invalidateQueries({ queryKey: ['crm-account-contacts', id] });
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const mergeMutation = useMutation({
    mutationFn: () => crmAccountApi.merge({ sourceId: accountId, targetId: mergeTarget!.id }),
    onSuccess: () => {
      toast.success('Account merged');
      navigate(`/crm/accounts/${mergeTarget!.id}`);
    },
    onError: (err: Error) => toast.error(err.message),
  });

  function openAddContact() {
    setEditingContactId(null);
    reset(BLANK_CONTACT);
    setContactModalOpen(true);
  }

  function openEditContact(c: CrmAccountContact) {
    setEditingContactId(c.id);
    reset({
      name: c.name,
      role: c.role,
      email: c.email ?? '',
      phone: c.phone ?? '',
      isPrimary: c.isPrimary,
      notes: '',
    });
    setContactModalOpen(true);
  }

  if (isLoading) return <ERPDetailSkeleton />;
  if (!account) return <ERPEmptyState type="no-data" title="Account not found" />;

  return (
    <div>
      <ERPPageHeader
        variant="list"
        title={String(account.name)}
        subtitle={`Account Type: ${account.accountType}${account.isImplicit ? ' · Auto-created' : ''}`}
        actions={
          <div className="flex gap-2 flex-wrap">
            {canUpdate && (
              <Button variant="secondary" onClick={() => navigate(`/crm/accounts/${id}/edit`)}>
                Edit
              </Button>
            )}
            {canMerge && (
              <Button variant="secondary" onClick={() => setMergeOpen(true)}>
                Merge Into…
              </Button>
            )}
            <Button variant="secondary" onClick={() => navigate('/crm/accounts')}>
              Back
            </Button>
          </div>
        }
      />

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-4">
          <div className="bg-surface-card rounded-xl border border-default p-5">
            <h2 className="text-sm font-semibold text-secondary mb-4 uppercase tracking-wide">
              Details
            </h2>
            <dl className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {[
                { label: 'Phone', value: account.primaryPhone },
                { label: 'Email', value: account.primaryEmail },
                { label: 'GSTIN', value: account.gstin },
              ].map(({ label, value }) => (
                <div key={label}>
                  <dt className="text-xs text-disabled">{label}</dt>
                  <dd className="text-sm text-primary font-medium">
                    {(value as React.ReactNode) ?? '–'}
                  </dd>
                </div>
              ))}
            </dl>
            {account.notes ? (
              <p className="text-sm text-secondary mt-4">{String(account.notes)}</p>
            ) : null}
          </div>

          <div className="bg-surface-card rounded-xl border border-default">
            <div className="flex items-center justify-between px-5 py-4 border-b border-default">
              <h2 className="text-sm font-semibold text-secondary uppercase tracking-wide">
                Contacts
              </h2>
              {canUpdate && (
                <Button size="sm" onClick={openAddContact}>
                  + Add Contact
                </Button>
              )}
            </div>
            {contacts.length === 0 ? (
              <ERPEmptyState
                type="no-data"
                title="No contacts yet"
                description="Add a billing contact, decision maker, or other stakeholder for this account."
                {...(canUpdate
                  ? { action: { label: '+ Add Contact', onClick: openAddContact } }
                  : {})}
              />
            ) : (
              <div className="divide-y divide-default">
                {contacts.map((c) => (
                  <div key={c.id} className="flex items-start justify-between gap-4 px-5 py-3">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <p className="text-sm font-semibold text-primary">{c.name}</p>
                        <Badge label={ROLE_LABELS[c.role]} color="blue" />
                        {c.isPrimary && <Badge label="PRIMARY" color="green" />}
                      </div>
                      <p className="text-xs text-secondary mt-0.5">
                        {[c.phone, c.email].filter(Boolean).join(' · ') || 'No contact details'}
                      </p>
                      <p className="text-xs text-disabled mt-0.5">
                        Last contacted:{' '}
                        {c.lastContactedAt ? formatDatetime(c.lastContactedAt) : '—'}
                      </p>
                    </div>
                    {canUpdate && (
                      <div className="flex gap-2">
                        <Button variant="ghost" size="sm" onClick={() => openEditContact(c)}>
                          Edit
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => deleteContactMutation.mutate(c.id)}
                        >
                          Remove
                        </Button>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Add/Edit Contact Modal */}
      <Modal
        open={contactModalOpen}
        onClose={() => setContactModalOpen(false)}
        title={editingContactId ? 'Edit Contact' : 'Add Contact'}
      >
        <form
          onSubmit={handleSubmit((d) => contactMutation.mutate(d))}
          className="space-y-4"
          noValidate
        >
          <Input label="Name" required {...register('name')} error={errors.name?.message} />
          <Select label="Role" required {...register('role')} error={errors.role?.message}>
            {CRM_CONTACT_ROLES.map((r) => (
              <option key={r} value={r}>
                {ROLE_LABELS[r]}
              </option>
            ))}
          </Select>
          <Input label="Phone" {...register('phone')} error={errors.phone?.message} />
          <Input label="Email" type="email" {...register('email')} error={errors.email?.message} />
          <div className="flex items-center gap-2">
            <Checkbox {...register('isPrimary')} />
            <label className="text-sm text-primary">Primary contact for this account</label>
          </div>
          <div className="flex gap-2 justify-end pt-2">
            <Button variant="ghost" type="button" onClick={() => setContactModalOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" loading={isSubmitting || contactMutation.isPending}>
              Save
            </Button>
          </div>
        </form>
      </Modal>

      {/* Merge Modal */}
      <Modal
        open={mergeOpen}
        onClose={() => setMergeOpen(false)}
        title="Merge Into Another Account"
      >
        <div className="space-y-4">
          <p className="text-sm text-secondary">
            All contacts and customers under <strong>{String(account.name)}</strong> will be
            re-pointed to the account you choose below. This account is kept (not deleted) for
            traceability.
          </p>
          <Input
            label="Search target account"
            placeholder="Search by name…"
            value={mergeSearch}
            onChange={(e) => {
              setMergeSearch(e.target.value);
              setMergeTarget(null);
            }}
          />
          {mergeCandidates.length > 0 && !mergeTarget && (
            <div className="border border-default rounded-lg divide-y divide-default max-h-48 overflow-y-auto">
              {mergeCandidates.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => setMergeTarget(c)}
                  className="w-full text-left px-3 py-2 text-sm text-primary hover:bg-surface-raised"
                >
                  {c.name}
                </button>
              ))}
            </div>
          )}
          {mergeTarget && (
            <div className="bg-surface-raised rounded-lg px-3 py-2 flex items-center justify-between">
              <span className="text-sm text-primary">Merging into: {mergeTarget.name}</span>
              <Button variant="ghost" size="sm" onClick={() => setMergeTarget(null)}>
                Change
              </Button>
            </div>
          )}
          <div className="flex gap-2 justify-end pt-2">
            <Button variant="ghost" onClick={() => setMergeOpen(false)}>
              Cancel
            </Button>
            <Button
              onClick={() => mergeMutation.mutate()}
              disabled={!mergeTarget || mergeMutation.isPending}
            >
              {mergeMutation.isPending ? 'Merging…' : 'Merge'}
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
