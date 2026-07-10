import { useEffect, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import { Pencil, Barcode, Trash2 } from 'lucide-react';
import { itemApi, categoryApi, brandApi } from '../../api/endpoints.js';
import { useDebounce } from '../../hooks/useDebounce.js';
import { useAuthStore } from '../../store/auth.store.js';
import { PERMISSIONS } from '../../constants/permissions.js';
import ERPPageHeader from '../../components/erp/ERPPageHeader.js';
import ERPEmptyState from '../../components/erp/ERPEmptyState.js';
import ERPDataGrid, { type ERPColumnDef } from '../../components/erp/ERPDataGrid.js';
import ERPDropdownMenu, { type ERPMenuItem } from '../../components/erp/ERPDropdownMenu.js';
import Button from '../../components/ui/Button.js';
import Badge from '../../components/ui/Badge.js';
import Input from '../../components/ui/Input.js';
import Select from '../../components/ui/Select.js';
import { formatCurrency } from '../../lib/format.js';

interface Item { id: number; itemCode: string; name: string; hsnCode?: string; gstRate?: string; salePrice?: string; status: string; categoryId?: number; brandId?: number; }
interface Category { id: number; name: string; }
interface Brand { id: number; name: string; }

export default function ItemsPage() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const hasPermission = useAuthStore((s) => s.hasPermission);
  const canCreateItem = hasPermission(PERMISSIONS.ITEM_CREATE);
  const canEditItem = hasPermission(PERMISSIONS.ITEM_EDIT);
  const canDeleteItem = hasPermission(PERMISSIONS.ITEM_DELETE);
  const [search, setSearch] = useState('');
  const debouncedSearch = useDebounce(search, 250);
  const [categoryId, setCategoryId] = useState('');
  const [status, setStatus] = useState('');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(50);

  useEffect(() => { setPage(1); }, [debouncedSearch, categoryId, status]);

  const { data, isLoading, isError } = useQuery({
    queryKey: ['items', debouncedSearch, categoryId, status, page, pageSize],
    queryFn: () => itemApi.list({ search: debouncedSearch || undefined, categoryId: categoryId ? Number(categoryId) : undefined, status: status || undefined, page: page - 1, size: pageSize }),
  });
  const { data: catData } = useQuery({ queryKey: ['categories'], queryFn: () => categoryApi.list(), enabled: hasPermission(PERMISSIONS.CATEGORY_VIEW) });
  const { data: brandData } = useQuery({ queryKey: ['brands'], queryFn: () => brandApi.list(), enabled: hasPermission(PERMISSIONS.BRAND_VIEW) });

  const items: Item[] = (data as Record<string, unknown>)?.content as Item[] ?? [];
  const totalElements = (data as Record<string, unknown>)?.totalElements as number ?? 0;
  const categories: Category[] = (catData as { content?: Category[] })?.content ?? [];
  const brands: Brand[] = (brandData as { content?: Brand[] })?.content ?? [];

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

  const columns: ERPColumnDef<Item>[] = [
    { key: 'itemCode', header: 'Code', mono: true, sortable: true, hideable: false },
    {
      key: 'name', header: 'Item Name', sortable: true,
      render: (r) => canEditItem ? (
        <button onClick={() => navigate(`/inventory/items/${r.id}/edit`)} className="font-medium text-link hover:underline text-left">
          {r.name}
        </button>
      ) : <span className="font-medium">{r.name}</span>,
    },
    {
      key: 'categoryId', header: 'Category',
      render: (r) => categories.find((c) => c.id === r.categoryId)?.name ?? '–',
    },
    {
      key: 'brandId', header: 'Brand',
      render: (r) => brands.find((b) => b.id === r.brandId)?.name ?? '–',
    },
    { key: 'hsnCode', header: 'HSN', mono: true },
    {
      key: 'gstRate', header: 'GST %', align: 'right',
      render: (r) => r.gstRate ? `${r.gstRate}%` : '–',
    },
    {
      key: 'salePrice', header: 'Sale Price', align: 'right', sortable: true,
      render: (r) => r.salePrice ? formatCurrency(parseFloat(r.salePrice)) : '–',
    },
    {
      key: 'status', header: 'Status', sortable: true,
      render: (r) => (
        <Badge variant={r.status === 'ACTIVE' ? 'success' : r.status === 'DISCONTINUED' ? 'danger' : 'default'}>{r.status}</Badge>
      ),
    },
    {
      key: 'actions', header: '', align: 'right',
      render: (r) => {
        const items: ERPMenuItem[] = [];
        if (canEditItem) items.push({ label: 'Edit', icon: Pencil, onClick: () => navigate(`/inventory/items/${r.id}/edit`) });
        if (canEditItem) items.push({ label: 'Generate Barcode', icon: Barcode, onClick: () => generateBarcodeMutation.mutate(r.id) });
        if (canDeleteItem) items.push({ label: 'Delete', icon: Trash2, variant: 'danger', onClick: () => deleteMutation.mutate(r.id) });
        return items.length > 0 ? <ERPDropdownMenu items={items} /> : null;
      },
    },
  ];

  return (
    <div>
      <ERPPageHeader variant="list"
        title="Item Master"
        subtitle="Manage your product catalog."
        actions={canCreateItem ? <Button onClick={() => navigate('/inventory/items/new')}>+ New Item</Button> : undefined}
      />

      <div className="flex gap-3 mb-4">
        <Input aria-label="Search items" placeholder="Search items…" value={search} onChange={(e) => setSearch(e.target.value)} className="max-w-xs" />
        <Select aria-label="Filter by category" value={categoryId} onChange={(e) => setCategoryId(e.target.value)} className="w-44">
          <option value="">All Categories</option>
          {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </Select>
        <Select aria-label="Filter by status" value={status} onChange={(e) => setStatus(e.target.value)} className="w-36">
          <option value="">All Statuses</option>
          <option value="ACTIVE">Active</option>
          <option value="INACTIVE">Inactive</option>
          <option value="DISCONTINUED">Discontinued</option>
        </Select>
      </div>

      {isError ? (
        <ERPEmptyState type="error" />
      ) : (
        <ERPDataGrid
          columns={columns}
          data={items}
          isLoading={isLoading}
          rowKey="id"
          tableId="items"
          pagination={{ page, pageSize, total: totalElements }}
          onPageChange={setPage}
          onPageSizeChange={(size) => { setPageSize(size); setPage(1); }}
        />
      )}
    </div>
  );
}
