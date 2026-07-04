import React, { useState } from 'react';
import { Eye, EyeOff, Moon, Sun } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useMutation } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import toast from 'react-hot-toast';
import { authApi } from '../../api/endpoints';
import { getDefaultAuthorizedPath } from '../../auth/featurePermissions';
import { useAuth } from '../../hooks/useAuth';
import { authUserFromLoginResponse, isTokenExpired } from '../../utils/authToken';
import { useTheme } from '../../contexts/ThemeContext';
import { usePageTranslation } from '../../hooks/usePageTranslation';
import type { AppLanguage } from '../../hooks/usePageTranslation';

const getStoredLanguage = (): AppLanguage => {
  const language = localStorage.getItem('language');
  return language === 'hi' || language === 'gu' || language === 'mr' || language === 'en' ? language : 'en';
};

const loginSchema = z.object({
  userName: z.string().min(1, 'Username is required'),
  password: z.string().min(1, 'Password is required'),
});

type LoginFormData = z.infer<typeof loginSchema>;

export const LoginPage: React.FC = () => {
  const navigate = useNavigate();
  const { login } = useAuth();
  const { isDark, toggleTheme } = useTheme();
  const [showPassword, setShowPassword] = useState(false);
  const [rememberMe, setRememberMe] = useState(true);
  const [language, setLanguage] = useState<AppLanguage>(getStoredLanguage);

  usePageTranslation(language);

  const changeLanguage = (value: AppLanguage) => {
    setLanguage(value);
    localStorage.setItem('language', value);
  };

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<LoginFormData>({
    resolver: zodResolver(loginSchema),
    defaultValues: { userName: '', password: '' },
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
        navigate(getDefaultAuthorizedPath(authUser.permissions, authUser.role));
      }
    },
  });

  return (
    <main className="relative h-screen overflow-y-auto bg-slate-50 dark:bg-slate-900 lg:grid lg:grid-cols-[58%_42%]">
      {/* Theme toggle — top-right corner */}
      <button
        type="button"
        onClick={toggleTheme}
        className="absolute right-4 top-4 z-10 rounded-lg p-2 text-slate-500 transition hover:bg-slate-200 dark:text-slate-400 dark:hover:bg-slate-700"
        aria-label={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
        title={isDark ? 'Light mode' : 'Dark mode'}
      >
        {isDark ? <Sun size={18} /> : <Moon size={18} />}
      </button>

      {/* ── Left hero panel ── */}
      <section className="relative hidden min-h-screen items-center justify-center overflow-hidden bg-gradient-to-br from-teal-50 via-white to-sky-50 p-12 dark:from-slate-800 dark:via-slate-800 dark:to-slate-900 lg:flex">
        <div className="absolute left-12 top-12 rounded-full border border-teal-200 bg-white/80 px-5 py-2 text-sm font-semibold text-teal-700 shadow-sm dark:border-teal-800 dark:bg-slate-700/80 dark:text-teal-300">
          Textile inventory, billing and stock control
        </div>
        <div className="absolute bottom-12 right-16 rounded-full bg-teal-600 px-5 py-2 text-sm font-semibold text-white shadow-lg dark:bg-teal-700">
          Built for retail and wholesale teams
        </div>
        <img
          src="/texmintra-login-visual.svg"
          alt="Texmintra textile inventory illustration"
          className="relative z-10 max-h-[82vh] w-full max-w-[860px] object-contain drop-shadow-[0_24px_55px_rgba(15,118,110,0.14)] dark:opacity-80"
        />
      </section>

      {/* ── Right login panel ── */}
      <section className="flex min-h-screen items-center justify-center bg-white px-6 py-10 dark:bg-slate-800 sm:px-12 lg:px-16">
        <div className="w-full max-w-[460px]">
          {/* Logo + heading */}
          <div className="mb-8 text-center">
            <div className="mx-auto mb-5 flex h-20 items-center justify-center">
              <img
                src="/texmintra-logo.svg"
                alt="Texmintra logo"
                className="h-full max-w-[240px] object-contain dark:brightness-110"
              />
            </div>
            <h1 className="text-2xl font-bold tracking-tight text-slate-800 dark:text-slate-100">
              Texmintra
            </h1>
            <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">
              Sign in to manage billing, stock and customer orders
            </p>
          </div>

          {/* Form */}
          <form onSubmit={handleSubmit((data) => loginMutation.mutate(data))} className="space-y-5" noValidate>
            {/* Username */}
            <div>
              <label htmlFor="userName" className="mb-1.5 block text-sm font-medium text-slate-700 dark:text-slate-300">
                Username
              </label>
              <input
                id="userName"
                autoComplete="username"
                placeholder="Enter your username"
                aria-invalid={!!errors.userName}
                aria-describedby={errors.userName ? 'userName-error' : undefined}
                className={[
                  'h-12 w-full rounded-xl border bg-slate-50 px-4 text-base text-slate-900 outline-none',
                  'transition focus:ring-4 placeholder:text-slate-400',
                  'dark:bg-slate-700 dark:text-slate-100 dark:placeholder:text-slate-500',
                  errors.userName
                    ? 'border-red-400 focus:border-red-400 focus:ring-red-100 dark:border-red-500 dark:focus:ring-red-900/30'
                    : 'border-slate-200 focus:border-teal-400 focus:ring-teal-100 dark:border-slate-600 dark:focus:border-teal-500 dark:focus:ring-teal-900/30',
                ].join(' ')}
                {...register('userName')}
              />
              {errors.userName && (
                <p id="userName-error" role="alert" className="mt-1.5 text-xs text-red-600 dark:text-red-400">
                  {errors.userName.message}
                </p>
              )}
            </div>

            {/* Password */}
            <div>
              <label htmlFor="password" className="mb-1.5 block text-sm font-medium text-slate-700 dark:text-slate-300">
                Password
              </label>
              <div
                className={[
                  'flex h-12 overflow-hidden rounded-xl border transition',
                  'bg-slate-50 dark:bg-slate-700',
                  errors.password
                    ? 'border-red-400 focus-within:ring-4 focus-within:ring-red-100 dark:border-red-500 dark:focus-within:ring-red-900/30'
                    : 'border-slate-200 focus-within:border-teal-400 focus-within:ring-4 focus-within:ring-teal-100 dark:border-slate-600 dark:focus-within:border-teal-500 dark:focus-within:ring-teal-900/30',
                ].join(' ')}
              >
                <input
                  id="password"
                  type={showPassword ? 'text' : 'password'}
                  autoComplete="current-password"
                  placeholder="Enter your password"
                  aria-invalid={!!errors.password}
                  className="min-w-0 flex-1 bg-transparent px-4 text-base text-slate-900 outline-none dark:text-slate-100 placeholder:text-slate-400 dark:placeholder:text-slate-500"
                  {...register('password')}
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((v) => !v)}
                  className="flex w-12 shrink-0 items-center justify-center border-l border-slate-200 bg-white text-slate-500 transition hover:bg-slate-50 hover:text-slate-700 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-400 dark:hover:bg-slate-700 dark:hover:text-slate-200"
                  aria-label={showPassword ? 'Hide password' : 'Show password'}
                >
                  {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                </button>
              </div>
              {errors.password && (
                <p role="alert" className="mt-1.5 text-xs text-red-600 dark:text-red-400">
                  {errors.password.message}
                </p>
              )}
            </div>

            {/* Remember me + forgot password */}
            <div className="flex items-center justify-between gap-4 text-sm">
              <label className="relative flex cursor-pointer items-center gap-3 text-slate-600 dark:text-slate-400">
                <input
                  type="checkbox"
                  checked={rememberMe}
                  onChange={(e) => setRememberMe(e.target.checked)}
                  className="peer sr-only"
                />
                <span className="relative h-6 w-11 rounded-full bg-slate-200 transition peer-checked:bg-teal-500 after:absolute after:left-1 after:top-1 after:h-4 after:w-4 after:rounded-full after:bg-white after:shadow after:transition peer-checked:after:translate-x-5 dark:bg-slate-600 dark:peer-checked:bg-teal-600" />
                Remember me
              </label>
              <button
                type="button"
                onClick={() => toast('Please contact your administrator to reset your password.')}
                className="font-medium text-teal-700 transition hover:text-teal-800 hover:underline dark:text-teal-400 dark:hover:text-teal-300"
              >
                Forgot password?
              </button>
            </div>

            {/* Submit */}
            <button
              type="submit"
              disabled={loginMutation.isPending}
              className="flex h-12 w-full items-center justify-center rounded-xl bg-teal-600 text-base font-semibold text-white shadow-lg shadow-teal-500/20 transition hover:bg-teal-700 focus:outline-none focus:ring-4 focus:ring-teal-200 disabled:cursor-not-allowed disabled:opacity-60 dark:bg-teal-700 dark:hover:bg-teal-600 dark:shadow-teal-900/40 dark:focus:ring-teal-800"
            >
              {loginMutation.isPending ? (
                <span className="flex items-center gap-2">
                  <svg className="h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                  </svg>
                  Signing in…
                </span>
              ) : (
                'Sign in'
              )}
            </button>
          </form>

          {/* Footer links */}
          <div className="mt-7 text-center">
            <div className="flex items-center justify-center gap-5 text-sm font-medium text-teal-700 dark:text-teal-400">
              <button
                type="button"
                onClick={() => changeLanguage('en')}
                className={`hover:underline ${language === 'en' ? 'font-bold underline' : ''}`}
              >
                English
              </button>
              <button
                type="button"
                onClick={() => changeLanguage('hi')}
                className={`hover:underline ${language === 'hi' ? 'font-bold underline' : ''}`}
              >
                Hindi
              </button>
              <button
                type="button"
                onClick={() => changeLanguage('mr')}
                className={`hover:underline ${language === 'mr' ? 'font-bold underline' : ''}`}
              >
                Marathi
              </button>
            </div>
            <p className="mt-4 text-xs tracking-wide text-slate-400 dark:text-slate-500">Version 2.4</p>
          </div>
        </div>
      </section>
    </main>
  );
};
