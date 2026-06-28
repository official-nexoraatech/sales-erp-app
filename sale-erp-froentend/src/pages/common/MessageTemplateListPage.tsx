import React, { useMemo, useState } from 'react';
import { Edit, Trash2 } from 'lucide-react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import { PERMISSIONS } from '../../auth/permissions';
import { messageTemplateApi } from '../../api/endpoints';
import type { MessageTemplate } from '../../types/api.types';
import { queryClient } from '../../app/queryClient';
import { Button } from '../../components/ui/Button';
import { Loader } from '../../components/ui/Loader';
import { Pagination } from '../../components/ui/Pagination';
import { TableExportButtons } from '../../components/common/TableExportButtons';
import { useAuth } from '../../hooks/useAuth';
import { useConfirmation } from '../../hooks/useConfirmation';
import { useDebounce } from '../../hooks/useDebounce';
import { formatDate } from '../../utils/formatDate';

interface Props {
  type: 'sms' | 'email';
}

const truncate = (value: string, maxLength = 72) => {
  if (value.length <= maxLength) return value;
  return `${value.slice(0, maxLength)}...`;
};

const escapeHtml = (value: unknown) =>
  String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');

export const MessageTemplateListPage: React.FC<Props> = ({ type }) => {
  const navigate = useNavigate();
  const { hasPermission } = useAuth();
  const { confirmAction, confirmationDialog } = useConfirmation();
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(10);
  const [search, setSearch] = useState('');
  const [selectedIds, setSelectedIds] = useState<number[]>([]);
  const debouncedSearch = useDebounce(search);

  const isSms = type === 'sms';
  const title = isSms ? 'SMS Templates' : 'Email Templates';
  const singular = isSms ? 'SMS template' : 'Email template';
  const basePath = isSms ? '/sms/templates' : '/email/templates';
  const queryKey = ['message-template', type, page, pageSize, debouncedSearch];
  const exportColumns = isSms
    ? ['Name', 'Content', 'Status', 'Created at']
    : ['Name', 'Subject', 'Content', 'Status', 'Created at'];

  const canCreate = hasPermission(isSms ? PERMISSIONS.SMS_TEMPLATE_CREATE : PERMISSIONS.EMAIL_TEMPLATE_CREATE);
  const canUpdate = hasPermission(isSms ? PERMISSIONS.SMS_TEMPLATE_UPDATE : PERMISSIONS.EMAIL_TEMPLATE_UPDATE);
  const canDelete = hasPermission(isSms ? PERMISSIONS.SMS_TEMPLATE_DELETE : PERMISSIONS.EMAIL_TEMPLATE_DELETE);
  const showActions = canUpdate || canDelete;

  const records = useQuery({
    queryKey,
    queryFn: () => messageTemplateApi.getAll(type, { page, size: pageSize, search: debouncedSearch }),
  });

  const remove = useMutation({
    mutationFn: (id: number) => messageTemplateApi.delete(type, id),
    onSuccess: async () => {
      toast.success(`${singular} deleted`);
      await queryClient.invalidateQueries({ queryKey: ['message-template', type] });
    },
    onError: (error: any) => toast.error(error?.message || `Failed to delete ${singular.toLowerCase()}`),
  });

  const rows = records.data?.data?.content || [];
  const allSelected = rows.length > 0 && rows.every((row) => selectedIds.includes(row.id));

  const exportRows = useMemo(
    () => rows.map((row) => isSms
      ? [row.name, row.content, row.status || '', row.createdAt ? formatDate(row.createdAt) : '']
      : [row.name, row.subject || '', row.content, row.status || '', row.createdAt ? formatDate(row.createdAt) : '']
    ),
    [isSms, rows]
  );

  const copy = async () => {
    await navigator.clipboard.writeText([exportColumns, ...exportRows].map((row) => row.join('\t')).join('\n'));
    toast.success(`${title} copied`);
  };

  const download = (extension: 'csv' | 'xls') => {
    const separator = extension === 'csv' ? ',' : '\t';
    const content = [exportColumns, ...exportRows]
      .map((row) => row.map((value) => `"${String(value).replaceAll('"', '""')}"`).join(separator))
      .join('\n');
    const blob = new Blob([content], { type: extension === 'csv' ? 'text/csv' : 'application/vnd.ms-excel' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${type}-templates.${extension}`;
    link.click();
    URL.revokeObjectURL(url);
  };

  const printPdf = () => {
    const popup = window.open('', '_blank');
    if (!popup) return;
    const head = exportColumns.map((column) => `<th>${escapeHtml(column)}</th>`).join('');
    const body = exportRows
      .map((row) => `<tr>${row.map((value) => `<td>${escapeHtml(value)}</td>`).join('')}</tr>`)
      .join('');
    popup.document.write(`<html><head><title>${escapeHtml(title)}</title></head><body><h2>${escapeHtml(title)}</h2><table border="1" cellspacing="0" cellpadding="6"><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table><script>window.print()</script></body></html>`);
    popup.document.close();
  };

  const deleteTemplate = async (row: MessageTemplate) => {
    const confirmed = await confirmAction({
      title: `Delete ${singular}`,
      message: `Delete "${row.name}"?`,
      confirmText: 'Delete',
      variant: 'danger',
    });
    if (confirmed) remove.mutate(row.id);
  };

  const deleteSelected = async () => {
    if (!selectedIds.length) return toast.error(`Select at least one ${singular.toLowerCase()}`);
    const confirmed = await confirmAction({
      title: `Delete ${title}`,
      message: `Delete ${selectedIds.length} selected template${selectedIds.length === 1 ? '' : 's'}?`,
      confirmText: 'Delete',
      variant: 'danger',
    });
    if (!confirmed) return;
    for (const id of selectedIds) {
      await remove.mutateAsync(id);
    }
    setSelectedIds([]);
  };

  const handlePageSizeChange = (nextPageSize: number) => {
    setPageSize(nextPageSize);
    setPage(0);
    setSelectedIds([]);
  };

  const totalPages = records.data?.data?.totalPages || 1;
  const totalElements = records.data?.data?.totalElements || 0;

  return (
    <div className="space-y-5">
      <div className="text-sm text-gray-500">Home &gt; {isSms ? 'SMS' : 'Email'} &gt; {title}</div>
      <div className="overflow-hidden rounded-lg bg-white shadow">
        <div className="flex items-center justify-between border-b px-5 py-4">
          <h1 className="text-xl font-semibold uppercase text-gray-900">{title}</h1>
          {canCreate && (
            <Button onClick={() => navigate(`${basePath}/create`)} className="min-w-[190px]">Create Template</Button>
          )}
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3 p-5">
          <label className="flex items-center gap-2 text-sm text-gray-600">
            Show
            <select value={pageSize} onChange={(event) => handlePageSizeChange(Number(event.target.value))} className="h-9 rounded border border-gray-300 px-2">
              <option>10</option>
              <option>20</option>
              <option>50</option>
              <option>100</option>
            </select>
            entries
          </label>
          <TableExportButtons
            onCopy={copy}
            onDownloadExcel={() => download('xls')}
            onDownloadCsv={() => download('csv')}
            onPrint={printPdf}
            onRefresh={() => records.refetch()}
            leadingButton={canDelete && <button type="button" onClick={deleteSelected} disabled={remove.isPending} className="h-10 rounded-l border border-red-300 px-3 text-sm text-red-500 transition-all active:scale-95 active:bg-red-50 disabled:cursor-not-allowed disabled:opacity-50">Delete</button>}
          />
          <label className="flex items-center gap-2 text-sm text-gray-600">
            Search:
            <input value={search} onChange={(event) => { setSearch(event.target.value); setPage(0); setSelectedIds([]); }} className="h-9 rounded border border-gray-300 px-3" />
          </label>
        </div>

        {records.isError && (
          <div className="mx-5 mb-4 rounded border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
            Failed to load {title.toLowerCase()}.
          </div>
        )}

        <div className="overflow-x-auto px-3 pb-3">
          {records.isLoading ? (
            <div className="p-10"><Loader /></div>
          ) : (
            <table className="w-full min-w-[820px] text-sm">
              <thead className="bg-gray-50">
                <tr>
                  {canDelete && (
                    <th className="border p-3">
                      <input type="checkbox" checked={allSelected} onChange={() => setSelectedIds(allSelected ? [] : rows.map((row) => row.id))} />
                    </th>
                  )}
                  {exportColumns.map((heading) => <th key={heading} className="border p-3 text-left">{heading}</th>)}
                  {showActions && <th className="border p-3 text-left">Action</th>}
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.id} className="border-b even:bg-gray-50">
                    {canDelete && (
                      <td className="border p-3">
                        <input
                          type="checkbox"
                          checked={selectedIds.includes(row.id)}
                          onChange={() => setSelectedIds((current) => current.includes(row.id) ? current.filter((id) => id !== row.id) : [...current, row.id])}
                        />
                      </td>
                    )}
                    <td className="border p-3 font-medium">{row.name}</td>
                    {!isSms && <td className="border p-3">{row.subject || ''}</td>}
                    <td className="border p-3">{truncate(row.content || '')}</td>
                    <td className="border p-3">{row.status || ''}</td>
                    <td className="border p-3">{row.createdAt ? formatDate(row.createdAt) : ''}</td>
                    {showActions && (
                      <td className="border p-3">
                        <div className="flex gap-2">
                          {canUpdate && (
                            <button type="button" onClick={() => navigate(`${basePath}/${row.id}/edit`, { state: row })} className="text-orange-600" title="Edit template">
                              <Edit size={16} />
                            </button>
                          )}
                          {canDelete && (
                            <button type="button" onClick={() => deleteTemplate(row)} className="text-red-600" title="Delete template">
                              <Trash2 size={16} />
                            </button>
                          )}
                        </div>
                      </td>
                    )}
                  </tr>
                ))}
                {!rows.length && <tr><td colSpan={exportColumns.length + Number(canDelete) + Number(showActions)} className="bg-gray-50 p-5 text-center">No data available in table</td></tr>}
              </tbody>
            </table>
          )}
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3 border-t px-5 py-4 text-sm text-gray-600">
          <span>Showing {rows.length ? page * pageSize + 1 : 0} to {page * pageSize + rows.length} of {totalElements} entries</span>
          <Pagination page={page} totalPages={totalPages} onPageChange={(nextPage) => { setPage(nextPage); setSelectedIds([]); }} />
        </div>
      </div>
      {confirmationDialog}
    </div>
  );
};
