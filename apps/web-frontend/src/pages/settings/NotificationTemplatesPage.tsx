import { useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { Pencil, Trash2 } from 'lucide-react';
import { notificationTemplatesApi, type NotificationTemplate } from '../../api/endpoints.js';
import { useConfirm } from '../../context/ConfirmContext.js';
import ERPPageHeader from '../../components/erp/ERPPageHeader.js';
import ERPDataGrid, {
  type ERPColumnDef,
  type ERPRowAction,
} from '../../components/erp/ERPDataGrid.js';
import ERPEmptyState from '../../components/erp/ERPEmptyState.js';
import Button from '../../components/ui/Button.js';
import Badge from '../../components/ui/Badge.js';

const LIST_PATH = '/settings/notification-templates';

export default function NotificationTemplatesPage() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const confirm = useConfirm();

  const { data, isLoading } = useQuery({
    queryKey: ['notification-templates'],
    queryFn: () => notificationTemplatesApi.list(),
  });
  const templates: NotificationTemplate[] =
    (data as { content?: NotificationTemplate[] })?.content ?? [];

  const deleteMutation = useMutation({
    mutationFn: (id: number) => notificationTemplatesApi.remove(id),
    onSuccess: () => {
      toast.success('Template deleted');
      void qc.invalidateQueries({ queryKey: ['notification-templates'] });
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const columns: ERPColumnDef<NotificationTemplate>[] = [
    { key: 'name', header: 'Name', sortable: true },
    { key: 'eventType', header: 'Event Type', mono: true },
    { key: 'channel', header: 'Channel' },
    {
      key: 'isSystem',
      header: 'Type',
      render: (r) =>
        r.isSystem ? <Badge variant="info">System</Badge> : <Badge variant="default">Custom</Badge>,
    },
    {
      key: 'isActive',
      header: 'Status',
      render: (r) => (
        <Badge variant={r.isActive ? 'success' : 'default'}>
          {r.isActive ? 'Active' : 'Inactive'}
        </Badge>
      ),
    },
  ];

  const rowActions: ERPRowAction<NotificationTemplate>[] = [
    {
      label: 'Edit',
      icon: Pencil,
      type: 'edit',
      onClick: (r) => navigate(`${LIST_PATH}/${r.id}/edit`),
      hidden: (r) => r.isSystem,
    },
    {
      label: 'Delete',
      icon: Trash2,
      type: 'delete',
      onClick: async (r) => {
        const ok = await confirm({
          title: 'Delete Template',
          message: `Are you sure you want to delete "${r.name}"? This cannot be undone.`,
          confirmLabel: 'Delete',
          variant: 'danger',
        });
        if (ok) deleteMutation.mutate(r.id);
      },
      hidden: (r) => r.isSystem,
    },
  ];

  return (
    <div>
      <ERPPageHeader
        variant="list"
        title="Notification Templates"
        subtitle="Custom message templates per event type and channel. System templates (password reset, welcome email, etc.) are read-only here."
        actions={<Button onClick={() => navigate(`${LIST_PATH}/new`)}>+ New Template</Button>}
      />

      <ERPDataGrid
        columns={columns}
        data={templates}
        isLoading={isLoading}
        rowKey="id"
        emptyState={
          <ERPEmptyState
            type="no-data"
            title="No templates yet"
            description="Create a custom template for an event type and channel."
          />
        }
        actions={rowActions}
      />
    </div>
  );
}
