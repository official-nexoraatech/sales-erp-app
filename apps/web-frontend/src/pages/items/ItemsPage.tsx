import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import { itemApi, categoryApi, brandApi } from '../../api/endpoints.js';
import ERPPageHeader from '../../components/erp/ERPPageHeader.js';
import DataTable from '../../components/ui/DataTable.js';
import Button from '../../components/ui/Button.js';
import Badge from '../../components/ui/Badge.js';
import Input from '../../components/ui/Input.js';
import Select from '../../components/ui/Select.js';
import { formatDate, formatDatetime, formatCurrency } from '../../lib/format.js';

interface Item { id: number; itemCode: string; name: string; hsnCode?: string; gstRate?: string; salePrice?: string; status: string; categoryId?: number; brandId?: number; }
interface Category { id: number; name: string; }
interface Brand { id: number; name: string; }

export default function ItemsPage() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [search, setSearch] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [status, setStatus] = useState('');

  const { data, isLoading } = useQuery({
    queryKey: ['items', search, categoryId, status],
    queryFn: () => itemApi.list({ search: search || undefined, categoryId: categoryId ? Number(categoryId) : undefined, status: status || undefined, page: 0, size: 50 }),
  });
  const { data: catData } = useQuery({ queryKey: ['categories'], queryFn: () => categoryApi.list() });
  const { data: brandData } = useQuery({ queryKey: ['brands'], queryFn: () => brandApi.list() });

  const items: Item[] = ((data as Record<string, unknown>)?.data as Record<string, unknown>)?.content as Item[] ?? [];
  const categories: Category[] = (catData as { data?: { content?: Category[] } })?.data?.content ?? [];
  const brands: Brand[] = (brandData as { data?: { content?: Brand[] } })?.data?.content ?? [];

  const deleteMutation = useMutation({
    mutationFn: (id: number) => itemApi.delete(id),
    onSuccess: () => { toast.success('Item discontinued'); qc.invalidateQueries({ queryKey: ['items'] }); },
    onError: (err: Error) => toast.error(err.message),
  });

  const generateBarcodeMutation = useMutation({
    mutationFn: (id: number) => itemApi.generateBarcode(id),
    onSuccess: (res) => toast.success(`Barcode: ${(res as Record<string, unknown>)?.barcode}`),
    onError: (err: Error) => toast.error(err.message),
  });

  const columns = [
    { key: 'itemCode', header: 'Code', className: 'font-mono text-xs' },
    {
      key: 'name', header: 'Item Name',
      render: (r: Item) => (
        <button onClick={() => navigate(`/inventory/items/${r.id}/edit`)} className="font-medium text-indigo-600 dark:text-indigo-400 hover:underline text-left">
          {r.name}
        </button>
      ),
    },
    {
      key: 'categoryId', header: 'Category',
      render: (r: Item) => categories.find((c) => c.id === r.categoryId)?.name ?? '–',
    },
    {
      key: 'brandId', header: 'Brand',
      render: (r: Item) => brands.find((b) => b.id === r.brandId)?.name ?? '–',
    },
    { key: 'hsnCode', header: 'HSN', className: 'font-mono text-xs' },
    {
      key: 'gstRate', header: 'GST %',
      render: (r: Item) => r.gstRate ? `${r.gstRate}%` : '–',
    },
    {
      key: 'salePrice', header: 'Sale Price',
      render: (r: Item) => r.salePrice ? formatCurrency(parseFloat(r.salePrice)) : '–',
    },
    {
      key: 'status', header: 'Status',
      render: (r: Item) => (
        <Badge label={r.status} color={r.status === 'ACTIVE' ? 'green' : r.status === 'DISCONTINUED' ? 'red' : 'gray'} />
      ),
    },
    {
      key: 'actions', header: '',
      render: (r: Item) => (
        <div className="flex gap-1">
          <Button size="sm" variant="ghost" onClick={() => navigate(`/inventory/items/${r.id}/edit`)}>Edit</Button>
          <Button size="sm" variant="secondary" onClick={() => generateBarcodeMutation.mutate(r.id)}>Barcode</Button>
          <Button size="sm" variant="danger" onClick={() => deleteMutation.mutate(r.id)}>Delete</Button>
        </div>
      ),
    },
  ];

  return (
    <div>
      <ERPPageHeader variant="list"
        title="Item Master"
        subtitle="Manage your product catalog."
        actions={<Button onClick={() => navigate('/inventory/items/new')}>+ New Item</Button>}
      />

      <div className="flex gap-3 mb-4">
        <Input placeholder="Search items…" value={search} onChange={(e) => setSearch(e.target.value)} className="max-w-xs" />
        <Select value={categoryId} onChange={(e) => setCategoryId(e.target.value)} className="w-44">
          <option value="">All Categories</option>
          {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </Select>
        <Select value={status} onChange={(e) => setStatus(e.target.value)} className="w-36">
          <option value="">All Statuses</option>
          <option value="ACTIVE">Active</option>
          <option value="INACTIVE">Inactive</option>
          <option value="DISCONTINUED">Discontinued</option>
        </Select>
      </div>

      <DataTable columns={columns} data={items} loading={isLoading} emptyMessage="No items found." />
    </div>
  );
}
