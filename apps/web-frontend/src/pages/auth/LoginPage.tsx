import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import toast from 'react-hot-toast';
import { authApi } from '../../api/endpoints.js';
import { useAuthStore } from '../../store/auth.store.js';
import Input from '../../components/ui/Input.js';
import Button from '../../components/ui/Button.js';

const schema = z.object({
  tenantId: z.coerce.number().int().positive('Required'),
  email: z.string().email('Invalid email'),
  password: z.string().min(1, 'Required'),
});
type FormData = z.infer<typeof schema>;

export default function LoginPage() {
  const navigate = useNavigate();
  const { setTokens, setUser } = useAuthStore();
  const [loading, setLoading] = useState(false);

  const { register, handleSubmit, formState: { errors } } = useForm<FormData>({
    resolver: zodResolver(schema),
    defaultValues: { tenantId: 1 },
  });

  async function onSubmit(data: FormData) {
    setLoading(true);
    try {
      const res = await authApi.login({ email: data.email, password: data.password, tenantId: data.tenantId });
      setTokens(res.accessToken, res.refreshToken);
      // JWT payload carries roles + permissions (already verified server-side)
      const jwtPayload = JSON.parse(atob(res.accessToken.split('.')[1]!)) as {
        roles?: string[];
        permissions?: string[];
      };
      const me = await authApi.me();
      setUser({
        ...(me as object),
        roles: jwtPayload.roles ?? [],
        permissions: jwtPayload.permissions ?? [],
      } as Parameters<typeof setUser>[0]);
      navigate('/dashboard');
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Login failed';
      toast.error(msg);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen bg-surface-subtle flex items-center justify-center p-4">
      <div className="w-full max-w-md bg-surface-card rounded-2xl shadow-xl p-8">
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-12 h-12 rounded-xl bg-brand text-white text-xl font-bold mb-3">
            N
          </div>
          <h1 className="text-2xl font-bold text-primary">NEXORAA ERP</h1>
          <p className="text-sm text-secondary mt-1">Sign in to your account</p>
        </div>

        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
          <Input
            label="Tenant ID"
            type="number"
            {...register('tenantId')}
            error={errors.tenantId?.message}
          />
          <Input
            label="Email"
            type="email"
            placeholder="you@example.com"
            autoComplete="email"
            {...register('email')}
            error={errors.email?.message}
          />
          <Input
            label="Password"
            type="password"
            placeholder="••••••••"
            autoComplete="current-password"
            {...register('password')}
            error={errors.password?.message}
          />
          <Button type="submit" className="w-full justify-center" loading={loading} size="lg">
            Sign In
          </Button>
        </form>
      </div>
    </div>
  );
}
