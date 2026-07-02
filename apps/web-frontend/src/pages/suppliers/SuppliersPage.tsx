import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import { supplierApi } from '../../api/endpoints.js';
import ERPPageHeader from '../../components/erp/ERPPageHeader.js';
import DataTable from '../../components/ui/DataTable.js';
import Button from '../../components/ui/Button.js';
import Badge from '../../components/ui/Badge.js';
import Input from '../../components/ui/Input.js';

interface Supplier { id: number; supplierCode: string; displayName: string; phone?: string; gstin?: string; status: string; }

export default function SuppliersPage() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [search, setSearch] = useState('');

  const { data, isLoading } = useQuery({
    queryKey: ['suppliers', search],
    queryFn: () => supplierApi.list({ search: search || undefined, page: 0, size: 50 }),
  });
  const suppliers: Supplier[] = ((data as Record<string, unknown>)?.data as Record<string, unknown>)?.content as Supplier[] ?? [];

  const deleteMutation = useMutation({
    mutationFn: (id: number) => supplierApi.delete(id),
    onSuccess: () => { toast.success('Supplier deleted'); qc.invalidateQueries({ queryKey: ['suppliers'] }); },
    onError: (err: Error) => toast.error(err.message),
  });

  const columns = [
    { key: 'supplierCode', header: 'Code', className: 'font-mono text-xs' },
    {
      key: 'displayName', header: 'Name',
      render: (r: Supplier) => (
        <div>
          <p className="font-medium">{r.displayName}</p>
          {r.phone && <p className="text-xs text-gray-400">{r.phone}</p>}
        </div>
      ),
    },
    { key: 'gstin', header: 'GSTIN', className: 'font-mono text-xs' },
    {
      key: 'status', header: 'Status',
      render: (r: Supplier) => <Badge label={r.status} color={r.status === 'ACTIVE' ? 'green' : 'gray'} />,
    },
    {
      key: 'actions', header: '',
      render: (r: Supplier) => (
        <div className="flex gap-2">
          <Button size="sm" variant="ghost" onClick={() => navigate(`/suppliers/${r.id}/edit`)}>Edit</Button>
          <Button size="sm" variant="danger" onClick={() => deleteMutation.mutate(r.id)}>Delete</Button>
        </div>
      ),
    },
  ];

  return (
    <div>
      <ERPPageHeader variant="list"
        title="Suppliers"
        subtitle="Manage your supplier / vendor database."
        actions={<Button onClick={() => navigate('/suppliers/new')}>+ New Supplier</Button>}
      />
      <div className="mb-4">
        <Input placeholder="Search suppliers…" value={search} onChange={(e) => setSearch(e.target.value)} className="max-w-xs" />
      </div>
      <DataTable columns={columns} data={suppliers} loading={isLoading} emptyMessage="No suppliers found." />
    </div>
  );
}
