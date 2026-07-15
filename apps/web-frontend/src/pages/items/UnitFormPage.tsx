import { useEffect } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { unitApi } from '../../api/endpoints.js';
import ERPPageHeader from '../../components/erp/ERPPageHeader.js';
import ERPFormSection from '../../components/erp/ERPFormSection.js';
import ERPStickyFooter from '../../components/erp/ERPStickyFooter.js';
import { ERPFormSkeleton } from '../../components/erp/ERPSkeleton.js';
import Input from '../../components/ui/Input.js';
import Button from '../../components/ui/Button.js';

interface Unit {
  id: number;
  name: string;
  abbreviation: string;
  version?: number;
}

const LIST_PATH = '/inventory/units';

export default function UnitFormPage() {
  const { id } = useParams<{ id?: string }>();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const isEdit = !!id;

  const { data, isLoading } = useQuery({ queryKey: ['units'], queryFn: () => unitApi.list() });
  const units: Unit[] = (data as { content?: Unit[] })?.content ?? [];
  const unit = isEdit ? units.find((u) => u.id === Number(id)) : undefined;

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<Partial<Unit>>();

  useEffect(() => {
    if (unit) reset(unit);
  }, [unit, reset]);

  const mutation = useMutation({
    mutationFn: (d: Record<string, unknown>) =>
      isEdit ? unitApi.update(Number(id), d) : unitApi.create(d),
    onSuccess: () => {
      toast.success(isEdit ? 'Unit updated' : 'Unit created');
      qc.invalidateQueries({ queryKey: ['units'] });
      navigate(LIST_PATH);
    },
    onError: (err: Error) => toast.error(err.message),
  });

  if (isEdit && isLoading) {
    return (
      <div>
        <ERPPageHeader variant="detail" title="Edit Unit" backTo={LIST_PATH} />
        <ERPFormSkeleton />
      </div>
    );
  }

  return (
    <div>
      <ERPPageHeader
        variant="detail"
        title={isEdit ? 'Edit Unit' : 'New Unit'}
        backTo={LIST_PATH}
      />
      <form
        onSubmit={handleSubmit((d) => mutation.mutate(d as Record<string, unknown>))}
        noValidate
      >
        <ERPFormSection title="Unit Details" columns={2}>
          <Input
            label="Name"
            required
            placeholder="Metre"
            {...register('name', { required: 'Required' })}
            error={errors.name?.message}
          />
          <Input
            label="Symbol"
            required
            placeholder="m"
            {...register('abbreviation', { required: 'Required' })}
            error={errors.abbreviation?.message}
          />
        </ERPFormSection>
        <ERPStickyFooter>
          <Button variant="secondary" type="button" onClick={() => navigate(LIST_PATH)}>
            Cancel
          </Button>
          <Button type="submit" loading={isSubmitting || mutation.isPending}>
            {isEdit ? 'Save Changes' : 'Create Unit'}
          </Button>
        </ERPStickyFooter>
      </form>
    </div>
  );
}
