import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Eye } from 'lucide-react';
import { adminDemoRequestApi, type DemoRequest } from '../../api/endpoints.js';
import ERPPageHeader from '../../components/erp/ERPPageHeader.js';
import ERPDataGrid, {
  type ERPColumnDef,
  type ERPRowAction,
} from '../../components/erp/ERPDataGrid.js';
import Modal from '../../components/ui/Modal.js';
import Badge from '../../components/ui/Badge.js';

const SOURCE_LABEL: Record<DemoRequest['source'], string> = {
  HERO_FORM: 'Landing Page',
  CONTACT_PAGE: 'Contact Page',
};

export default function DemoRequestsPage() {
  const { data, isLoading } = useQuery({
    queryKey: ['admin-demo-requests'],
    queryFn: () => adminDemoRequestApi.list(),
  });
  const requests: DemoRequest[] = (data as { content?: DemoRequest[] })?.content ?? [];

  const [selected, setSelected] = useState<DemoRequest | null>(null);

  const columns: ERPColumnDef<DemoRequest>[] = [
    { key: 'fullName', header: 'Name', sortable: true },
    { key: 'email', header: 'Email' },
    { key: 'company', header: 'Company', render: (r) => r.company ?? '—' },
    {
      key: 'phone',
      header: 'Phone',
      render: (r) => (r.phone ? `${r.countryCode ?? ''} ${r.phone}` : '—'),
    },
    {
      key: 'source',
      header: 'Source',
      render: (r) => <Badge variant="default">{SOURCE_LABEL[r.source]}</Badge>,
    },
    {
      key: 'createdAt',
      header: 'Submitted',
      sortable: true,
      render: (r) => new Date(r.createdAt).toLocaleString(),
    },
  ];

  const rowActions: ERPRowAction<DemoRequest>[] = [
    { label: 'View', icon: Eye, onClick: (r: DemoRequest) => setSelected(r) },
  ];

  return (
    <div>
      <ERPPageHeader
        variant="list"
        title="Demo Requests"
        subtitle="Every 'Book a Demo' and 'Talk to Sales' submission from the public site."
      />
      <ERPDataGrid
        columns={columns}
        data={requests}
        isLoading={isLoading}
        rowKey="id"
        actions={rowActions}
      />

      <Modal
        open={!!selected}
        onClose={() => setSelected(null)}
        title={selected?.fullName ?? ''}
        size="sm"
      >
        {selected && (
          <dl className="space-y-3 text-sm">
            <div>
              <dt className="text-secondary">Email</dt>
              <dd className="text-primary">{selected.email}</dd>
            </div>
            <div>
              <dt className="text-secondary">Phone</dt>
              <dd className="text-primary">
                {selected.phone ? `${selected.countryCode ?? ''} ${selected.phone}` : '—'}
              </dd>
            </div>
            <div>
              <dt className="text-secondary">Company</dt>
              <dd className="text-primary">{selected.company ?? '—'}</dd>
            </div>
            <div>
              <dt className="text-secondary">City</dt>
              <dd className="text-primary">{selected.city ?? '—'}</dd>
            </div>
            <div>
              <dt className="text-secondary">Designation</dt>
              <dd className="text-primary">{selected.designation ?? '—'}</dd>
            </div>
            <div>
              <dt className="text-secondary">Product Type</dt>
              <dd className="text-primary">{selected.productType ?? '—'}</dd>
            </div>
            <div>
              <dt className="text-secondary">Message</dt>
              <dd className="text-primary whitespace-pre-wrap">{selected.message ?? '—'}</dd>
            </div>
          </dl>
        )}
      </Modal>
    </div>
  );
}
