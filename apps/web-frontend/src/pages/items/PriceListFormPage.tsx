import { useNavigate } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { priceListApi } from '../../api/endpoints.js';
import ERPPageHeader from '../../components/erp/ERPPageHeader.js';
import ERPFormSection from '../../components/erp/ERPFormSection.js';
import ERPStickyFooter from '../../components/erp/ERPStickyFooter.js';
import Input from '../../components/ui/Input.js';
import Button from '../../components/ui/Button.js';
import Checkbox from '../../components/ui/Checkbox.js';

interface PriceList {
  name: string;
  code: string;
  currency: string;
  isDefault: boolean;
  validFrom?: string;
  validTo?: string;
}

const LIST_PATH = '/inventory/price-lists';

export default function PriceListFormPage() {
  const navigate = useNavigate();
  const qc = useQueryClient();

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<Partial<PriceList>>({
    defaultValues: { currency: 'INR' },
  });

  const mutation = useMutation({
    mutationFn: (d: Record<string, unknown>) => priceListApi.create(d),
    onSuccess: () => {
      toast.success('Price list created');
      qc.invalidateQueries({ queryKey: ['price-lists'] });
      navigate(LIST_PATH);
    },
    onError: (err: Error) => toast.error(err.message),
  });

  return (
    <div>
      <ERPPageHeader variant="detail" title="New Price List" backTo={LIST_PATH} />
      <form
        onSubmit={handleSubmit((d) => mutation.mutate(d as Record<string, unknown>))}
        noValidate
      >
        <ERPFormSection title="Price List Details" columns={2}>
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
          <Input label="Currency" {...register('currency')} />
          <div />
          <Input label="Valid From" type="date" {...register('validFrom')} />
          <Input label="Valid To" type="date" {...register('validTo')} />
          <Checkbox label="Set as Default" {...register('isDefault')} />
        </ERPFormSection>
        <ERPStickyFooter>
          <Button variant="secondary" type="button" onClick={() => navigate(LIST_PATH)}>
            Cancel
          </Button>
          <Button type="submit" loading={isSubmitting || mutation.isPending}>
            Create Price List
          </Button>
        </ERPStickyFooter>
      </form>
    </div>
  );
}
