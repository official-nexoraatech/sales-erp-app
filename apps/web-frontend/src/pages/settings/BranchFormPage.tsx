import { useEffect } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import toast from 'react-hot-toast';
import { branchApi } from '../../api/endpoints.js';
import ERPPageHeader from '../../components/erp/ERPPageHeader.js';
import ERPFormSection from '../../components/erp/ERPFormSection.js';
import ERPStickyFooter from '../../components/erp/ERPStickyFooter.js';
import { ERPFormSkeleton } from '../../components/erp/ERPSkeleton.js';
import Input from '../../components/ui/Input.js';
import Button from '../../components/ui/Button.js';
import Checkbox from '../../components/ui/Checkbox.js';

interface Address {
  line1?: string;
  city?: string;
  state?: string;
  pincode?: string;
}

interface Branch {
  id: number;
  name: string;
  code: string;
  address: Address | null;
  isHeadOffice: boolean;
  isActive: boolean;
  gstin?: string | null;
  phone?: string | null;
  version: number;
}

type BranchFormValues = {
  name?: string | undefined;
  code?: string | undefined;
  gstin?: string | null | undefined;
  phone?: string | null | undefined;
  addressLine1?: string | undefined;
  city?: string | undefined;
  state?: string | undefined;
  pinCode?: string | undefined;
  isHeadOffice?: boolean | undefined;
};

const LIST_PATH = '/settings/branches';

export default function BranchFormPage() {
  const { id } = useParams<{ id?: string }>();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const isEdit = !!id;

  const { data: branch, isLoading } = useQuery({
    queryKey: ['branches', id],
    queryFn: () => branchApi.getById(Number(id)) as Promise<Branch>,
    enabled: isEdit,
  });

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<BranchFormValues>();

  useEffect(() => {
    if (!branch) return;
    reset({
      name: branch.name,
      code: branch.code,
      gstin: branch.gstin ?? undefined,
      phone: branch.phone ?? undefined,
      addressLine1: branch.address?.line1,
      city: branch.address?.city,
      state: branch.address?.state,
      pinCode: branch.address?.pincode,
      isHeadOffice: branch.isHeadOffice,
    });
  }, [branch, reset]);

  // The backend only accepts city/state/pincode nested under `address` (with a required
  // `line1`) — sending them as flat top-level fields gets silently dropped rather than
  // rejected. Also strip null/empty optional scalars (gstin/phone) — round-tripping a
  // branch's real `null` values back through this form 422'd on edit.
  function buildBranchPayload(d: BranchFormValues): Record<string, unknown> {
    const payload: Record<string, unknown> = {
      name: d.name,
      code: d.code,
      isHeadOffice: d.isHeadOffice ?? false,
    };
    if (d.gstin) payload['gstin'] = d.gstin;
    if (d.phone) payload['phone'] = d.phone;
    if (d.addressLine1 || d.city || d.state || d.pinCode) {
      payload['address'] = {
        line1: d.addressLine1 ?? '',
        city: d.city ?? '',
        state: d.state ?? '',
        pincode: d.pinCode ?? '',
      };
    }
    if (branch) payload['version'] = branch.version;
    return payload;
  }

  const mutation = useMutation({
    mutationFn: (payload: Record<string, unknown>) =>
      isEdit ? branchApi.update(Number(id), payload) : branchApi.create(payload),
    onSuccess: () => {
      toast.success(isEdit ? 'Branch updated' : 'Branch created');
      qc.invalidateQueries({ queryKey: ['branches'] });
      navigate(LIST_PATH);
    },
    onError: (err: Error) => toast.error(err.message),
  });

  if (isEdit && isLoading) {
    return (
      <div>
        <ERPPageHeader variant="detail" title="Edit Branch" backTo={LIST_PATH} />
        <ERPFormSkeleton />
      </div>
    );
  }

  return (
    <div>
      <ERPPageHeader
        variant="detail"
        title={isEdit ? 'Edit Branch' : 'New Branch'}
        subtitle="Manage your store branches and locations."
        backTo={LIST_PATH}
      />
      <form onSubmit={handleSubmit((d) => mutation.mutate(buildBranchPayload(d)))} noValidate>
        <ERPFormSection title="Branch Details" columns={2}>
          <Input
            label="Branch Name"
            required
            {...register('name', { required: 'Required' })}
            error={errors.name?.message}
          />
          <Input
            label="Code"
            required
            placeholder="BR001"
            {...register('code', { required: 'Required' })}
            error={errors.code?.message}
          />
          <Input label="GSTIN" placeholder="27AAPFU0939F1ZV" {...register('gstin')} />
          <div className="flex items-end">
            <Checkbox label="Head Office" {...register('isHeadOffice')} />
          </div>
        </ERPFormSection>
        <ERPFormSection title="Address" columns={3}>
          <Input
            label="Address Line 1"
            wrapperClassName="sm:col-span-3"
            {...register('addressLine1')}
          />
          <Input label="City" {...register('city')} />
          <Input label="State" {...register('state')} />
          <Input label="PIN Code" {...register('pinCode')} />
          <Input label="Phone" wrapperClassName="sm:col-span-3" {...register('phone')} />
        </ERPFormSection>
        <ERPStickyFooter>
          <Button variant="secondary" type="button" onClick={() => navigate(LIST_PATH)}>
            Cancel
          </Button>
          <Button type="submit" loading={isSubmitting || mutation.isPending}>
            {isEdit ? 'Save Changes' : 'Create Branch'}
          </Button>
        </ERPStickyFooter>
      </form>
    </div>
  );
}
