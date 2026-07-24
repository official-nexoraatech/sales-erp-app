import React, { useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useNavigate, useParams } from 'react-router-dom';
import toast from 'react-hot-toast';
import { paymentNoteApi, usersApi } from '../../../api/endpoints';
import { queryClient } from '../../../app/queryClient';
import { Badge } from '../../../components/ui/Badge';
import { Button } from '../../../components/ui/Button';
import { Card } from '../../../components/ui/Card';
import { Loader } from '../../../components/ui/Loader';
import { PageHeader } from '../../../components/ui/PageHeader';
import { StatusBadge } from '../../../components/common/StatusBadge';
import { formatCurrency } from '../../../utils/formatCurrency';
import { formatDate } from '../../../utils/formatDate';
import { PAYMENT_NOTE_STATUSES } from '../../../types/payment-note.types';
import type { PaymentNoteStatus } from '../../../types/payment-note.types';
import { useAuth } from '../../../hooks/useAuth';
import { PERMISSIONS } from '../../../auth/permissions';

export const PaymentNoteViewPage: React.FC = () => {
  const navigate = useNavigate();
  const { hasPermission } = useAuth();
  const canUpdate = hasPermission(PERMISSIONS.PAYMENT_NOTE_UPDATE);
  const id = Number(useParams<{ id: string }>().id);

  const [nextStatus, setNextStatus] = useState<PaymentNoteStatus>('IN_PROGRESS');
  const [resolutionNotes, setResolutionNotes] = useState('');
  const [assignedToId, setAssignedToId] = useState(0);

  const { data, isLoading } = useQuery({
    queryKey: ['payment-notes', id],
    queryFn: () => paymentNoteApi.getById(id),
    enabled: id > 0,
  });
  const audit = useQuery({
    queryKey: ['payment-notes', id, 'audit'],
    queryFn: () => paymentNoteApi.getAuditTrail(id),
    enabled: id > 0,
  });
  const users = useQuery({ queryKey: ['payment-note-view-users'], queryFn: () => usersApi.getAll() });

  const note = data?.data;

  const statusMutation = useMutation({
    mutationFn: () => paymentNoteApi.updateStatus(id, { status: nextStatus, resolutionNotes: resolutionNotes || undefined }),
    onSuccess: () => {
      toast.success('Status updated');
      setResolutionNotes('');
      queryClient.invalidateQueries({ queryKey: ['payment-notes', id] });
      queryClient.invalidateQueries({ queryKey: ['payment-notes', id, 'audit'] });
    },
    onError: (error: any) => toast.error(error?.message || 'Failed to update status'),
  });

  const assignMutation = useMutation({
    mutationFn: () => paymentNoteApi.assign(id, { assignedToId }),
    onSuccess: () => {
      toast.success('Payment note assigned');
      queryClient.invalidateQueries({ queryKey: ['payment-notes', id] });
      queryClient.invalidateQueries({ queryKey: ['payment-notes', id, 'audit'] });
    },
    onError: (error: any) => toast.error(error?.message || 'Failed to assign payment note'),
  });

  if (isLoading) return <div className="p-10"><Loader /></div>;

  return (
    <div className="space-y-6">
      <PageHeader
        title={note?.noteNo || ''}
        breadcrumb={<div className="text-sm text-gray-500">Home &gt; Sale &gt; Payment Notes &gt; {note?.noteNo}</div>}
        actions={
          <div className="flex items-center gap-2">
            {note && <StatusBadge status={note.status} />}
            {note && <Badge variant="warning">{note.priority}</Badge>}
            <Button variant="secondary" onClick={() => navigate('/sales/payment-notes')}>Back</Button>
          </div>
        }
      />

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <Card>
            <h2 className="mb-4 text-lg font-semibold text-gray-900">{note?.subject}</h2>
            <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
              <div><p className="text-sm text-gray-500">Type</p><p className="font-semibold">{note?.noteType.replace('_', ' ')}</p></div>
              <div><p className="text-sm text-gray-500">Amount</p><p className="font-semibold">{note?.amount ? formatCurrency(note.amount) : 'N/A'}</p></div>
              <div><p className="text-sm text-gray-500">Related Invoice</p><p className="font-semibold">{note?.sale?.name || 'N/A'}</p></div>
              <div><p className="text-sm text-gray-500">Related Payment</p><p className="font-semibold">{note?.payment?.name || 'N/A'}</p></div>
              <div className="md:col-span-2"><p className="text-sm text-gray-500">Description</p><p className="whitespace-pre-wrap font-medium">{note?.description || 'N/A'}</p></div>
              {note?.resolutionNotes && (
                <div className="md:col-span-2"><p className="text-sm text-gray-500">Resolution Notes</p><p className="whitespace-pre-wrap font-medium">{note.resolutionNotes}</p></div>
              )}
            </div>
          </Card>

          <Card>
            <h2 className="mb-4 text-lg font-semibold text-gray-900">Activity</h2>
            {audit.isLoading ? <Loader /> : (
              <ol className="space-y-4 border-l border-gray-200 pl-4">
                {(audit.data?.data || []).map((entry, index) => (
                  <li key={index} className="relative">
                    <span className="absolute -left-[21px] top-1 h-2.5 w-2.5 rounded-full bg-blue-500" />
                    <p className="text-sm font-semibold text-gray-900">
                      {entry.action.replace('_', ' ')}
                      {entry.fieldName ? ` — ${entry.fieldName}` : ''}
                    </p>
                    {(entry.oldValue || entry.newValue) && (
                      <p className="text-sm text-gray-600">{entry.oldValue || 'N/A'} → {entry.newValue || 'N/A'}</p>
                    )}
                    <p className="text-xs text-gray-400">{entry.performedBy} · {formatDate(entry.performedAt)}</p>
                  </li>
                ))}
                {!audit.data?.data?.length && <p className="text-sm text-gray-500">No activity yet.</p>}
              </ol>
            )}
          </Card>
        </div>

        <div className="space-y-6">
          <Card>
            <h2 className="mb-4 text-lg font-semibold text-gray-900">Details</h2>
            <div className="space-y-4">
              <div><p className="text-sm text-gray-500">Contact</p><p className="font-semibold">{note?.contact?.name}</p></div>
              <div><p className="text-sm text-gray-500">Assigned To</p><p className="font-semibold">{note?.assignedTo?.name || 'Unassigned'}</p></div>
              <div><p className="text-sm text-gray-500">Created By</p><p className="font-semibold">{note?.createdBy}</p></div>
              <div><p className="text-sm text-gray-500">Created At</p><p className="font-semibold">{note ? formatDate(note.createdAt) : 'N/A'}</p></div>
              {note?.resolvedAt && <div><p className="text-sm text-gray-500">Resolved At</p><p className="font-semibold">{formatDate(note.resolvedAt)}</p></div>}
            </div>
          </Card>

          {canUpdate && (
            <Card>
              <h2 className="mb-4 text-lg font-semibold text-gray-900">Update Status</h2>
              <div className="space-y-3">
                <select className="w-full rounded border border-gray-300 px-3 py-2 text-sm" value={nextStatus} onChange={(event) => setNextStatus(event.target.value as PaymentNoteStatus)}>
                  {PAYMENT_NOTE_STATUSES.map((value) => <option key={value} value={value}>{value.replace('_', ' ')}</option>)}
                </select>
                <textarea
                  className="h-20 w-full rounded border border-gray-300 p-2 text-sm"
                  placeholder="Resolution notes (optional)"
                  value={resolutionNotes}
                  onChange={(event) => setResolutionNotes(event.target.value)}
                />
                <Button fullWidth isLoading={statusMutation.isPending} onClick={() => statusMutation.mutate()}>Update Status</Button>
              </div>
            </Card>
          )}

          {canUpdate && (
            <Card>
              <h2 className="mb-4 text-lg font-semibold text-gray-900">Assign</h2>
              <div className="space-y-3">
                <select className="w-full rounded border border-gray-300 px-3 py-2 text-sm" value={assignedToId} onChange={(event) => setAssignedToId(Number(event.target.value))}>
                  <option value={0}>Select user</option>
                  {users.data?.data?.content.map((user) => (
                    <option key={user.id} value={user.id}>{[user.firstName, user.lastName].filter(Boolean).join(' ') || user.userName}</option>
                  ))}
                </select>
                <Button fullWidth variant="secondary" isLoading={assignMutation.isPending} disabled={!assignedToId} onClick={() => assignMutation.mutate()}>Assign</Button>
              </div>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
};
