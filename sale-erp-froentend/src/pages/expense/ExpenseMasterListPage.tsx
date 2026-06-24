import React, { useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Edit, Eye, Trash2 } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import {
  expenseCategoryApi,
  expenseSubCategoryApi,
  paymentMethodApi,
  type ExpenseCategory,
  type ExpenseSubCategory,
  type PaymentMethod,
} from '../../api/endpoints';
import { queryClient } from '../../app/queryClient';
import { Button } from '../../components/ui/Button';
import { Loader } from '../../components/ui/Loader';
import { Pagination } from '../../components/ui/Pagination';
import { useConfirmation } from '../../hooks/useConfirmation';
import { useDebounce } from '../../hooks/useDebounce';

interface Props {
  type: 'category' | 'subcategory' | 'paymentMethod';
}

type ExpenseMaster = ExpenseCategory | ExpenseSubCategory | PaymentMethod;

const isSubCategory = (record: ExpenseMaster): record is ExpenseSubCategory =>
  'expenseCategoryId' in record;

const escapeHtml = (value: unknown) => String(value)
  .replaceAll('&', '&amp;')
  .replaceAll('<', '&lt;')
  .replaceAll('>', '&gt;')
  .replaceAll('"', '&quot;')
  .replaceAll("'", '&#039;');

