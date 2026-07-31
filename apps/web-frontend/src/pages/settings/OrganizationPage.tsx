import { useEffect, useRef, type ChangeEvent } from 'react';
import { useForm } from 'react-hook-form';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { GSTIN_REGEX } from '@erp/types';
import { organizationApi } from '../../api/endpoints.js';
import { useAuthStore } from '../../store/auth.store.js';
import { useOrganization } from '../../hooks/useOrganization.js';
import { useObjectUrl } from '../../hooks/useObjectUrl.js';
import { PERMISSIONS } from '../../constants/permissions.js';
import ERPPageHeader from '../../components/erp/ERPPageHeader.js';
import Input from '../../components/ui/Input.js';
import Select from '../../components/ui/Select.js';
import Button from '../../components/ui/Button.js';
import ColorPicker from '../../components/ui/ColorPicker.js';
import { ERPFormSkeleton } from '../../components/erp/ERPSkeleton.js';
import { broadcastTenantThemeChange } from '../../components/erp/TenantThemeSync.js';

const LOGO_MIME_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/svg+xml']);
const MAX_LOGO_SIZE = 2 * 1024 * 1024; // matches tenant-service's registered limit

interface OrgForm {
  orgName: string;
  legalName?: string;
  gstin?: string;
  pan?: string;
  address?: {
    line1?: string;
    city?: string;
    state?: string;
    pincode?: string;
  };
  themeConfig?: {
    brandPrimary?: string;
    brandSecondary?: string;
    brandAccent?: string;
    fontSans?: string;
    radiusScale?: 'sharp' | 'default' | 'rounded';
  };
  purchaseApprovalThreshold?: number | string;
}

