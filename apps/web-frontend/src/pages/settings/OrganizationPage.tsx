import { useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { GSTIN_REGEX } from '@erp/types';
import { organizationApi } from '../../api/endpoints.js';
import { ApiError } from '../../api/client.js';
import { useAuthStore } from '../../store/auth.store.js';
import { PERMISSIONS } from '../../constants/permissions.js';
import ERPPageHeader from '../../components/erp/ERPPageHeader.js';
import Input from '../../components/ui/Input.js';
import Select from '../../components/ui/Select.js';
import Button from '../../components/ui/Button.js';
import { ERPFormSkeleton } from '../../components/erp/ERPSkeleton.js';
import { broadcastTenantThemeChange } from '../../components/erp/TenantThemeSync.js';

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
}

export default function OrganizationPage() {
  const qc = useQueryClient();
  const canEditOrgSettings = useAuthStore((s) => s.hasPermission(PERMISSIONS.ORG_SETTINGS_EDIT));
  const { data, isLoading } = useQuery({
    queryKey: ['organization'],
    // A tenant with no organization row yet is a valid "not set up" state, not an
    // error — the PUT handler creates the row on first save. Swallow the 404 here
    // so it doesn't trip the global QueryCache error toast in main.tsx.
    queryFn: async () => {
      try {
        return await organizationApi.get();
      } catch (err) {
        if (err instanceof ApiError && err.statusCode === 404) return null;
        throw err;
      }
    },
  });

  const org = (data as Record<string, unknown> | undefined);

  const { register, handleSubmit, reset, formState: { errors, isDirty, isSubmitting } } = useForm<OrgForm>({});

  useEffect(() => {
    if (org) reset(org as unknown as OrgForm);
  }, [org, reset]);

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
      <ERPPageHeader variant="list" title="Organization Settings" subtitle="Update your business details and registration information." />

      <form onSubmit={handleSubmit((d) => mutation.mutate(d as unknown as Record<string, unknown>))} className="max-w-2xl space-y-5" noValidate>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <Input label="Organization Name" required {...register('orgName', { required: 'Required' })} error={errors.orgName?.message} />
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
          <p className="text-xs text-secondary mb-4">Applies instantly, app-wide, to every user of this tenant.</p>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-4">
            <div>
              <label htmlFor="theme-brand-primary" className="block text-xs font-medium text-secondary mb-1">Primary Color</label>
              <input id="theme-brand-primary" type="color" {...register('themeConfig.brandPrimary')} className="w-full h-10 rounded-lg border border-default cursor-pointer" />
            </div>
            <div>
              <label htmlFor="theme-brand-secondary" className="block text-xs font-medium text-secondary mb-1">Secondary Color</label>
              <input id="theme-brand-secondary" type="color" {...register('themeConfig.brandSecondary')} className="w-full h-10 rounded-lg border border-default cursor-pointer" />
            </div>
            <div>
              <label htmlFor="theme-brand-accent" className="block text-xs font-medium text-secondary mb-1">Accent Color</label>
              <input id="theme-brand-accent" type="color" {...register('themeConfig.brandAccent')} className="w-full h-10 rounded-lg border border-default cursor-pointer" />
            </div>
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