export const ExpenseMasterListPage: React.FC<Props> = ({ type }) => {
  const categoryMode = type === 'category';
  const subCategoryMode = type === 'subcategory';
  const label = categoryMode
    ? 'Expense Category'
    : subCategoryMode
      ? 'Expense Subcategory'
      : 'Payment Type';
  const basePath = categoryMode
    ? '/expenses/categories'
    : subCategoryMode
      ? '/expenses/subcategories'
      : '/expenses/payment-types';
  const queryKey = categoryMode
    ? 'expense-categories'
    : subCategoryMode
      ? 'expense-subcategories'
      : 'payment-methods';
  const navigate = useNavigate();
  const { confirmAction, confirmationDialog } = useConfirmation();
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(10);
  const [search, setSearch] = useState('');
  const [selectedIds, setSelectedIds] = useState<number[]>([]);
  const debouncedSearch = useDebounce(search);

  const records = useQuery({
    queryKey: [queryKey, debouncedSearch],
    queryFn: () => {
      if (categoryMode) return expenseCategoryApi.getAll(debouncedSearch);
      if (subCategoryMode) return expenseSubCategoryApi.getAll(debouncedSearch);
      return paymentMethodApi.getAll(debouncedSearch);
    },
    refetchOnMount: 'always',
  });

  const remove = useMutation({
    mutationFn: (id: number) => {
      if (categoryMode) return expenseCategoryApi.delete(id);
      if (subCategoryMode) return expenseSubCategoryApi.delete(id);
      return paymentMethodApi.delete(id);
    },
    onSuccess: () => {
      toast.success(`${label} deleted successfully`);
      queryClient.invalidateQueries({ queryKey: [queryKey] });
    },
  });

  const allRows = (records.data?.data?.content || []) as ExpenseMaster[];
  const totalPages = Math.max(1, Math.ceil(allRows.length / pageSize));
  const safePage = Math.min(page, totalPages - 1);
  const rows = allRows.slice(safePage * pageSize, safePage * pageSize + pageSize);
  const allSelected = rows.length > 0 && rows.every((row) => selectedIds.includes(row.id));
  const exportColumns = subCategoryMode
    ? ['Expense Category', 'Name', 'Description', 'Status']
    : ['Name', 'Description', 'Status'];
  const exportRows = () => allRows.map((row) => subCategoryMode
    ? [isSubCategory(row) ? row.expenseCategoryName || '' : '', row.name, row.description || '', row.status]
    : [row.name, row.description || '', row.status]);

  const copy = async () => {
    await navigator.clipboard.writeText(
      [exportColumns, ...exportRows()].map((row) => row.join('\t')).join('\n'),
    );
    toast.success(`${label} list copied`);
  };

  const download = (extension: 'csv' | 'xls') => {
    const separator = extension === 'csv' ? ',' : '\t';
    const content = [exportColumns, ...exportRows()]
      .map((row) => row.map((value) => `"${String(value).replaceAll('"', '""')}"`).join(separator))
      .join('\n');
    const blob = new Blob(
      [content],
      { type: extension === 'csv' ? 'text/csv' : 'application/vnd.ms-excel' },
    );
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${queryKey}.${extension}`;
    link.click();
    URL.revokeObjectURL(url);
  };

  const printPdf = () => {
    const popup = window.open('', '_blank');
    if (!popup) return;
    const headingHtml = exportColumns.map((column) => `<th>${escapeHtml(column)}</th>`).join('');
    const rowHtml = exportRows()
      .map((row) => `<tr>${row.map((value) => `<td>${escapeHtml(value)}</td>`).join('')}</tr>`)
      .join('');
    popup.document.write(`<html><head><title>${escapeHtml(label)} List</title></head><body><h2>${escapeHtml(label)} List</h2><table border="1" cellspacing="0" cellpadding="6"><thead><tr>${headingHtml}</tr></thead><tbody>${rowHtml}</tbody></table><script>window.print()</script></body></html>`);
    popup.document.close();
  };

  const deleteSelected = async () => {
    if (!selectedIds.length) {
      toast.error(`Select at least one ${label.toLowerCase()}`);
      return;
    }
    const confirmed = await confirmAction({ title: `Delete ${label}s`, message: `Delete selected ${label.toLowerCase()} records?`, confirmText: 'Delete', variant: 'danger' });
    if (!confirmed) return;
    for (const id of selectedIds) {
      await remove.mutateAsync(id);
    }
    setSelectedIds([]);
  };

  return (
    <div className="space-y-5">
      <div className="text-sm text-gray-500">Home &gt; Expense &gt; {label} List</div>
      <div className="overflow-hidden rounded-lg bg-white shadow">
        <div className="flex items-center justify-between border-b px-5 py-4">
          <h1 className="text-xl font-semibold uppercase text-gray-900">{label} List</h1>
          <Button onClick={() => navigate(`${basePath}/create`)} className="min-w-[210px]">
            Create {label}
          </Button>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3 p-5">
          <label className="flex items-center gap-2 text-sm text-gray-600">
            Show
            <select
              value={pageSize}
              onChange={(event) => {
                setPageSize(Number(event.target.value));
                setPage(0);
              }}
              className="h-9 rounded border border-gray-300 px-2"
            >
              <option>10</option>
              <option>20</option>
              <option>50</option>
              <option>100</option>
            </select>
            entries
          </label>

          <div className="flex flex-wrap items-center">
            <button onClick={deleteSelected} className="h-10 rounded-l border border-red-300 px-3 text-sm text-red-500">Delete</button>
            <button onClick={copy} className="h-10 border-y border-r px-3 text-sm">Copy</button>
            <button onClick={() => download('xls')} className="h-10 border-y border-r px-3 text-sm">Excel</button>
            <button onClick={() => download('csv')} className="h-10 border-y border-r px-3 text-sm">CSV</button>
            <button onClick={printPdf} className="h-10 rounded-r border-y border-r px-3 text-sm">PDF</button>
          </div>

          <label className="flex items-center gap-2 text-sm text-gray-600">
            Search:
            <input
              value={search}
              onChange={(event) => {
                setSearch(event.target.value);
                setPage(0);
              }}
              className="h-9 rounded border border-gray-300 px-3"
            />
          </label>
        </div>

        <div className="overflow-x-auto px-3 pb-3">
          {records.isLoading ? (
            <div className="p-10"><Loader /></div>
          ) : (
            <table className="w-full text-sm">
              <thead className="bg-gray-50">
                <tr>
                  <th className="border p-3">
                    <input
                      type="checkbox"
                      checked={allSelected}
                      onChange={() => setSelectedIds(
                        allSelected
                          ? selectedIds.filter((id) => !rows.some((row) => row.id === id))
                          : Array.from(new Set([...selectedIds, ...rows.map((row) => row.id)])),
                      )}
                    />
                  </th>
                  {exportColumns.concat('Action').map((heading) => (
                    <th key={heading} className="border p-3 text-left">{heading}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.length ? rows.map((row) => (
                  <tr key={row.id} className="border-b even:bg-gray-50">
                    <td className="border p-3">
                      <input
                        type="checkbox"
                        checked={selectedIds.includes(row.id)}
                        onChange={() => setSelectedIds((current) => current.includes(row.id)
                          ? current.filter((id) => id !== row.id)
                          : [...current, row.id])}
                      />
                    </td>
                    {subCategoryMode && (
                      <td className="border p-3">
                        {isSubCategory(row) ? row.expenseCategoryName || 'N/A' : 'N/A'}
                      </td>
                    )}
                    <td className="border p-3 font-semibold">{row.name}</td>
                    <td className="border p-3">{row.description || ''}</td>
                    <td className="border p-3">
                      <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${
                        row.status === 'ACTIVE'
                          ? 'bg-green-100 text-green-700'
                          : 'bg-gray-100 text-gray-600'
                      }`}
                      >
                        {row.status}
                      </span>
                    </td>
                    <td className="border p-3">
                      <div className="flex gap-2">
                        <button
                          title={`View ${label}`}
                          onClick={() => navigate(`${basePath}/${row.id}`)}
                          className="text-blue-600"
                        >
                          <Eye size={16} />
                        </button>
                        <button
                          title={`Edit ${label}`}
                          onClick={() => navigate(`${basePath}/${row.id}/edit`)}
                          className="text-orange-600"
                        >
                          <Edit size={16} />
                        </button>
                        <button
                          title={`Delete ${label}`}
                          onClick={async () => {
                            const confirmed = await confirmAction({ title: `Delete ${label}`, message: `Delete this ${label.toLowerCase()}?`, confirmText: 'Delete', variant: 'danger' });
                            if (confirmed) remove.mutate(row.id);
                          }}
                          className="text-red-600"
                        >
                          <Trash2 size={16} />
                        </button>
                      </div>
                    </td>
                  </tr>
                )) : (
                  <tr>
                    <td colSpan={exportColumns.length + 2} className="bg-gray-50 p-5 text-center">
                      No data available in table
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          )}
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3 border-t px-5 py-4 text-sm text-gray-600">
          <span>
            Showing {rows.length ? safePage * pageSize + 1 : 0} to {safePage * pageSize + rows.length} of {allRows.length} entries
          </span>
          <Pagination page={safePage} totalPages={totalPages} onPageChange={setPage} />
        </div>
      </div>
      {confirmationDialog}
    </div>
  );
};
