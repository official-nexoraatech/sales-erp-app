import { useEffect } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { supplierApi, branchApi } from '../../api/endpoints.js';
import { useAuthStore } from '../../store/auth.store.js';
import { PERMISSIONS } from '../../constants/permissions.js';
import ERPPageHeader from '../../components/erp/ERPPageHeader.js';
import ERPFormSection from '../../components/erp/ERPFormSection.js';
import ERPStickyFooter from '../../components/erp/ERPStickyFooter.js';
import Input from '../../components/ui/Input.js';
import Select from '../../components/ui/Select.js';
import Checkbox from '../../components/ui/Checkbox.js';
import Button from '../../components/ui/Button.js';
import {
  supplierFormSchema,
  SUPPLIER_TYPES,
  SUPPLIER_STATUSES,
  type SupplierFormData,
} from '../../schemas/supplier.schema.js';
import { useDirtyFormGuard } from '../../hooks/useDirtyFormGuard.js';

const SUPPLIER_TYPE_LABELS: Record<(typeof SUPPLIER_TYPES)[number], string> = {
  DOMESTIC: 'Domestic',
  IMPORT: 'Import',
  MANUFACTURER: 'Manufacturer',
  AGENT: 'Agent',
};

interface BillingAddress {
  line1?: string;
  line2?: string;
  city?: string;
  state?: string;
  stateCode?: string;
  pincode?: string;
  country?: string;
}

// The API stores billingAddress as one nested object; the form flattens it into individual
// fields for ergonomics — these two helpers convert between the two shapes.
function flattenSupplier(s: Record<string, unknown>): Record<string, unknown> {
  const addr = (s.billingAddress as BillingAddress | null | undefined) ?? {};
  return {
    ...s,
    addressLine1: addr.line1,
    addressLine2: addr.line2,
    addressCity: addr.city,
    addressState: addr.state,
    addressStateCode: addr.stateCode,
    addressPincode: addr.pincode,
    addressCountry: addr.country,
  };
}

// Backend's billingAddress schema requires line1/city/state/stateCode/pincode all together
// (apps/sales-service/src/api/supplier.routes.ts) — the whole object is optional, but partial
// is not, so this only sends it once every required piece is filled in.
function buildBillingAddress(d: SupplierFormData): BillingAddress | undefined {
  if (
    !d.addressLine1 ||
    !d.addressCity ||
    !d.addressState ||
    !d.addressStateCode ||
    !d.addressPincode
  )
    return undefined;
  return {
    line1: d.addressLine1,
    ...(d.addressLine2 ? { line2: d.addressLine2 } : {}),
    city: d.addressCity,
    state: d.addressState,
    stateCode: d.addressStateCode,
    pincode: d.addressPincode,
    country: d.addressCountry || 'India',
  };
}

