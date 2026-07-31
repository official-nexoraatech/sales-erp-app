import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useNavigate, useSearchParams } from 'react-router-dom';
import toast from 'react-hot-toast';
import { portalApiClient, PortalApiError } from '../api/portalApiClient.js';

const SetPasswordSchema = z
  .object({
    newPassword: z.string().min(12, 'At least 12 characters'),
    confirmPassword: z.string().min(1, 'Required'),
  })
  .refine((d) => d.newPassword === d.confirmPassword, {
    message: 'Passwords do not match',
    path: ['confirmPassword'],
  });
type SetPasswordForm = z.infer<typeof SetPasswordSchema>;

export function PortalSetPasswordPage(): React.ReactElement {
  const [searchParams] = useSearchParams();
  const token = searchParams.get('token') ?? '';
  const navigate = useNavigate();
  const [submitting, setSubmitting] = useState(false);

  const { register, handleSubmit, formState } = useForm<SetPasswordForm>({
    resolver: zodResolver(SetPasswordSchema),
  });

  async function onSubmit(data: SetPasswordForm): Promise<void> {
    if (!token) {
      toast.error('This link is missing its token — request a new invite.');
      return;
    }
    setSubmitting(true);
    try {
      await portalApiClient.post('auth', '/auth/portal/set-password', {
        token,
        newPassword: data.newPassword,
      });
      toast.success('Password set — you can now sign in.');
      navigate('/login', { replace: true });
    } catch (err) {
      toast.error(err instanceof PortalApiError ? err.message : 'Could not set password');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-[var(--surface-page)] px-4">
      <form
        onSubmit={handleSubmit(onSubmit)}
        className="w-full max-w-sm space-y-4 rounded-lg border border-[var(--border-default)] bg-[var(--surface-card)] p-6"
      >
        <h1 className="text-lg font-semibold text-[var(--text-primary)]">Set your password</h1>
        <div className="space-y-1">
          <label className="text-sm text-[var(--text-secondary)]">New password</label>
          <input
            type="password"
            {...register('newPassword')}
            className="w-full rounded-md border border-[var(--border-default)] bg-[var(--surface-page)] px-3 py-2 text-sm"
          />
          {formState.errors.newPassword && (
            <p className="text-xs text-red-500">{formState.errors.newPassword.message}</p>
          )}
        </div>
        <div className="space-y-1">
          <label className="text-sm text-[var(--text-secondary)]">Confirm password</label>
          <input
            type="password"
            {...register('confirmPassword')}
            className="w-full rounded-md border border-[var(--border-default)] bg-[var(--surface-page)] px-3 py-2 text-sm"
          />
          {formState.errors.confirmPassword && (
            <p className="text-xs text-red-500">{formState.errors.confirmPassword.message}</p>
          )}
        </div>
        <button
          type="submit"
          disabled={submitting}
          className="w-full rounded-md bg-[var(--action-primary,#2563eb)] px-3 py-2 text-sm font-medium text-white disabled:opacity-60"
        >
          {submitting ? 'Saving…' : 'Set password'}
        </button>
      </form>
    </div>
  );
}