export default function OrganizationPage() {
  const qc = useQueryClient();
  const canEditOrgSettings = useAuthStore((s) => s.hasPermission(PERMISSIONS.ORG_SETTINGS_EDIT));
  const { data, isLoading } = useOrganization();

  const org = data as Record<string, unknown> | undefined;

  const logoInputRef = useRef<HTMLInputElement>(null);
  const { data: logoBlob } = useQuery({
    queryKey: ['organization-logo'],
    queryFn: () => organizationApi.logoBlob(),
    enabled: Boolean(data?.logoObjectKey),
    staleTime: 60_000,
    retry: false,
  });
  const logoUrl = useObjectUrl(logoBlob);

  const uploadLogoMutation = useMutation({
    mutationFn: (file: File) => organizationApi.uploadLogo(file),
    onSuccess: () => {
      toast.success('Logo uploaded');
      qc.invalidateQueries({ queryKey: ['organization'] });
      qc.invalidateQueries({ queryKey: ['organization-logo'] });
      broadcastTenantThemeChange();
    },
    onError: (err: Error) => toast.error(err.message),
  });

  function handleLogoChange(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    if (!LOGO_MIME_TYPES.has(file.type)) {
      toast.error('Logo must be a PNG, JPEG, WebP or SVG image');
      return;
    }
    if (file.size > MAX_LOGO_SIZE) {
      toast.error('Logo exceeds the 2MB size limit');
      return;
    }
    uploadLogoMutation.mutate(file);
  }

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isDirty, isSubmitting },
  } = useForm<OrgForm>({});

  useEffect(() => {
    if (org) reset(org as unknown as OrgForm);
  }, [org, reset]);

  // GET returns `null` for every optional field a tenant hasn't set yet (gstin, pan, tan, cin,
  // address, bankDetails, invoiceFooter, termsAndConditions) — react-hook-form round-trips those
  // straight back on submit (as `null` for top-level fields, or as an all-blank-string object for
  // nested `address.*`, since RHF can't seed nested leaf defaults from a `null` parent). The
  // backend's Zod schema treats optional fields as `undefined`-or-valid, not `null`-or-valid, so
  // saving Legal Name alone on a freshly provisioned tenant 422'd on every other untouched field.
  function sanitizeOrgPayload(d: Record<string, unknown>): Record<string, unknown> {
    const payload = { ...d };
    for (const key of [
      'legalName',
      'gstin',
      'pan',
      'tan',
      'cin',
      'invoiceFooter',
      'termsAndConditions',
    ]) {
      if (payload[key] === null || payload[key] === '') delete payload[key];
    }
    const address = payload['address'] as Record<string, unknown> | null | undefined;
    if (!address || Object.values(address).every((v) => !v)) {
      delete payload['address'];
    }
    if (payload['bankDetails'] === null) delete payload['bankDetails'];
    // Blank/0 means "no threshold configured" (single-tier approval) — must be omitted
    // entirely, not sent as 0, since PurchaseOrderService.approve() treats 0 as "every PO
    // requires high-value approval", not "feature disabled".
    if (
      payload['purchaseApprovalThreshold'] === '' ||
      payload['purchaseApprovalThreshold'] === null
    ) {
      delete payload['purchaseApprovalThreshold'];
    }
    const themeConfig = payload['themeConfig'] as Record<string, unknown> | undefined;
    if (themeConfig) {
      for (const key of ['brandPrimary', 'brandSecondary', 'brandAccent', 'fontSans']) {
        if (themeConfig[key] === '') delete themeConfig[key];
      }
    }
    return payload;
  }

  const mutation = useMutation({
    mutationFn: (payload: Record<string, unknown>) => organizationApi.update(payload),
    onSuccess: () => {
      toast.success('Organization updated');
      qc.invalidateQueries({ queryKey: ['organization'] });
      broadcastTenantThemeChange();
    },
    onError: (err: Error) => toast.error(err.message),
  });

  if (isLoading) return <ERPFormSkeleton />;

  return (
    <div>
      <ERPPageHeader
        variant="list"
        title="Organization Settings"
        subtitle="Update your business details and registration information."
      />

      <form
        onSubmit={handleSubmit((d) =>
          mutation.mutate(sanitizeOrgPayload(d as unknown as Record<string, unknown>))
        )}
        className="max-w-2xl space-y-5"
        noValidate
      >
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <Input
            label="Organization Name"
            required
            {...register('orgName', { required: 'Required' })}
            error={errors.orgName?.message}
          />
          <Input label="Legal Name" {...register('legalName')} error={errors.legalName?.message} />
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <Input
            label="GSTIN"
            placeholder="27AAPFU0939F1ZV"
            {...register('gstin', {
              pattern: { value: GSTIN_REGEX, message: 'Invalid GSTIN format' },
            })}
            error={errors.gstin?.message}
          />
          <Input label="PAN" placeholder="AAPFU0939F" {...register('pan')} />
        </div>
        <Input label="Address Line 1" {...register('address.line1')} />
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4">
          <Input label="City" {...register('address.city')} />
          <Input label="State" {...register('address.state')} />
          <Input
            label="PIN Code"
            {...register('address.pincode', {
              pattern: { value: /^[1-9][0-9]{5}$/, message: 'Invalid PIN code' },
            })}
            error={errors.address?.pincode?.message}
          />
        </div>

        {/* Branding — ERP-PLANNING/05_ERP_THEME_SYSTEM.md §4. Changes apply live, app-wide,
            with no reload — see TenantThemeSync. */}
        <div className="border-t border-default pt-5">
          <h2 className="text-sm font-semibold text-primary mb-1">Branding</h2>
          <p className="text-xs text-secondary mb-4">
            Applies instantly, app-wide, to every user of this tenant.
          </p>

          <div className="flex items-center gap-4 mb-5">
            <div className="w-14 h-14 rounded-lg border border-default bg-surface-subtle flex items-center justify-center overflow-hidden shrink-0">
              {logoUrl ? (
                <img src={logoUrl} alt="Organization logo" className="w-full h-full object-cover" />
              ) : (
                <span className="text-xs text-secondary">No logo</span>
              )}
            </div>
            {canEditOrgSettings && (
              <div>
                <input
                  ref={logoInputRef}
                  type="file"
                  aria-label="Upload organization logo"
                  accept="image/png,image/jpeg,image/webp,image/svg+xml"
                  className="hidden"
                  onChange={handleLogoChange}
                />
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  loading={uploadLogoMutation.isPending}
                  onClick={() => logoInputRef.current?.click()}
                >
                  {org?.['logoObjectKey'] ? 'Replace logo' : 'Upload logo'}
                </Button>
                <p className="text-xs text-disabled mt-1">PNG, JPEG, WebP or SVG, up to 2MB.</p>
              </div>
            )}
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-4">
            <ColorPicker label="Primary Color" {...register('themeConfig.brandPrimary')} />
            <ColorPicker label="Secondary Color" {...register('themeConfig.brandSecondary')} />
            <ColorPicker label="Accent Color" {...register('themeConfig.brandAccent')} />
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 max-w-md">
            <Select label="Font" {...register('themeConfig.fontSans')}>
              <option value="">Default (Inter)</option>
              <option value="Inter">Inter</option>
              <option value="system-ui">System UI</option>
            </Select>
            <Select label="Corner Radius" {...register('themeConfig.radiusScale')}>
              <option value="default">Default</option>
              <option value="sharp">Sharp</option>
              <option value="rounded">Rounded</option>
            </Select>
          </div>
        </div>

        <div className="border-t border-default pt-5">
          <h2 className="text-sm font-semibold text-primary mb-1">Purchase Approvals</h2>
          <p className="text-xs text-secondary mb-4">
            Purchase Orders above this amount require an approver with the PO High-Value Approval
            permission, in addition to regular PO approval. Leave blank to disable (single-tier
            approval — the default).
          </p>
          <Input
            label="Approval Threshold (₹)"
            type="number"
            step="0.01"
            min="0"
            placeholder="No threshold — single-tier approval"
            {...register('purchaseApprovalThreshold')}
          />
        </div>

        {canEditOrgSettings && (
          <div className="flex items-center gap-3 pt-2">
            <Button type="submit" loading={isSubmitting || mutation.isPending} disabled={!isDirty}>
              Save Changes
            </Button>
          </div>
        )}
      </form>
    </div>
  );
}
