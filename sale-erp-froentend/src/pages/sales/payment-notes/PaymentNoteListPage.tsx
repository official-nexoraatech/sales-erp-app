import React, { useState } from 'react';
import { Eye, Trash2 } from 'lucide-react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import { paymentNoteApi } from '../../../api/endpoints';
import { queryClient } from '../../../app/queryClient';
import { Button } from '../../../components/ui/Button';
import { Loader } from '../../../components/ui/Loader';
import { Pagination } from '../../../components/ui/Pagination';
import { PageHeader } from '../../../components/ui/PageHeader';
import { StatusBadge } from '../../../components/common/StatusBadge';
import { useAuth } from '../../../hooks/useAuth';
import { useConfirmation } from '../../../hooks/useConfirmation';
import { usePagination } from '../../../hooks/usePagination';
import { formatCurrency } from '../../../utils/formatCurrency';
import { formatDate } from '../../../utils/formatDate';
import { PERMISSIONS } from '../../../auth/permissions';
import { PAYMENT_NOTE_PRIORITIES, PAYMENT_NOTE_STATUSES, PAYMENT_NOTE_TYPES } from '../../../types/payment-note.types';

export const PaymentNoteListPage: React.FC = () => {
  const navigate = useNavigate();
  const { hasPermission } = useAuth();
  const canCreate = hasPermission(PERMISSIONS.PAYMENT_NOTE_CREATE);
  const canDelete = hasPermission(PERMISSIONS.PAYMENT_NOTE_DELETE);
  const { confirmAction, confirmationDialog } = useConfirmation();
  const { page, setPage, handlePageChange } = usePagination();
  const [pageSize, setPageSize] = useState(10);
  const [status, setStatus] = useState('');
  const [priority, setPriority] = useState('');
  const [noteType, setNoteType] = useState('');
  const [search, setSearch] = useState('');

  const paymentNotes = useQuery({
    queryKey: ['payment-notes', page, pageSize, status, priority, noteType, search],
    queryFn: () => paymentNoteApi.getAll({
      page,
      size: pageSize,
      search: search || undefined,
      status: status || undefined,
      priority: priority || undefined,
      noteType: noteType || undefined,
    }),
  });

  const rows = paymentNotes.data?.data?.content || [];

  const deletePaymentNote = useMutation({
    mutationFn: paymentNoteApi.delete,
    onSuccess: () => {
      toast.success('Payment note deleted');
      queryClient.invalidateQueries({ queryKey: ['payment-notes'] });
    },
    onError: (error: any) => toast.error(error?.message || 'Failed to delete payment note'),
  });

  return (
    <div className="space-y-5">
      <PageHeader
        title="Payment Notes"
        breadcrumb={<div className="text-sm text-gray-500">Home &gt; Sale &gt; Payment Notes</div>}
        actions={canCreate && <Button onClick={() => navigate('/sales/payment-notes/create')}>Create Payment Note</Button>}
      />
      <div className="overflow-hidden rounded-lg bg-white shadow">
        <div className="grid grid-cols-1 gap-x-4 gap-y-3 border-b p-5 md:grid-cols-2 xl:grid-cols-4">
          <label className="text-sm text-gray-600">Status
            <select className="mt-1 w-full rounded border px-3 py-2.5" value={status} onChange={(event) => { setStatus(event.target.value); setPage(0); }}>
              <option value="">All Statuses</option>
              {PAYMENT_NOTE_STATUSES.map((value) => <option key={value} value={value}>{value.replace('_', ' ')}</option>)}
            </select>
          </label>
          <label className="text-sm text-gray-600">Priority
            <select className="mt-1 w-full rounded border px-3 py-2.5" value={priority} onChange={(event) => { setPriority(event.target.value); setPage(0); }}>
              <option value="">All Priorities</option>
              {PAYMENT_NOTE_PRIORITIES.map((value) => <option key={value} value={value}>{value}</option>)}
            </select>
          </label>
          <label className="text-sm text-gray-600">Type
            <select className="mt-1 w-full rounded border px-3 py-2.5" value={noteType} onChange={(event) => { setNoteType(event.target.value); setPage(0); }}>
              <option value="">All Types</option>
              {PAYMENT_NOTE_TYPES.map((entry) => <option key={entry.value} value={entry.value}>{entry.label}</option>)}
            </select>
          </label>
          <label className="text-sm text-gray-600">Search
            <input className="mt-1 w-full rounded border px-3 py-2.5" value={search} onChange={(event) => { setSearch(event.target.value); setPage(0); }} placeholder="Note no. or subject" />
          </label>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-4">
          <label className="flex items-center gap-2 text-sm">Show
            <select value={pageSize} onChange={(event) => { setPageSize(Number(event.target.value)); setPage(0); }} className="rounded border px-2 py-2">
              <option>10</option><option>20</option><option>50</option><option>100</option>
            </select> entries
          </label>
        </div>

        <div className="overflow-x-auto px-3 pb-3">
          {paymentNotes.isLoading ? <div className="p-10"><Loader /></div> : <table className="w-full text-sm">
            <thead className="bg-gray-50">
              <tr>{['Note No.', 'Subject', 'Contact', 'Type', 'Amount', 'Priority', 'Status', 'Assigned To', 'Created', 'Action'].map((heading) => (
                <th key={heading} className="border-b p-3 text-left">{heading}</th>
              ))}</tr>
            </thead>
            <tbody>
              {rows.length ? rows.map((note) => (
                <tr key={note.paymentNoteId} className="border-b even:bg-gray-50">
                  <td className="p-3 font-semibold">{note.noteNo}</td>
                  <td className="p-3">{note.subject}</td>
                  <td className="p-3">{note.contactName}</td>
                  <td className="p-3">{note.noteType.replace('_', ' ')}</td>
                  <td className="p-3">{note.amount ? formatCurrency(note.amount) : 'N/A'}</td>
                  <td className="p-3">{note.priority}</td>
                  <td className="p-3"><StatusBadge status={note.status} /></td>
                  <td className="p-3">{note.assignedToName || 'Unassigned'}</td>
                  <td className="p-3">{formatDate(note.createdAt)}</td>
                  <td className="p-3">
                    <div className="flex items-center gap-2">
                      <button title="View payment note" onClick={() => navigate(`/sales/payment-notes/${note.paymentNoteId}`)} className="text-blue-600"><Eye size={17} /></button>
                      {canDelete && (
                        <button
                          title="Delete payment note"
                          onClick={async () => {
                            if (await confirmAction({ title: 'Delete Payment Note', message: 'Delete this payment note? This cannot be undone.', confirmText: 'Delete', variant: 'danger' })) {
                              deletePaymentNote.mutate(note.paymentNoteId);
                            }
                          }}
                          className="text-red-600"
                        >
                          <Trash2 size={17} />
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              )) : <tr><td colSpan={10} className="bg-gray-50 p-5 text-center text-gray-700">No payment notes available</td></tr>}
            </tbody>
          </table>}
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3 border-t px-5 py-4 text-sm text-gray-600">
          <span>Showing {rows.length ? page * pageSize + 1 : 0} to {page * pageSize + rows.length} of {paymentNotes.data?.data?.totalElements || 0} entries</span>
          <Pagination page={page} totalPages={paymentNotes.data?.data?.totalPages || 1} onPageChange={handlePageChange} />
        </div>
      </div>
      {confirmationDialog}
    </div>
  );
};
