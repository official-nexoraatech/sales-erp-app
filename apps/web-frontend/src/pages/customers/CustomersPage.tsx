import { useEffect, useRef, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import { Eye, Pencil, Trash2 } from 'lucide-react';
import { customerApi } from '../../api/endpoints.js';
import { useDebounce } from '../../hooks/useDebounce.js';
import { useUrlParams, toNumber } from '../../hooks/useUrlParam.js';
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
import { CUSTOMER_TYPES } from '../../schemas/customer.schema.js';

const URL_DEFAULTS = { q: '', status: '', type: '', page: '1', size: '50' };

interface Customer {
  id: number;
  customerCode: string;
  displayName: string;
  phone?: string;
  gstin?: string;
  customerType: string;
  status: string;
  creditLimit?: string;
  openingBalance?: string;
}

export default function CustomersPage() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const hasPermission = useAuthStore((s) => s.hasPermission);
  const canCreateCustomer = hasPermission(PERMISSIONS.CUSTOMER_CREATE);
  const canEditCustomer = hasPermission(PERMISSIONS.CUSTOMER_EDIT);
  const canDeleteCustomer = hasPermission(PERMISSIONS.CUSTOMER_DELETE);
  const [urlState, setUrlState] = useUrlParams(URL_DEFAULTS);
  const [search, setSearch] = useState(urlState.q);
  const debouncedSearch = useDebounce(search, 250);
  const status = urlState.status;
  const customerType = urlState.type;
  const page = toNumber(urlState.page, 1);
  const pageSize = toNumber(urlState.size, 50);

  function setStatus(v: string): void { setUrlState({ status: v, page: '1' }); }
  function setCustomerType(v: string): void { setUrlState({ type: v, page: '1' }); }
  function setPage(p: number): void { setUrlState({ page: String(p) }); }
  function setPageSize(s: number): void { setUrlState({ size: String(s), page: '1' }); }

  // Only the debounced value hits the URL — syncing on every keystroke would thrash
  // history/URL updates during typing (ERP-PLANNING/02_ERP_NAVIGATION_ARCHITECTURE.md §17).
  // Skips the reset on mount — otherwise a deep-linked/refreshed ?page=3 would immediately
  // snap back to 1, defeating the URL-restore this effect exists to support. status/type
  // reset the page inline in their own onChange handlers above (a single atomic
  // setUrlState call each) rather than reactively here, specifically to avoid two effects
  // racing to patch the same URL in the same tick — see useUrlParam.ts's doc comment.
  const isFirstSearchRun = useRef(true);
  useEffect(() => {
    if (isFirstSearchRun.current) { isFirstSearchRun.current = false; return; }
    setUrlState({ q: debouncedSearch, page: '1' });
  }, [debouncedSearch]);

  const { data, isLoading, isError } = useQuery({
    queryKey: ['customers', debouncedSearch, status, customerType, page, pageSize],
    queryFn: () => customerApi.list({ search: debouncedSearch || undefined, status: status || undefined, customerType: customerType || undefined, page: page - 1, size: pageSize }),
  });

  const customers: Customer[] = (data as Record<string, unknown>)?.content as Customer[] ?? [];
  const totalElements = (data as Record<string, unknown>)?.totalElements as number ?? 0;

  const deleteMutation = useMutation({
    mutationFn: (id: number) => customerApi.delete(id),
    onSuccess: () => { toast.success('Customer deactivated'); qc.invalidateQueries({ queryKey: ['customers'] }); },
    onError: (err: Error) => toast.error(err.message),
  });

  const columns: ERPColumnDef<Customer>[] = [
    { key: 'customerCode', header: 'Code', mono: true, sortable: true, hideable: false },
    {
      key: 'displayName', header: 'Name', sortable: true,
      render: (r) => (
        <div>
          <button onClick={() => navigate(`/customers/${r.id}`)} className="font-medium text-link hover:underline">
            {r.displayName}
          </button>
          {r.phone && <p className="text-xs text-secondary">{r.phone}</p>}
        </div>
      ),
    },
    { key: 'gstin', header: 'GSTIN', mono: true },
    {
      key: 'customerType', header: 'Type',
      render: (r) => <Badge variant="info">{r.customerType}</Badge>,
    },
    {
      key: 'status', header: 'Status', sortable: true,
      render: (r) => (
        <Badge variant={r.status === 'ACTIVE' ? 'success' : r.status === 'BLOCKED' ? 'danger' : 'default'}>{r.status}</Badge>
      ),
    },
    { key: 'creditLimit', header: 'Credit Limit', align: 'right' },
    {
      key: 'actions', header: '', align: 'right',
      render: (r) => {
        const items: ERPMenuItem[] = [{ label: 'View', icon: Eye, onClick: () => navigate(`/customers/${r.id}`) }];
        if (canEditCustomer) items.push({ label: 'Edit', icon: Pencil, onClick: () => navigate(`/customers/${r.id}/edit`) });
        if (canDeleteCustomer) items.push({ label: 'Delete', icon: Trash2, variant: 'danger', onClick: () => deleteMutation.mutate(r.id) });
        return <ERPDropdownMenu items={items} />;
      },
    },
  ];

  return (
    <div>
      <ERPPageHeader variant="list"
        title="Customers"
        subtitle="Manage your customer database."
        actions={canCreateCustomer ? <Button onClick={() => navigate('/customers/new')}>+ New Customer</Button> : undefined}
      />

      <div className="flex gap-3 mb-4">
        <Input
          aria-label="Search customers"
          placeholder="Search name, phone, GSTIN…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="max-w-xs"
        />
        <Select aria-label="Filter by status" value={status} onChange={(e) => setStatus(e.target.value)} className="w-36">
          <option value="">All Statuses</option>
          <option value="ACTIVE">Active</option>
          <option value="INACTIVE">Inactive</option>
          <option value="BLOCKED">Blocked</option>
        </Select>
        <Select aria-label="Filter by customer type" value={customerType} onChange={(e) => setCustomerType(e.target.value)} className="w-40">
          <option value="">All Types</option>
          {CUSTOMER_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
        </Select>
      </div>

      {isError ? (
        <ERPEmptyState type="error" />
      ) : (
        <ERPDataGrid
          columns={columns}
          data={customers}
          isLoading={isLoading}
          rowKey="id"
          tableId="customers"
          pagination={{ page, pageSize, total: totalElements }}
          onPageChange={setPage}
          onPageSizeChange={setPageSize}
        />
      )}
    </div>
  );
}
