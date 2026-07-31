import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import { portalApiClient, PortalApiError } from '../api/portalApiClient.js';
import { usePortalAuthStore } from '../store/portalAuth.store.js';

const LoginSchema = z.object({
  tenantId: z.coerce.number().int().positive('Required'),
  email: z.string().email('Enter a valid email'),
  password: z.string().min(1, 'Required'),
});
type LoginForm = z.infer<typeof LoginSchema>;

const REMEMBER_KEY = 'customer-portal-remembered-tenant';

export function PortalLoginPage(): React.ReactElement {
  const navigate = useNavigate();
  const setSession = usePortalAuthStore((s) => s.setSession);
  const [submitting, setSubmitting] = useState(false);

  const remembered = (() => {
    try {
      return JSON.parse(localStorage.getItem(REMEMBER_KEY) ?? 'null') as {
        tenantId: number;
      } | null;
    } catch {
      return null;
    }
  })();

  const { register, handleSubmit, formState } = useForm<LoginForm>({
    resolver: zodResolver(LoginSchema),
    defaultValues: { tenantId: remembered?.tenantId ?? 1, email: '', password: '' },
  });

  async function onSubmit(data: LoginForm): Promise<void> {
    setSubmitting(true);
    try {
      const res = await portalApiClient.post<{
        accessToken: string;
        mustResetPassword: boolean;
      }>('auth', '/auth/portal/login', data);
      localStorage.setItem(REMEMBER_KEY, JSON.stringify({ tenantId: data.tenantId }));
      const me = await fetchMe(res.accessToken);
      setSession(res.accessToken, {
        id: me.id,
        tenantId: data.tenantId,
        email: me.email,
        displayName: me.displayName,
        mustResetPassword: res.mustResetPassword,
      });
      navigate('/', { replace: true });
    } catch (err) {
      toast.error(err instanceof PortalApiError ? err.message : 'Login failed');
    } finally {
      setSubmitting(false);
    }
  }

  // /portal/me needs the fresh token, which isn't yet in the store during this same submit —
  // called directly with an explicit Authorization header rather than through portalApiClient.
  async function fetchMe(
    accessToken: string
  ): Promise<{ id: number; email: string; displayName: string }> {
    const gatewayUrl = import.meta.env.VITE_GATEWAY_URL ?? 'http://localhost:3000';
    const response = await fetch(`${gatewayUrl}/api/sales/portal/me`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    const body = await response.json();
    return body.data;
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-[var(--surface-page)] px-4">
      <form
        onSubmit={handleSubmit(onSubmit)}
        className="w-full max-w-sm space-y-4 rounded-lg border border-[var(--border-default)] bg-[var(--surface-card)] p-6"
      >
        <h1 className="text-lg font-semibold text-[var(--text-primary)]">
          Sign in to your account
        </h1>
        <div className="space-y-1">
          <label className="text-sm text-[var(--text-secondary)]">Store ID</label>
          <input
            type="number"
            {...register('tenantId')}
            className="w-full rounded-md border border-[var(--border-default)] bg-[var(--surface-page)] px-3 py-2 text-sm"
          />
          {formState.errors.tenantId && (
            <p className="text-xs text-red-500">{formState.errors.tenantId.message}</p>
          )}
        </div>
        <div className="space-y-1">
          <label className="text-sm text-[var(--text-secondary)]">Email</label>
          <input
            type="email"
            {...register('email')}
            className="w-full rounded-md border border-[var(--border-default)] bg-[var(--surface-page)] px-3 py-2 text-sm"
          />
          {formState.errors.email && (
            <p className="text-xs text-red-500">{formState.errors.email.message}</p>
          )}
        </div>
        <div className="space-y-1">
          <label className="text-sm text-[var(--text-secondary)]">Password</label>
          <input
            type="password"
            {...register('password')}
            className="w-full rounded-md border border-[var(--border-default)] bg-[var(--surface-page)] px-3 py-2 text-sm"
          />
          {formState.errors.password && (
            <p className="text-xs text-red-500">{formState.errors.password.message}</p>
          )}
        </div>
        <button
          type="submit"
          disabled={submitting}
          className="w-full rounded-md bg-[var(--action-primary,#2563eb)] px-3 py-2 text-sm font-medium text-white disabled:opacity-60"
        >
          {submitting ? 'Signing in…' : 'Sign in'}
        </button>
      </form>
    </div>
  );
}