export default function SupplierFormPage() {
  const { id } = useParams<{ id?: string }>();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const hasPermission = useAuthStore((s) => s.hasPermission);
  const userBranchIds = useAuthStore((s) => s.user?.branchIds) ?? [];
  const isEdit = !!id;

  const { data: supplierData } = useQuery({
    queryKey: ['suppliers', id],
    queryFn: () => supplierApi.getById(Number(id)),
    enabled: isEdit,
  });
  const supplier = supplierData as Record<string, unknown> | undefined;

  const { data: branchData } = useQuery({
    queryKey: ['branches'],
    queryFn: () => branchApi.list(),
    enabled: hasPermission(PERMISSIONS.BRANCH_VIEW),
  });
  const branches = (branchData as { content?: unknown[] })?.content ?? [];

  const {
    register,
    handleSubmit,
    reset,
    setValue,
    formState: { errors, isSubmitting, isDirty },
  } = useForm<SupplierFormData>({
    resolver: zodResolver(supplierFormSchema),
    // A checkbox always reports an explicit true/false on submit (unlike a blank text input,
    // which reports undefined) — without this, a new supplier left untouched would silently
    // submit isRegistered:false, the opposite of the correct default for most suppliers.
    defaultValues: { isRegistered: true },
  });
  useDirtyFormGuard(isDirty);

  useEffect(() => {
    if (supplier) reset(flattenSupplier(supplier) as unknown as SupplierFormData);
  }, [supplier, reset]);

  useEffect(() => {
    if (!isEdit && userBranchIds.length === 1) setValue('branchId', userBranchIds[0] as number);
  }, [isEdit, userBranchIds, setValue]);

  const mutation = useMutation({
    mutationFn: (d: Record<string, unknown>) =>
      isEdit ? supplierApi.update(Number(id), d) : supplierApi.create(d),
    onSuccess: () => {
      toast.success(isEdit ? 'Supplier updated' : 'Supplier created');
      qc.invalidateQueries({ queryKey: ['suppliers'] });
      navigate('/suppliers');
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const onSubmit = (d: SupplierFormData) => {
    const {
      addressLine1: _l1,
      addressLine2: _l2,
      addressCity: _c,
      addressState: _s,
      addressStateCode: _sc,
      addressPincode: _p,
      addressCountry: _co,
      ...rest
    } = d;
    const payload: Record<string, unknown> = {
      ...rest,
      billingAddress: buildBillingAddress(d),
    };
    // PUT /suppliers/:id requires `version` for optimistic locking — supplierFormSchema
    // never declared it (nothing else in the form needs it), and zodResolver strips any
    // key not declared in the schema before handleSubmit's callback runs, so every edit
    // silently 409'd with OptimisticLockError until this merged it back in from the
    // already-loaded record, same fix as WarehouseFormPage's equivalent bug.
    if (isEdit && supplier) payload.version = supplier.version;
    mutation.mutate(payload);
  };

  return (
    <div>
      <ERPPageHeader
        variant="detail"
        title={isEdit ? 'Edit Supplier' : 'New Supplier'}
        backTo="/suppliers"
      />

      <form onSubmit={handleSubmit(onSubmit)} className="space-y-6" noValidate>
        <ERPFormSection title="Supplier Details" columns={2}>
          <Input
            label="Display Name"
            required
            {...register('displayName')}
            error={errors.displayName?.message}
          />
          <Input
            label="Company Name"
            {...register('companyName')}
            error={errors.companyName?.message}
          />
          <Input
            label="Contact Person"
            {...register('contactPerson')}
            error={errors.contactPerson?.message}
          />
          <Select
            label="Supplier Type"
            {...register('supplierType')}
            error={errors.supplierType?.message}
          >
            <option value="">Select…</option>
            {SUPPLIER_TYPES.map((t) => (
              <option key={t} value={t}>
                {SUPPLIER_TYPE_LABELS[t]}
              </option>
            ))}
          </Select>
          <Select
            label="Branch"
            required
            {...register('branchId')}
            error={errors.branchId?.message}
          >
            <option value="">Select branch…</option>
            {(branches as Record<string, unknown>[]).map((b) => (
              <option key={b.id as number} value={b.id as number}>
                {b.name as string}
              </option>
            ))}
          </Select>
          {isEdit && (
            <Select label="Status" {...register('status')} error={errors.status?.message}>
              {SUPPLIER_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </Select>
          )}
          <Input label="Phone" required {...register('phone')} error={errors.phone?.message} />
          <Input label="Alt Phone" {...register('altPhone')} error={errors.altPhone?.message} />
          <Input label="Email" type="email" {...register('email')} error={errors.email?.message} />
          <Input
            label="GSTIN"
            placeholder="27AAPFU0939F1ZV"
            {...register('gstin')}
            error={errors.gstin?.message}
          />
          <Input label="PAN" {...register('pan')} error={errors.pan?.message} />
          <Checkbox
            label="GST Registered"
            description="Uncheck for unregistered suppliers — enables reverse-charge (RCM) self-assessment on their GRNs"
            {...register('isRegistered')}
          />
        </ERPFormSection>

        <ERPFormSection title="Billing Address" columns={2}>
          <Input
            label="Address Line 1"
            wrapperClassName="sm:col-span-2"
            {...register('addressLine1')}
            error={errors.addressLine1?.message}
          />
          <Input
            label="Address Line 2"
            wrapperClassName="sm:col-span-2"
            {...register('addressLine2')}
            error={errors.addressLine2?.message}
          />
          <Input label="City" {...register('addressCity')} error={errors.addressCity?.message} />
          <Input label="State" {...register('addressState')} error={errors.addressState?.message} />
          <Input
            label="State Code"
            placeholder="e.g. 27"
            maxLength={2}
            {...register('addressStateCode')}
            error={errors.addressStateCode?.message}
            hint="2-digit GST state code — determines CGST/SGST vs IGST on purchases from this supplier"
          />
          <Input
            label="Pincode"
            {...register('addressPincode')}
            error={errors.addressPincode?.message}
          />
          <Input
            label="Country"
            {...register('addressCountry')}
            error={errors.addressCountry?.message}
          />
        </ERPFormSection>

        <ERPFormSection title="Bank Details" columns={2}>
          <Input label="Bank Name" {...register('bankName')} error={errors.bankName?.message} />
          <Input label="IFSC Code" {...register('bankIfsc')} error={errors.bankIfsc?.message} />
          <Input label="Branch" {...register('bankBranch')} error={errors.bankBranch?.message} />
          <Input
            label="Account Number"
            type="password"
            {...register('bankAccountNo')}
            error={errors.bankAccountNo?.message}
            hint="Stored encrypted"
          />
        </ERPFormSection>

        <ERPFormSection title="Credit Terms" columns={2}>
          <Input
            label="Credit Days"
            type="number"
            {...register('creditDays')}
            error={errors.creditDays?.message}
          />
          <Input
            label="Opening Balance (₹)"
            type="number"
            step="0.01"
            {...register('openingBalance')}
            error={errors.openingBalance?.message}
          />
          <Checkbox
            label="Enable Credit Limit"
            description="When enabled, a Purchase Order that would push this supplier's balance past the limit is blocked at approval (overridable with the Credit Limit Override permission)"
            {...register('creditLimitEnabled')}
          />
          <Input
            label="Credit Limit (₹)"
            type="number"
            step="0.01"
            {...register('creditLimit')}
            error={errors.creditLimit?.message}
          />
        </ERPFormSection>

        <ERPFormSection title="Vendor Rating" columns={2}>
          <Select
            label="Rating"
            {...register('rating')}
            error={errors.rating?.message}
            options={[
              { value: '', label: 'Not rated' },
              { value: '1', label: '1 – Poor' },
              { value: '2', label: '2 – Below average' },
              { value: '3', label: '3 – Average' },
              { value: '4', label: '4 – Good' },
              { value: '5', label: '5 – Excellent' },
            ]}
          />
          <Input
            label="Rating Notes"
            {...register('ratingNotes')}
            error={errors.ratingNotes?.message}
            placeholder="Basis for this rating (delivery reliability, quality, etc.)"
          />
        </ERPFormSection>

        <ERPFormSection title="Notes" columns={1}>
          <Input
            label="Notes"
            wrapperClassName="sm:col-span-1"
            {...register('notes')}
            error={errors.notes?.message}
          />
        </ERPFormSection>

        <ERPStickyFooter>
          <Button variant="secondary" type="button" onClick={() => navigate('/suppliers')}>
            Cancel
          </Button>
          <Button type="submit" loading={isSubmitting || mutation.isPending}>
            {isEdit ? 'Update' : 'Create'} Supplier
          </Button>
        </ERPStickyFooter>
      </form>
    </div>
  );
}
