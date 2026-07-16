import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import toast from 'react-hot-toast';
import { AlertCircle, X } from 'lucide-react';
import { authApi, tenantApi } from '../../api/endpoints.js';
import { ApiError } from '../../api/client.js';
import { useAuthStore } from '../../store/auth.store.js';
import { NAV_GROUPS, getFirstAccessiblePath } from '../../lib/navigation.js';
import Input from '../../components/ui/Input.js';
import PasswordInput from '../../components/ui/PasswordInput.js';
import Button from '../../components/ui/Button.js';
import AuthLayout from '../../components/auth/AuthLayout.js';

// Mirrors PublicSignupSchema in apps/tenant-service/src/api/tenant.schemas.ts — keep in sync.
const schema = z.object({
  name: z.string().min(2, 'Organization name is required').max(200),
  slug: z
    .string()
    .min(2, 'At least 2 characters')
    .max(63)
    .regex(/^[a-z0-9-]+$/, 'Lowercase letters, numbers and hyphens only'),
  contactEmail: z.string().email('Invalid email'),
  adminFirstName: z.string().min(1, 'Required'),
  adminLastName: z.string().min(1, 'Required'),
  adminPassword: z.string().min(12, 'At least 12 characters').max(128),
});
type FormData = z.infer<typeof schema>;

function signupErrorMessage(err: unknown): string {
  if (err instanceof ApiError) {
    if (err.statusCode === 429) return err.message || 'Too many attempts. Please try again later.';
    return err.message || 'Something went wrong. Please try again.';
  }
  return 'Network error. Please check your connection and try again.';
}

export default function SignupPage() {
  const navigate = useNavigate();
  const { setTokens, setUser } = useAuthStore();
  const [loading, setLoading] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<FormData>({ resolver: zodResolver(schema) });

  async function onSubmit(data: FormData) {
    setLoading(true);
    setFormError(null);
    try {
      const result = await tenantApi.publicSignup(data);

      const loginRes = await authApi.login({
        email: data.contactEmail,
        password: data.adminPassword,
        tenantId: result.tenantId,
      });
      if (loginRes.accessToken && loginRes.refreshToken) {
        setTokens(loginRes.accessToken, loginRes.refreshToken);
        const jwtPayload = JSON.parse(atob(loginRes.accessToken.split('.')[1]!)) as {
          roles?: string[];
          permissions?: string[];
        };
        const me = await authApi.me();
        setUser({
          ...(me as object),
          roles: jwtPayload.roles ?? [],
          permissions: jwtPayload.permissions ?? [],
          branchIds: me.branches?.map((b) => b.branchId) ?? [],
        } as Parameters<typeof setUser>[0]);
        toast.success('Workspace created — welcome to NEXORAA ERP');
        const { hasPermission } = useAuthStore.getState();
        const firstPath = getFirstAccessiblePath(NAV_GROUPS, hasPermission);
        navigate(firstPath ?? '/no-access');
      }
    } catch (err: unknown) {
      setFormError(signupErrorMessage(err));
    } finally {
      setLoading(false);
    }
  }

  return (
    <AuthLayout>
      <div className="mb-8">
        <h1 className="font-display font-semibold text-2xl text-primary">Create your workspace</h1>
        <p className="text-sm text-secondary mt-1">
          Start your free trial — no credit card required
        </p>
      </div>

      <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
        {formError && (
          <div
            role="alert"
            className="flex items-start gap-2 rounded-lg border border-danger bg-danger-bg text-danger-fg px-3 py-2.5 text-sm"
          >
            <AlertCircle className="h-4 w-4 shrink-0 mt-0.5 text-danger" />
            <p className="flex-1">{formError}</p>
            <button
              type="button"
              onClick={() => setFormError(null)}
              aria-label="Dismiss"
              className="shrink-0 opacity-70 hover:opacity-100"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        )}

        <Input
          label="Organization name"
          placeholder="Acme Textiles Pvt. Ltd."
          autoFocus
          {...register('name')}
          error={errors.name?.message}
        />
        <Input
          label="Workspace URL"
          placeholder="acme-textiles"
          hint="Lowercase letters, numbers and hyphens only"
          {...register('slug')}
          error={errors.slug?.message}
        />
        <Input
          label="Your work email"
          type="email"
          placeholder="you@example.com"
          autoComplete="email"
          {...register('contactEmail')}
          error={errors.contactEmail?.message}
        />
        <div className="grid grid-cols-2 gap-3">
          <Input
            label="First name"
            autoComplete="given-name"
            {...register('adminFirstName')}
            error={errors.adminFirstName?.message}
          />
          <Input
            label="Last name"
            autoComplete="family-name"
            {...register('adminLastName')}
            error={errors.adminLastName?.message}
          />
        </div>
        <PasswordInput
          label="Password"
          placeholder="At least 12 characters"
          autoComplete="new-password"
          {...register('adminPassword')}
          error={errors.adminPassword?.message}
        />

        <Button type="submit" className="w-full justify-center" loading={loading} size="lg">
          Create Workspace
        </Button>

        <p className="text-center text-sm text-secondary">
          Already have an account?{' '}
          <button
            type="button"
            onClick={() => navigate('/login')}
            className="text-brand hover:underline"
          >
            Sign in
          </button>
        </p>
      </form>
    </AuthLayout>
  );
}
