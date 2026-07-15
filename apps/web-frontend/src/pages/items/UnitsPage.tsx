import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Pencil } from 'lucide-react';
import { unitApi } from '../../api/endpoints.js';
import { useAuthStore } from '../../store/auth.store.js';
import { PERMISSIONS } from '../../constants/permissions.js';
import ERPPageHeader from '../../components/erp/ERPPageHeader.js';
import ERPDataGrid, {
  type ERPColumnDef,
  type ERPRowAction,
} from '../../components/erp/ERPDataGrid.js';
import Button from '../../components/ui/Button.js';

interface Unit {
  id: number;
  name: string;
  abbreviation: string;
}

export default function UnitsPage() {
  const navigate = useNavigate();
  const hasPermission = useAuthStore((s) => s.hasPermission);
  const canCreateUnit = hasPermission(PERMISSIONS.UNIT_CREATE);
  const canUpdateUnit = hasPermission(PERMISSIONS.UNIT_UPDATE);
  const { data, isLoading } = useQuery({ queryKey: ['units'], queryFn: () => unitApi.list() });
  const units: Unit[] = (data as { content?: Unit[] })?.content ?? [];

  const columns: ERPColumnDef<Unit>[] = [
    { key: 'abbreviation', header: 'Symbol', mono: true, sortable: true },
    { key: 'name', header: 'Name', sortable: true },
  ];

  const rowActions: ERPRowAction<Unit>[] = [
    ...(canUpdateUnit
      ? [
          {
            label: 'Edit',
            icon: Pencil,
            type: 'edit' as const,
            onClick: (r: Unit) => navigate(`/inventory/units/${r.id}/edit`),
          },
        ]
      : []),
  ];

  return (
    <div>
      <ERPPageHeader
        variant="list"
        title="Units of Measure"
        actions={
          canCreateUnit ? (
            <Button onClick={() => navigate('/inventory/units/new')}>+ New Unit</Button>
          ) : undefined
        }
      />
      <ERPDataGrid
        columns={columns}
        data={units}
        isLoading={isLoading}
        rowKey="id"
        actions={rowActions}
      />
    </div>
  );
}
