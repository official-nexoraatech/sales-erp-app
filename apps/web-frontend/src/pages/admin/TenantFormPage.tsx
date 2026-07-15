import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { adminTenantApi } from '../../api/endpoints.js';
import ERPPageHeader from '../../components/erp/ERPPageHeader.js';
import ERPFormSection from '../../components/erp/ERPFormSection.js';
import ERPStickyFooter from '../../components/erp/ERPStickyFooter.js';
import Input from '../../components/ui/Input.js';
import Select from '../../components/ui/Select.js';
import Button from '../../components/ui/Button.js';
import {
  tenantFormSchema,
  TENANT_PLANS,
  type TenantFormData,
} from '../../schemas/tenant.schema.js';
import { useDirtyFormGuard } from '../../hooks/useDirtyFormGuard.js';

const PLAN_LABELS: Record<(typeof TENANT_PLANS)[number], string> = {
  STARTER: 'Starter',
  GROWTH: 'Growth',
  ENTERPRISE: 'Enterprise',
};

interface CreatedTenant {
  tenantId: number;
  adminEmail: string;
}

export default function TenantFormPage() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [created, setCreated] = useState<CreatedTenant | null>(null);

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting, isDirty },
  } = useForm<TenantFormData>({
    resolver: zodResolver(tenantFormSchema),
    defaultValues: { plan: 'STARTER' },
  });
  useDirtyFormGuard(isDirty);

  const mutation = useMutation({
    mutationFn: (d: TenantFormData) =>
      adminTenantApi.create({
        name: d.name,
        slug: d.slug,
        contactEmail: d.contactEmail,
        contactPhone: d.contactPhone || undefined,
        plan: d.plan,
        adminFirstName: d.adminFirstName,
        adminLastName: d.adminLastName,
        adminPassword: d.adminPassword,
        orgSettings:
          d.timezone || d.currency || d.country
            ? {
                timezone: d.timezone || undefined,
                currency: d.currency || undefined,
                country: d.country || undefined,
              }
            : undefined,
      }),
    onSuccess: (result) => {
      toast.success('Tenant created');
      qc.invalidateQueries({ queryKey: ['admin-tenants'] });
      setCreated({ tenantId: result.tenantId, adminEmail: result.adminEmail });
    },
    onError: (err: Error) => toast.error(err.message),
  });

  // The login screen asks for email + password + a numeric Tenant ID — this is the
  // one place that ID is ever surfaced, so the operator can hand it to the client.
  if (created) {
    return (
      <div>
        <ERPPageHeader variant="detail" title="Tenant Created" backTo="/admin/tenants" />
        <ERPFormSection
          title="Give these to the client"
          description="They'll need all three to log in — the Tenant ID isn't shown anywhere else once you leave this page, so copy it now."
        >
          <div className="space-y-3 text-sm">
            <div>
              <span className="text-secondary">Tenant ID: </span>
              <span className="font-mono text-base font-semibold text-primary">
                {created.tenantId}
              </span>
            </div>
            <div>
              <span className="text-secondary">Login email: </span>
              <span className="font-mono text-primary">{created.adminEmail}</span>
            </div>
            <div>
              <span className="text-secondary">Password: </span>
              <span className="text-primary">
                whatever you entered on the form — it was not saved or emailed anywhere
              </span>
            </div>
          </div>
        </ERPFormSection>
        <ERPStickyFooter>
          <Button onClick={() => navigate('/admin/tenants')}>Back to Tenants</Button>
        </ERPStickyFooter>
      </div>
    );
  }

  return (
    <div>
      <ERPPageHeader
        variant="detail"
        title="New Tenant"
        subtitle="Provision a new organization and its first Owner account."
        backTo="/admin/tenants"
      />

      <form onSubmit={handleSubmit((d) => mutation.mutate(d))} className="space-y-6" noValidate>
        <ERPFormSection title="Business Details" columns={2}>
          <Input
            label="Organization Name"
            required
            {...register('name')}
            error={errors.name?.message}
          />
          <Input
            label="Slug"
            required
            placeholder="acme-clothing"
            hint="Lowercase letters, numbers, and hyphens only"
            {...register('slug')}
            error={errors.slug?.message}
          />
          <Input
            label="Contact Email"
            type="email"
            required
            {...register('contactEmail')}
            error={errors.contactEmail?.message}
          />
          <Input
            label="Contact Phone"
            {...register('contactPhone')}
            error={errors.contactPhone?.message}
          />
          <Select label="Plan" {...register('plan')} error={errors.plan?.message}>
            {TENANT_PLANS.map((p) => (
              <option key={p} value={p}>
                {PLAN_LABELS[p]}
              </option>
            ))}
          </Select>
        </ERPFormSection>

        <ERPFormSection
          title="Default Owner Account"
          description="This person is created as the tenant's first user, with the Owner role — the highest permission level within that business."
          columns={2}
        >
          <Input
            label="First Name"
            required
            {...register('adminFirstName')}
            error={errors.adminFirstName?.message}
          />
          <Input
            label="Last Name"
            required
            {...register('adminLastName')}
            error={errors.adminLastName?.message}
          />
          <Input
            label="Password"
            type="password"
            required
            hint="At least 12 characters. This is not emailed to the client automatically — share it with them directly."
            {...register('adminPassword')}
            error={errors.adminPassword?.message}
          />
        </ERPFormSection>

        <ERPFormSection
          title="Regional Settings"
          description="Optional — platform defaults apply if left blank."
          columns={3}
        >
          <Input
            label="Timezone"
            placeholder="Asia/Kolkata"
            {...register('timezone')}
            error={errors.timezone?.message}
          />
          <Input
            label="Currency"
            placeholder="INR"
            {...register('currency')}
            error={errors.currency?.message}
          />
          <Input
            label="Country"
            placeholder="IN"
            {...register('country')}
            error={errors.country?.message}
          />
        </ERPFormSection>

        <ERPStickyFooter>
          <Button variant="secondary" type="button" onClick={() => navigate('/admin/tenants')}>
            Cancel
          </Button>
          <Button type="submit" loading={isSubmitting || mutation.isPending}>
            Create Tenant
          </Button>
        </ERPStickyFooter>
      </form>
    </div>
  );
}
