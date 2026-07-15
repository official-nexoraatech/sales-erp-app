import { useEffect } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { categoryApi } from '../../api/endpoints.js';
import ERPPageHeader from '../../components/erp/ERPPageHeader.js';
import ERPFormSection from '../../components/erp/ERPFormSection.js';
import ERPStickyFooter from '../../components/erp/ERPStickyFooter.js';
import { ERPFormSkeleton } from '../../components/erp/ERPSkeleton.js';
import Input from '../../components/ui/Input.js';
import Button from '../../components/ui/Button.js';

interface Category {
  id: number;
  name: string;
  code?: string;
  description?: string;
  version?: number;
}

const LIST_PATH = '/inventory/categories';

export default function CategoryFormPage() {
  const { id } = useParams<{ id?: string }>();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const isEdit = !!id;

  const { data, isLoading } = useQuery({
    queryKey: ['categories'],
    queryFn: () => categoryApi.list(),
  });
  const categories: Category[] = (data as { content?: Category[] })?.content ?? [];
  const category = isEdit ? categories.find((c) => c.id === Number(id)) : undefined;

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<Partial<Category>>();

  useEffect(() => {
    if (category) reset(category);
  }, [category, reset]);

  const mutation = useMutation({
    mutationFn: (d: Record<string, unknown>) =>
      isEdit ? categoryApi.update(Number(id), d) : categoryApi.create(d),
    onSuccess: () => {
      toast.success(isEdit ? 'Category updated' : 'Category created');
      qc.invalidateQueries({ queryKey: ['categories'] });
      navigate(LIST_PATH);
    },
    onError: (err: Error) => toast.error(err.message),
  });

  if (isEdit && isLoading) {
    return (
      <div>
        <ERPPageHeader variant="detail" title="Edit Category" backTo={LIST_PATH} />
        <ERPFormSkeleton />
      </div>
    );
  }

  return (
    <div>
      <ERPPageHeader
        variant="detail"
        title={isEdit ? 'Edit Category' : 'New Category'}
        backTo={LIST_PATH}
      />
      <form
        onSubmit={handleSubmit((d) => mutation.mutate(d as Record<string, unknown>))}
        noValidate
      >
        <ERPFormSection title="Category Details" columns={2}>
          <Input
            label="Name"
            required
            {...register('name', { required: 'Required' })}
            error={errors.name?.message}
          />
          <Input label="Code" {...register('code')} />
          <Input
            label="Description"
            wrapperClassName="sm:col-span-2"
            {...register('description')}
          />
        </ERPFormSection>
        <ERPStickyFooter>
          <Button variant="secondary" type="button" onClick={() => navigate(LIST_PATH)}>
            Cancel
          </Button>
          <Button type="submit" loading={isSubmitting || mutation.isPending}>
            {isEdit ? 'Save Changes' : 'Create Category'}
          </Button>
        </ERPStickyFooter>
      </form>
    </div>
  );
}
