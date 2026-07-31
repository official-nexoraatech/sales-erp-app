import { useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { Eye, Pencil } from 'lucide-react';
import { crmAccountApi } from '../../api/endpoints.js';
import { useDebounce } from '../../hooks/useDebounce.js';
import { useUrlParams, toNumber } from '../../hooks/useUrlParam.js';
import { useAuthStore } from '../../store/auth.store.js';
import { PERMISSIONS } from '../../constants/permissions.js';
import ERPPageHeader from '../../components/erp/ERPPageHeader.js';
import ERPEmptyState from '../../components/erp/ERPEmptyState.js';
import ERPDataGrid, {
  type ERPColumnDef,
  type ERPRowAction,
} from '../../components/erp/ERPDataGrid.js';
import Button from '../../components/ui/Button.js';
import Badge from '../../components/ui/Badge.js';
import Input from '../../components/ui/Input.js';

const URL_DEFAULTS = { q: '', page: '1', size: '50' };

interface CrmAccount {
  id: number;
  name: string;
  accountType: string;
  primaryPhone?: string;
  primaryEmail?: string;
  gstin?: string;
  isImplicit: boolean;
}

export default function CrmAccountsPage() {
  const navigate = useNavigate();
  const hasPermission = useAuthStore((s) => s.hasPermission);
  const canCreate = hasPermission(PERMISSIONS.CRM_ACCOUNT_CREATE);
  const canUpdate = hasPermission(PERMISSIONS.CRM_ACCOUNT_UPDATE);
  const canImport = hasPermission(PERMISSIONS.CRM_ACCOUNT_IMPORT);
  const [urlState, setUrlState] = useUrlParams(URL_DEFAULTS);
  const [search, setSearch] = useState(urlState.q);
  const debouncedSearch = useDebounce(search, 250);
  const page = toNumber(urlState.page, 1);
  const pageSize = toNumber(urlState.size, 50);

  function setPage(p: number): void {
    setUrlState({ page: String(p) });
  }
  function setPageSize(s: number): void {
    setUrlState({ size: String(s), page: '1' });
  }

  const isFirstSearchRun = useRef(true);
  useEffect(() => {
    if (isFirstSearchRun.current) {
      isFirstSearchRun.current = false;
      return;
    }
    setUrlState({ q: debouncedSearch, page: '1' });
  }, [debouncedSearch]);

  const { data, isLoading, isError } = useQuery({
    queryKey: ['crm-accounts', debouncedSearch, page, pageSize],
    queryFn: () =>
      crmAccountApi.list({ search: debouncedSearch || undefined, page: page - 1, size: pageSize }),
  });

  const accounts: CrmAccount[] = ((data as Record<string, unknown>)?.content as CrmAccount[]) ?? [];
  const totalElements = ((data as Record<string, unknown>)?.totalElements as number) ?? 0;

  const columns: ERPColumnDef<CrmAccount>[] = [
    {
      key: 'name',
      header: 'Account',
      sortable: true,
      render: (r) => (
        <div>
          <button
            onClick={() => navigate(`/crm/accounts/${r.id}`)}
            className="font-medium text-link hover:underline"
          >
            {r.name}
          </button>
          {r.primaryPhone && <p className="text-xs text-secondary">{r.primaryPhone}</p>}
        </div>
      ),
    },
    {
      key: 'accountType',
      header: 'Type',
      render: (r) => <Badge variant="info">{r.accountType}</Badge>,
    },
    { key: 'gstin', header: 'GSTIN', mono: true },
    { key: 'primaryEmail', header: 'Email' },
  ];

  const rowActions: ERPRowAction<CrmAccount>[] = [
    { icon: Eye, label: 'View', type: 'view', onClick: (r) => navigate(`/crm/accounts/${r.id}`) },
    ...(canUpdate
      ? [
          {
            icon: Pencil,
            label: 'Edit',
            type: 'edit' as const,
            onClick: (r: CrmAccount) => navigate(`/crm/accounts/${r.id}/edit`),
          },
        ]
      : []),
  ];

  return (
    <div>
      <ERPPageHeader
        variant="list"
        title="Accounts"
        subtitle="B2B/wholesale accounts with multiple contacts, grouped separately from individual retail customers."
        actions={
          <>
            {canImport && (
              <Button variant="secondary" onClick={() => navigate('/crm/accounts/import')}>
                Import
              </Button>
            )}
            {canCreate && (
              <Button onClick={() => navigate('/crm/accounts/new')}>+ New Account</Button>
            )}
          </>
        }
      />

      <div className="flex gap-3 mb-4">
        <Input
          aria-label="Search accounts"
          placeholder="Search name, phone, GSTIN…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="max-w-xs"
        />
      </div>

      {isError ? (
        <ERPEmptyState type="error" />
      ) : (
        <ERPDataGrid
          columns={columns}
          data={accounts}
          isLoading={isLoading}
          rowKey="id"
          tableId="crm-accounts"
          pagination={{ page, pageSize, total: totalElements }}
          onPageChange={setPage}
          onPageSizeChange={setPageSize}
          actions={rowActions}
        />
      )}
    </div>
  );
}
