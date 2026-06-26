import React, { useMemo, useState } from 'react';
import { MoreVertical } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import { PERMISSIONS } from '../../auth/permissions';
import { Button } from '../../components/ui/Button';
import { Pagination } from '../../components/ui/Pagination';
import { useAuth } from '../../hooks/useAuth';

interface TemplateRow {
  id: number;
  name: string;
  content: string;
  createdAt: string;
}

interface Props {
  type: 'sms' | 'email';
}

const smsRows: TemplateRow[] = [
  { id: 1, name: 'SALE RETURN', content: 'Dear [Customer Name], Your sale return details for [Invoice No] are updated.', createdAt: '30/07/2025' },
  { id: 2, name: 'SALE ORDER', content: 'Dear [Customer Name], Your sale order details for [Order No] are ready.', createdAt: '30/07/2025' },
  { id: 3, name: 'SALE INVOICE', content: 'Dear [Customer Name], Your invoice for [Invoice No] has been generated.', createdAt: '30/07/2025' },
  { id: 4, name: 'QUOTATION', content: 'Dear [Customer Name], Your Quotation details for [Quotation No] are ready.', createdAt: '30/07/2025' },
  { id: 5, name: 'PURCHASE RETURN', content: 'Dear [Supplier Name], Your purchase return details are updated.', createdAt: '30/07/2025' },
];

const emailRows: TemplateRow[] = [
  { id: 1, name: 'QUOTATION', content: 'Dear [Customer Name], Please find attached the details for your quotation.', createdAt: '30/07/2025' },
  { id: 2, name: 'PURCHASE RETURN', content: 'Dear [Supplier Name], Please find attached the details for purchase return.', createdAt: '30/07/2025' },
  { id: 3, name: 'PURCHASE ORDER', content: 'Dear [Supplier Name], Please find attached the purchase order details.', createdAt: '30/07/2025' },
  { id: 4, name: 'PURCHASE BILL', content: 'Dear [Supplier Name], Please find attached the bill details.', createdAt: '30/07/2025' },
  { id: 5, name: 'SALE RETURN', content: 'Dear [Customer Name], Please find attached the sale return details.', createdAt: '30/07/2025' },
];

const columns = ['Name', 'Content', 'Created at'];

