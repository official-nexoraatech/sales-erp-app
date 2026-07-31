import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { priceListApi } from '../../api/endpoints.js';
import { useAuthStore } from '../../store/auth.store.js';
import { PERMISSIONS } from '../../constants/permissions.js';
import ERPPageHeader from '../../components/erp/ERPPageHeader.js';
import ERPDataGrid, { type ERPColumnDef } from '../../components/erp/ERPDataGrid.js';
import ERPEmptyState from '../../components/erp/ERPEmptyState.js';
import Button from '../../components/ui/Button.js';
import Badge from '../../components/ui/Badge.js';
import { formatDate } from '../../lib/format.js';

interface PriceList {
  id: number;
  name: string;
  code: string;
  currency: string;
  isDefault: boolean;
  validFrom?: string;
  validTo?: string;
}

export default function PriceListsPage() {
  const navigate = useNavigate();
  const canManagePriceList = useAuthStore((s) => s.hasPermission(PERMISSIONS.ITEM_EDIT));
  const { data, isLoading } = useQuery({
    queryKey: ['price-lists'],
    queryFn: () => priceListApi.list(),
  });
  const priceLists: PriceList[] = (data as { content?: PriceList[] })?.content ?? [];

  const columns: ERPColumnDef<PriceList>[] = [
    { key: 'code', header: 'Code', mono: true, sortable: true },
    { key: 'name', header: 'Name', sortable: true },
    { key: 'currency', header: 'Currency' },
    {
      key: 'validFrom',
      header: 'Valid From',
      render: (r) => (r.validFrom ? formatDate(r.validFrom) : '–'),
    },
    {
      key: 'validTo',
      header: 'Valid To',
      render: (r) => (r.validTo ? formatDate(r.validTo) : '–'),
    },
    {
      key: 'isDefault',
      header: 'Default',
      render: (r) => (r.isDefault ? <Badge variant="info">Default</Badge> : null),
    },
  ];

  return (
    <div>
      <ERPPageHeader
        variant="list"
        title="Price Lists"
        actions={
          canManagePriceList ? (
            <Button
              data-tour-id="inventory-price-lists-create-button"
              onClick={() => navigate('/inventory/price-lists/new')}
            >
              + New Price List
            </Button>
          ) : undefined
        }
      />
      <ERPDataGrid
        columns={columns}
        data={priceLists}
        isLoading={isLoading}
        rowKey="id"
        emptyState={
          <ERPEmptyState
            type="no-data"
            title="No price lists yet"
            description="Create a named price list record for a specific currency or validity window."
            {...(canManagePriceList
              ? {
                  action: {
                    label: '+ New Price List',
                    onClick: () => navigate('/inventory/price-lists/new'),
                  },
                }
              : {})}
          />
        }
      />
    </div>
  );
}
