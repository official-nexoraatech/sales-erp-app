import { useState } from 'react';
import { useNavigate, useSearchParams, Link } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import toast from 'react-hot-toast';
import { AlertCircle, X, CheckCircle2 } from 'lucide-react';
import { authApi } from '../../api/endpoints.js';
import PasswordInput from '../../components/ui/PasswordInput.js';
import Button from '../../components/ui/Button.js';
import AuthLayout from '../../components/auth/AuthLayout.js';

function FormAlert({ message, onDismiss }: { message: string; onDismiss: () => void }) {
  return (
    <div role="alert" className="flex items-start gap-2 rounded-lg border border-danger bg-danger-bg px-3 py-2.5 text-sm text-danger-fg">
      <AlertCircle className="h-4 w-4 shrink-0 mt-0.5 text-danger" />
      <p className="flex-1">{message}</p>
      <button type="button" onClick={onDismiss} aria-label="Dismiss" className="shrink-0 text-danger-fg/70 hover:text-danger-fg">
        <X className="h-4 w-4" />
      </button>
    </div>
  );
}

const schema = z
  .object({
    newPassword: z.string().min(12, 'Must be at least 12 characters').max(128),
    confirmPassword: z.string().min(1, 'Required'),
  })
  .refine((data) => data.newPassword === data.confirmPassword, {
    message: 'Passwords do not match',
    path: ['confirmPassword'],
  });
type FormData = z.infer<typeof schema>;

export default function ResetPasswordPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const token = searchParams.get('token');
  const [loading, setLoading] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const { register, handleSubmit, formState: { errors } } = useForm<FormData>({
    resolver: zodResolver(schema),
  });

  async function onSubmit(data: FormData) {
    if (!token) return;
    setLoading(true);
    setFormError(null);
    try {
      await authApi.resetPasswordWithToken({ token, newPassword: data.newPassword });
      setDone(true);
      toast.success('Password reset successfully');
    } catch (err: unknown) {
      setFormError(err instanceof Error ? err.message : 'Could not reset password. The link may have expired.');
    } finally {
      setLoading(false);
    }
  }

  if (!token) {
    return (
      <AuthLayout>
        <div className="text-center py-4">
          <h1 className="text-xl font-bold text-primary mb-2">Invalid reset link</h1>
          <p className="text-sm text-secondary mb-6">This password reset link is missing or malformed.</p>
          <Link to="/login" className="text-sm text-brand hover:underline">Back to login</Link>
        </div>
      </AuthLayout>
    );
  }

  if (done) {
    return (
      <AuthLayout>
        <div className="text-center py-4">
          <div className="inline-flex items-center justify-center w-12 h-12 rounded-full bg-success-bg mb-4">
            <CheckCircle2 className="h-6 w-6 text-success" />
          </div>
          <h1 className="text-xl font-bold text-primary mb-2">Password reset</h1>
          <p className="text-sm text-secondary mb-6">
            Your password has been changed. All existing sessions have been signed out.
          </p>
          <Button className="w-full justify-center" onClick={() => navigate('/login')}>
            Sign in
          </Button>
        </div>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout>
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-primary">Set a new password</h1>
        <p className="text-sm text-secondary mt-1">Must be at least 12 characters.</p>
      </div>

      <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
        {formError && <FormAlert message={formError} onDismiss={() => setFormError(null)} />}
        <PasswordInput
          label="New Password"
          placeholder="••••••••"
          autoComplete="new-password"
          autoFocus
          {...register('newPassword')}
          error={errors.newPassword?.message}
        />
        <PasswordInput
          label="Confirm Password"
          placeholder="••••••••"
          autoComplete="new-password"
          {...register('confirmPassword')}
          error={errors.confirmPassword?.message}
        />
        <Button type="submit" className="w-full justify-center" loading={loading} size="lg">
          Reset Password
        </Button>
      </form>
    </AuthLayout>
  );
}
