import { useEffect } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import toast from 'react-hot-toast';
import { warehouseApi, branchApi } from '../../api/endpoints.js';
import { useAuthStore } from '../../store/auth.store.js';
import { PERMISSIONS } from '../../constants/permissions.js';
import ERPPageHeader from '../../components/erp/ERPPageHeader.js';
import ERPFormSection from '../../components/erp/ERPFormSection.js';
import ERPStickyFooter from '../../components/erp/ERPStickyFooter.js';
import { ERPFormSkeleton } from '../../components/erp/ERPSkeleton.js';
import Input from '../../components/ui/Input.js';
import Select from '../../components/ui/Select.js';
import Button from '../../components/ui/Button.js';
import Checkbox from '../../components/ui/Checkbox.js';

interface Warehouse {
  id: number;
  name: string;
  code: string;
  branchId: number;
  isDefault: boolean;
  isActive: boolean;
  version: number;
}
interface Branch {
  id: number;
  name: string;
}

const LIST_PATH = '/settings/warehouses';

export default function WarehouseFormPage() {
  const { id } = useParams<{ id?: string }>();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const hasPermission = useAuthStore((s) => s.hasPermission);
  const isEdit = !!id;

  const { data: warehouse, isLoading } = useQuery({
    queryKey: ['warehouses', id],
    queryFn: () => warehouseApi.getById(Number(id)) as Promise<Warehouse>,
    enabled: isEdit,
  });

  const { data: branchData } = useQuery({
    queryKey: ['branches'],
    queryFn: () => branchApi.list(),
    enabled: hasPermission(PERMISSIONS.BRANCH_VIEW),
  });
  const branches: Branch[] = (branchData as { content?: Branch[] })?.content ?? [];

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<Partial<Warehouse>>();

  // reset() seeds react-hook-form's internal values from whatever object is passed — the raw API
  // row carries address/deletedAt/createdAt etc. that RHF would carry straight through to the
  // submitted payload. Reset only the fields this form actually edits.
  useEffect(() => {
    if (warehouse)
      reset({
        name: warehouse.name,
        code: warehouse.code,
        branchId: warehouse.branchId,
        isDefault: warehouse.isDefault,
      });
  }, [warehouse, reset]);

  const mutation = useMutation({
    // PUT /warehouses/:id requires `version` for optimistic locking.
    mutationFn: (d: Record<string, unknown>) =>
      isEdit
        ? warehouseApi.update(Number(id), { ...d, version: warehouse!.version })
        : warehouseApi.create(d),
    onSuccess: () => {
      toast.success(isEdit ? 'Warehouse updated' : 'Warehouse created');
      qc.invalidateQueries({ queryKey: ['warehouses'] });
      navigate(LIST_PATH);
    },
    onError: (err: Error) => toast.error(err.message),
  });

  if (isEdit && isLoading) {
    return (
      <div>
        <ERPPageHeader variant="detail" title="Edit Warehouse" backTo={LIST_PATH} />
        <ERPFormSkeleton />
      </div>
    );
  }

  return (
    <div>
      <ERPPageHeader
        variant="detail"
        title={isEdit ? 'Edit Warehouse' : 'New Warehouse'}
        subtitle="Manage warehouse/godown locations."
        backTo={LIST_PATH}
      />
      <form
        onSubmit={handleSubmit((d) => mutation.mutate(d as Record<string, unknown>))}
        noValidate
      >
        <ERPFormSection title="Warehouse Details" columns={2}>
          <Input
            label="Name"
            required
            {...register('name', { required: 'Required' })}
            error={errors.name?.message}
          />
          <Input
            label="Code"
            required
            {...register('code', { required: 'Required' })}
            error={errors.code?.message}
          />
          <Select
            label="Branch"
            required
            {...register('branchId', { required: 'Required', valueAsNumber: true })}
            error={errors.branchId?.message}
          >
            <option value="">Select branch…</option>
            {branches.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </Select>
          <div className="flex items-end">
            <Checkbox label="Set as Default" {...register('isDefault')} />
          </div>
        </ERPFormSection>
        <ERPStickyFooter>
          <Button variant="secondary" type="button" onClick={() => navigate(LIST_PATH)}>
            Cancel
          </Button>
          <Button type="submit" loading={isSubmitting || mutation.isPending}>
            {isEdit ? 'Save Changes' : 'Create Warehouse'}
          </Button>
        </ERPStickyFooter>
      </form>
    </div>
  );
}