export const MessageTemplateListPage: React.FC<Props> = ({ type }) => {
  const navigate = useNavigate();
  const { hasPermission } = useAuth();
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(10);
  const [search, setSearch] = useState('');
  const rows = useMemo(() => {
    const source = type === 'sms' ? smsRows : emailRows;
    const query = search.trim().toLowerCase();
    if (!query) return source;
    return source.filter((row) => `${row.name} ${row.content}`.toLowerCase().includes(query));
  }, [search, type]);
  const visibleRows = rows.slice(page * pageSize, page * pageSize + pageSize);
  const totalPages = Math.max(1, Math.ceil(rows.length / pageSize));
  const title = type === 'sms' ? 'SMS Templates' : 'Email Templates';
  const basePath = type === 'sms' ? '/sms/templates' : '/email/templates';
  const canCreate = hasPermission(type === 'sms' ? PERMISSIONS.SMS_TEMPLATE_CREATE : PERMISSIONS.EMAIL_TEMPLATE_CREATE);
  const canUpdate = hasPermission(type === 'sms' ? PERMISSIONS.SMS_TEMPLATE_UPDATE : PERMISSIONS.EMAIL_TEMPLATE_UPDATE);
  const canDelete = hasPermission(type === 'sms' ? PERMISSIONS.SMS_TEMPLATE_DELETE : PERMISSIONS.EMAIL_TEMPLATE_DELETE);
  const showActions = canUpdate || canDelete;
  const placeholder = () => toast(`${title} API is required for this action.`);

  const exportRows = () => rows.map((row) => [row.name, row.content, row.createdAt]);
  const copy = async () => {
    await navigator.clipboard.writeText([columns, ...exportRows()].map((row) => row.join('\t')).join('\n'));
    toast.success(`${title} copied`);
  };
  const download = (extension: 'csv' | 'xls') => {
    const separator = extension === 'csv' ? ',' : '\t';
    const content = [columns, ...exportRows()].map((row) => row.map((value) => `"${String(value).replaceAll('"', '""')}"`).join(separator)).join('\n');
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
    popup.document.write(`<html><head><title>${title}</title></head><body><h2>${title}</h2><table border="1" cellspacing="0" cellpadding="6"><thead><tr>${columns.map((column) => `<th>${column}</th>`).join('')}</tr></thead><tbody>${exportRows().map((row) => `<tr>${row.map((value) => `<td>${value}</td>`).join('')}</tr>`).join('')}</tbody></table><script>window.print()</script></body></html>`);
    popup.document.close();
  };

  return (
    <div className="space-y-5">
      <div className="text-sm text-gray-500">Home &gt; {type === 'sms' ? 'SMS' : 'Email'} &gt; {title}</div>
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
            <select value={pageSize} onChange={(event) => { setPageSize(Number(event.target.value)); setPage(0); }} className="h-9 rounded border border-gray-300 px-2">
              <option>10</option>
              <option>20</option>
              <option>50</option>
              <option>100</option>
            </select>
            entries
          </label>
          <div className="flex flex-wrap items-center">
            {canDelete && (
              <button type="button" onClick={placeholder} className="h-10 rounded-l border border-red-300 px-3 text-sm text-red-500">Delete</button>
            )}
            <button type="button" onClick={copy} className={`h-10 border px-3 text-sm ${canDelete ? 'border-l-0' : 'rounded-l'}`}>Copy</button>
            <button type="button" onClick={() => download('xls')} className="h-10 border-y border-r px-3 text-sm">Excel</button>
            <button type="button" onClick={() => download('csv')} className="h-10 border-y border-r px-3 text-sm">CSV</button>
            <button type="button" onClick={printPdf} className="h-10 rounded-r border-y border-r px-3 text-sm">PDF</button>
          </div>
          <label className="flex items-center gap-2 text-sm text-gray-600">
            Search:
            <input value={search} onChange={(event) => { setSearch(event.target.value); setPage(0); }} className="h-9 rounded border border-gray-300 px-3" />
          </label>
        </div>

        <div className="overflow-x-auto px-3 pb-3">
          <table className="w-full min-w-[820px] text-sm">
            <thead className="bg-gray-50">
              <tr>
                <th className="border p-3 text-left">Name</th>
                <th className="border p-3 text-left">Content</th>
                <th className="border p-3 text-left">Created at</th>
                {showActions && <th className="border p-3 text-left">Action</th>}
              </tr>
            </thead>
            <tbody>
              {visibleRows.map((row) => (
                <tr key={row.id} className="border-b even:bg-gray-50">
                  <td className="border p-3 font-medium">{row.name}</td>
                  <td className="border p-3">{row.content.length > 58 ? `${row.content.slice(0, 58)}...` : row.content}</td>
                  <td className="border p-3">{row.createdAt}</td>
                  {showActions && <td className="border p-3"><button type="button" onClick={placeholder} className="rounded p-1 hover:bg-gray-100"><MoreVertical size={18} /></button></td>}
                </tr>
              ))}
              {!visibleRows.length && <tr><td colSpan={3 + Number(showActions)} className="bg-gray-50 p-5 text-center">No data available in table</td></tr>}
            </tbody>
          </table>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3 border-t px-5 py-4 text-sm text-gray-600">
          <span>Showing {visibleRows.length ? page * pageSize + 1 : 0} to {page * pageSize + visibleRows.length} of {rows.length} entries</span>
          <Pagination page={page} totalPages={totalPages} onPageChange={setPage} />
        </div>
      </div>
    </div>
  );
};
