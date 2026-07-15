import { useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { ssoConfigApi } from '../../api/endpoints.js';
import { ApiError } from '../../api/client.js';
import { useAuthStore } from '../../store/auth.store.js';
import { PERMISSIONS } from '../../constants/permissions.js';
import ERPPageHeader from '../../components/erp/ERPPageHeader.js';
import Input from '../../components/ui/Input.js';
import Select from '../../components/ui/Select.js';
import PasswordInput from '../../components/ui/PasswordInput.js';
import Button from '../../components/ui/Button.js';
import Checkbox from '../../components/ui/Checkbox.js';
import { ERPFormSkeleton } from '../../components/erp/ERPSkeleton.js';

const PROVIDER_OPTIONS = [
  { value: 'OKTA', label: 'Okta' },
  { value: 'AZURE_AD', label: 'Azure AD' },
  { value: 'GOOGLE_WORKSPACE', label: 'Google Workspace' },
  { value: 'GENERIC_OIDC', label: 'Generic OIDC' },
];

interface SsoConfigForm {
  provider: string;
  issuerUrl: string;
  clientId: string;
  clientSecret?: string;
  enabled: boolean;
  bypassLocalMfa: boolean;
}

export default function SsoConfigPage() {
  const qc = useQueryClient();
  const canManage = useAuthStore((s) => s.hasPermission(PERMISSIONS.SSO_CONFIG_MANAGE));

  const { data, isLoading } = useQuery({
    queryKey: ['sso-config'],
    // No SSO configured yet is a valid state, not an error.
    queryFn: async () => {
      try {
        return await ssoConfigApi.get();
      } catch (err) {
        if (err instanceof ApiError && err.statusCode === 404) return null;
        throw err;
      }
    },
  });

  const config = data as Record<string, unknown> | null | undefined;

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isDirty, isSubmitting },
  } = useForm<SsoConfigForm>({
    defaultValues: { provider: 'GENERIC_OIDC', enabled: false, bypassLocalMfa: false },
  });

  useEffect(() => {
    if (config) reset({ ...(config as unknown as SsoConfigForm), clientSecret: '' });
  }, [config, reset]);

  const saveMutation = useMutation({
    mutationFn: (payload: Record<string, unknown>) => ssoConfigApi.update(payload),
    onSuccess: () => {
      toast.success('SSO configuration saved');
      void qc.invalidateQueries({ queryKey: ['sso-config'] });
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const removeMutation = useMutation({
    mutationFn: () => ssoConfigApi.remove(),
    onSuccess: () => {
      toast.success('SSO configuration removed');
      void qc.invalidateQueries({ queryKey: ['sso-config'] });
    },
    onError: (err: Error) => toast.error(err.message),
  });

  if (isLoading) return <ERPFormSkeleton />;

  const onSubmit = (d: SsoConfigForm) => {
    const payload: Record<string, unknown> = { ...d };
    if (!d.clientSecret) delete payload['clientSecret'];
    saveMutation.mutate(payload);
  };

  return (
    <div>
      <ERPPageHeader
        variant="list"
        title="SSO Configuration"
        subtitle="Let this tenant's users sign in via a corporate identity provider (Okta, Azure AD, Google Workspace) instead of a password."
      />

      <form onSubmit={handleSubmit(onSubmit)} className="max-w-2xl space-y-5" noValidate>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <Select
            label="Identity Provider"
            {...register('provider', { required: 'Required' })}
            options={PROVIDER_OPTIONS}
            error={errors.provider?.message}
          />
          <Input
            label="Issuer URL"
            placeholder="https://your-org.okta.com"
            {...register('issuerUrl', { required: 'Required' })}
            error={errors.issuerUrl?.message}
          />
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <Input
            label="Client ID"
            {...register('clientId', { required: 'Required' })}
            error={errors.clientId?.message}
          />
          <PasswordInput
            label="Client Secret"
            placeholder={config ? 'Leave blank to keep existing secret' : 'Required'}
            {...register('clientSecret', { required: config ? false : 'Required' })}
            error={errors.clientSecret?.message}
          />
        </div>

        <div className="border-t border-default pt-5 space-y-3">
          <Checkbox label="Enable SSO login for this tenant" {...register('enabled')} />
          <Checkbox
            label="Skip this app's TOTP 2FA for SSO logins (the IdP is trusted to enforce its own MFA)"
            {...register('bypassLocalMfa')}
          />
        </div>

        {canManage && (
          <div className="flex items-center gap-3 pt-2">
            <Button
              type="submit"
              loading={isSubmitting || saveMutation.isPending}
              disabled={!isDirty}
            >
              Save Changes
            </Button>
            {config && (
              <Button
                type="button"
                variant="danger-outline"
                disabled={removeMutation.isPending}
                onClick={() => {
                  if (
                    window.confirm(
                      'Remove SSO configuration for this tenant? Users will no longer be able to sign in via SSO.'
                    )
                  ) {
                    removeMutation.mutate();
                  }
                }}
              >
                Remove SSO
              </Button>
            )}
          </div>
        )}
      </form>
    </div>
  );
}
