import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import { customerApi } from '../../api/endpoints.js';
import ERPPageHeader from '../../components/erp/ERPPageHeader.js';
import DataTable from '../../components/ui/DataTable.js';
import Button from '../../components/ui/Button.js';
import Badge from '../../components/ui/Badge.js';
import Input from '../../components/ui/Input.js';
import Select from '../../components/ui/Select.js';

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
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const [customerType, setCustomerType] = useState('');

  const { data, isLoading } = useQuery({
    queryKey: ['customers', search, status, customerType],
    queryFn: () => customerApi.list({ search: search || undefined, status: status || undefined, customerType: customerType || undefined, page: 0, size: 50 }),
  });

  const customers: Customer[] = ((data as Record<string, unknown>)?.data as Record<string, unknown>)?.content as Customer[] ?? [];

  const deleteMutation = useMutation({
    mutationFn: (id: number) => customerApi.delete(id),
    onSuccess: () => { toast.success('Customer deactivated'); qc.invalidateQueries({ queryKey: ['customers'] }); },
    onError: (err: Error) => toast.error(err.message),
  });

  const columns = [
    { key: 'customerCode', header: 'Code', className: 'font-mono text-xs' },
    {
      key: 'displayName', header: 'Name',
      render: (r: Customer) => (
        <div>
          <button onClick={() => navigate(`/customers/${r.id}`)} className="font-medium text-indigo-600 dark:text-indigo-400 hover:underline">
            {r.displayName}
          </button>
          {r.phone && <p className="text-xs text-gray-400">{r.phone}</p>}
        </div>
      ),
    },
    { key: 'gstin', header: 'GSTIN', className: 'font-mono text-xs' },
    {
      key: 'customerType', header: 'Type',
      render: (r: Customer) => <Badge label={r.customerType} color="blue" />,
    },
    {
      key: 'status', header: 'Status',
      render: (r: Customer) => (
        <Badge label={r.status} color={r.status === 'ACTIVE' ? 'green' : r.status === 'BLOCKED' ? 'red' : 'gray'} />
      ),
    },
    { key: 'creditLimit', header: 'Credit Limit', className: 'text-right' },
    {
      key: 'actions', header: '',
      render: (r: Customer) => (
        <div className="flex gap-2">
          <Button size="sm" variant="ghost" onClick={() => navigate(`/customers/${r.id}`)}>View</Button>
          <Button size="sm" variant="ghost" onClick={() => navigate(`/customers/${r.id}/edit`)}>Edit</Button>
          <Button size="sm" variant="danger" onClick={() => deleteMutation.mutate(r.id)}>Delete</Button>
        </div>
      ),
    },
  ];

  return (
    <div>
      <ERPPageHeader variant="list"
        title="Customers"
        subtitle="Manage your customer database."
        actions={<Button onClick={() => navigate('/customers/new')}>+ New Customer</Button>}
      />

      <div className="flex gap-3 mb-4">
        <Input
          placeholder="Search name, phone, GSTIN…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="max-w-xs"
        />
        <Select value={status} onChange={(e) => setStatus(e.target.value)} className="w-36">
          <option value="">All Statuses</option>
          <option value="ACTIVE">Active</option>
          <option value="INACTIVE">Inactive</option>
          <option value="BLOCKED">Blocked</option>
        </Select>
        <Select value={customerType} onChange={(e) => setCustomerType(e.target.value)} className="w-40">
          <option value="">All Types</option>
          <option value="RETAIL">Retail</option>
          <option value="WHOLESALE">Wholesale</option>
          <option value="CORPORATE">Corporate</option>
        </Select>
      </div>

      <DataTable columns={columns} data={customers} loading={isLoading} emptyMessage="No customers found." />
    </div>
  );
}
