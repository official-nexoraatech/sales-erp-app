import React, { useState } from 'react';
import { Eye, EyeOff } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useMutation } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import toast from 'react-hot-toast';
import { authApi } from '../../api/endpoints';
import { useAuth } from '../../hooks/useAuth';
import { authUserFromLoginResponse, isTokenExpired } from '../../utils/authToken';

const loginSchema = z.object({
  userName: z.string().min(1, 'Username is required'),
  password: z.string().min(1, 'Password is required'),
});

type LoginFormData = z.infer<typeof loginSchema>;

export const LoginPage: React.FC = () => {
  const navigate = useNavigate();
  const { login } = useAuth();
  const [showPassword, setShowPassword] = useState(false);
  const [rememberMe, setRememberMe] = useState(true);

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<LoginFormData>({
    resolver: zodResolver(loginSchema),
    defaultValues: {
      userName: '',
      password: '',
    },
  });

  const loginMutation = useMutation({
    mutationFn: (data: LoginFormData) => authApi.login(data),
    onSuccess: (response) => {
      if (response.data) {
        const authUser = authUserFromLoginResponse(response.data);
        if (isTokenExpired(authUser.expiresAt)) {
          toast.error('Login token is expired. Please login again.');
          return;
        }
        login(authUser);
        toast.success('Login successful');
        navigate('/dashboard');
      }
    },
  });

  return (
    <main className="min-h-screen bg-white lg:grid lg:grid-cols-[58%_42%]">
      <section className="relative hidden min-h-screen items-center justify-center overflow-hidden bg-[#f5f6ff] p-12 lg:flex">
        <div className="absolute left-12 top-12 h-20 w-20 rounded-full bg-blue-100/60" />
        <div className="absolute bottom-12 right-16 h-32 w-32 rounded-full bg-indigo-100/50" />
        <img
          src="/login-security-illustration.png"
          alt="Professional securely signing in from a workspace"
          className="relative z-10 max-h-[82vh] w-full max-w-[820px] object-contain drop-shadow-[0_24px_55px_rgba(60,85,155,0.12)]"
        />
      </section>

      <section className="flex min-h-screen items-center justify-center px-6 py-10 sm:px-12 lg:px-16">
        <div className="w-full max-w-[500px]">
          <div className="mb-9 text-center">
            <div className="mx-auto mb-5 flex h-24 items-center justify-center">
              <img
                src="/nexoraa-logo.png"
                alt="Nexoraa logo"
                className="h-full max-w-[220px] object-contain"
              />
            </div>
            <h1 className="text-3xl font-bold tracking-tight text-slate-800">Texmitra</h1>
            <p className="mt-3 text-lg tracking-wide text-slate-600">
              Please log in to your account
            </p>
          </div>

          <form onSubmit={handleSubmit((data) => loginMutation.mutate(data))} className="space-y-6">
            <div>
              <label htmlFor="userName" className="mb-2 block text-base font-medium tracking-wide text-slate-700">
                Username
              </label>
              <input
                id="userName"
                autoComplete="username"
                placeholder="Enter your username"
                className={`h-14 w-full rounded-lg border bg-[#eef4ff] px-4 text-lg text-slate-900 outline-none transition focus:border-blue-400 focus:ring-4 focus:ring-blue-100 ${
                  errors.userName ? 'border-red-400' : 'border-slate-200'
                }`}
                {...register('userName')}
              />
              {errors.userName && <p className="mt-1.5 text-sm text-red-500">{errors.userName.message}</p>}
            </div>

            <div>
              <label htmlFor="password" className="mb-2 block text-base font-medium tracking-wide text-slate-700">
                Password
              </label>
              <div className={`flex h-14 overflow-hidden rounded-lg border bg-[#eef4ff] transition focus-within:border-blue-400 focus-within:ring-4 focus-within:ring-blue-100 ${
                errors.password ? 'border-red-400' : 'border-slate-200'
              }`}>
                <input
                  id="password"
                  type={showPassword ? 'text' : 'password'}
                  autoComplete="current-password"
                  placeholder="Enter your password"
                  className="min-w-0 flex-1 bg-transparent px-4 text-lg text-slate-900 outline-none"
                  {...register('password')}
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((visible) => !visible)}
                  className="flex w-14 items-center justify-center border-l border-slate-200 bg-white text-slate-700 transition hover:bg-slate-50"
                  aria-label={showPassword ? 'Hide password' : 'Show password'}
                >
                  {showPassword ? <EyeOff size={21} /> : <Eye size={21} />}
                </button>
              </div>
              {errors.password && <p className="mt-1.5 text-sm text-red-500">{errors.password.message}</p>}
            </div>

            <div className="flex items-center justify-between gap-4 text-sm sm:text-base">
              <label className="flex cursor-pointer items-center gap-3 text-slate-700">
                <input
                  type="checkbox"
                  checked={rememberMe}
                  onChange={(event) => setRememberMe(event.target.checked)}
                  className="peer sr-only"
                />
                <span className="relative h-6 w-11 rounded-full bg-slate-200 transition peer-checked:bg-blue-500 after:absolute after:left-1 after:top-1 after:h-4 after:w-4 after:rounded-full after:bg-white after:shadow after:transition peer-checked:after:translate-x-5" />
                Remember Me
              </label>
              <button
                type="button"
                onClick={() => toast('Please contact your administrator to reset your password.')}
                className="font-medium text-blue-600 transition hover:text-blue-700 hover:underline"
              >
                Forgot Password?
              </button>
            </div>

            <button
              type="submit"
              disabled={loginMutation.isPending}
              className="flex h-14 w-full items-center justify-center rounded-lg bg-[#138dec] text-lg font-semibold text-white shadow-[0_10px_24px_rgba(19,141,236,0.22)] transition hover:bg-[#087ed9] focus:outline-none focus:ring-4 focus:ring-blue-200 disabled:cursor-not-allowed disabled:opacity-70"
            >
              {loginMutation.isPending ? 'Signing in...' : 'Sign in'}
            </button>
          </form>

          <div className="mt-7 text-center text-sm text-slate-500">
            <div className="mt-6 flex items-center justify-center gap-5 text-base font-medium text-blue-600">
              <button type="button" className="hover:underline">🇺🇸 English</button>
              <button type="button" className="hover:underline">🇮🇳 Hindi</button>
              <button type="button" className="hover:underline">🇮🇳 Marathi</button>
            </div>
            <p className="mt-6 tracking-wide text-slate-600">Version: 2.4</p>
          </div>
        </div>
      </section>
    </main>
  );
};
