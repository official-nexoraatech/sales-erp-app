import { useState, type KeyboardEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import toast from 'react-hot-toast';
import { AlertCircle, X, ArrowLeft, CheckCircle2, Building2 } from 'lucide-react';
import { authApi, mfaApi } from '../../api/endpoints.js';
import { ApiError } from '../../api/client.js';
import { useAuthStore } from '../../store/auth.store.js';
import { NAV_GROUPS, getFirstAccessiblePath } from '../../lib/navigation.js';
import Input from '../../components/ui/Input.js';
import PasswordInput from '../../components/ui/PasswordInput.js';
import Button from '../../components/ui/Button.js';
import Checkbox from '../../components/ui/Checkbox.js';
import AuthLayout from '../../components/auth/AuthLayout.js';
import BrandMark from '../../components/marketing/BrandMark.js';

const REMEMBER_KEY = 'erp_remembered_login';

interface RememberedLogin {
  tenantId: number;
  email: string;
  orgName?: string;
}

function readRememberedLogin(): RememberedLogin | null {
  try {
    const raw = localStorage.getItem(REMEMBER_KEY);
    return raw ? (JSON.parse(raw) as RememberedLogin) : null;
  } catch {
    return null;
  }
}

function FormAlert({
  message,
  tone = 'danger',
  onDismiss,
}: {
  message: string;
  tone?: 'danger' | 'warning';
  onDismiss: () => void;
}) {
  const toneClasses =
    tone === 'warning'
      ? 'border-warning bg-warning-bg text-warning-fg'
      : 'border-danger bg-danger-bg text-danger-fg';
  return (
    <div
      role="alert"
      className={`flex items-start gap-2 rounded-lg border px-3 py-2.5 text-sm ${toneClasses}`}
    >
      <AlertCircle
        className={`h-4 w-4 shrink-0 mt-0.5 ${tone === 'warning' ? 'text-warning' : 'text-danger'}`}
      />
      <p className="flex-1">{message}</p>
      <button
        type="button"
        onClick={onDismiss}
        aria-label="Dismiss"
        className="shrink-0 opacity-70 hover:opacity-100"
      >
        <X className="h-4 w-4" />
      </button>
    </div>
  );
}

const emailSchema = z.object({ email: z.string().email('Invalid email') });
type EmailFormData = z.infer<typeof emailSchema>;

const passwordSchema = z.object({ password: z.string().min(1, 'Required') });
type PasswordFormData = z.infer<typeof passwordSchema>;

// Manual fallback — the original combined form, kept as an escape hatch for anyone the
// org-lookup step doesn't work for (lookup outage, an account the lookup can't see yet).
const manualSchema = z.object({
  tenantId: z.coerce.number().int().positive('Required'),
  email: z.string().email('Invalid email'),
  password: z.string().min(1, 'Required'),
});
type ManualFormData = z.infer<typeof manualSchema>;

const mfaSchema = z.object({ code: z.string().min(6, 'Enter the 6-digit code or a backup code') });
type MfaFormData = z.infer<typeof mfaSchema>;

const forgotSchema = z.object({
  tenantId: z.coerce.number().int().positive('Required'),
  email: z.string().email('Invalid email'),
});
type ForgotFormData = z.infer<typeof forgotSchema>;

type TenantOption = { tenantId: number; name: string; slug: string };

function loginErrorMessage(err: unknown): { message: string; tone: 'danger' | 'warning' } {
  if (err instanceof ApiError) {
    if (err.statusCode === 429) {
      return {
        message: err.message || 'Too many attempts. Please try again later.',
        tone: 'warning',
      };
    }
    return { message: err.message || 'Login failed. Please try again.', tone: 'danger' };
  }
  return { message: 'Network error. Please check your connection and try again.', tone: 'danger' };
}

export default function LoginPage() {
  const navigate = useNavigate();
  const { setTokens, setUser } = useAuthStore();
  const remembered = readRememberedLogin();

  const [loading, setLoading] = useState(false);
  const [mfaToken, setMfaToken] = useState<string | null>(null);
  const [view, setView] = useState<
    'email' | 'org-select' | 'password' | 'manual' | 'forgot' | 'forgot-sent'
  >(remembered ? 'password' : 'email');
  const [formError, setFormError] = useState<{
    message: string;
    tone: 'danger' | 'warning';
  } | null>(null);
  const [mfaError, setMfaError] = useState<string | null>(null);
  const [forgotError, setForgotError] = useState<string | null>(null);
  const [capsLockOn, setCapsLockOn] = useState(false);
  const [rememberMe, setRememberMe] = useState(remembered !== null);

  const [orgOptions, setOrgOptions] = useState<TenantOption[]>([]);
  const [resolvedEmail, setResolvedEmail] = useState<string | null>(remembered?.email ?? null);
  const [resolvedTenantId, setResolvedTenantId] = useState<number | null>(
    remembered?.tenantId ?? null
  );
  const [resolvedOrgName, setResolvedOrgName] = useState<string | null>(
    remembered?.orgName ?? null
  );

  const emailForm = useForm<EmailFormData>({
    resolver: zodResolver(emailSchema),
    defaultValues: { email: remembered?.email ?? '' },
  });
  const passwordForm = useForm<PasswordFormData>({ resolver: zodResolver(passwordSchema) });
  const manualForm = useForm<ManualFormData>({
    resolver: zodResolver(manualSchema),
    defaultValues: { tenantId: 1, email: '' },
  });
  const mfaForm = useForm<MfaFormData>({ resolver: zodResolver(mfaSchema) });
  const forgotForm = useForm<ForgotFormData>({
    resolver: zodResolver(forgotSchema),
    defaultValues: { tenantId: 1, email: '' },
  });

  function handlePasswordKeyEvent(e: KeyboardEvent<HTMLInputElement>) {
    setCapsLockOn(e.getModifierState?.('CapsLock') ?? false);
  }

  async function completeLogin(accessToken: string, refreshToken: string): Promise<void> {
    setTokens(accessToken, refreshToken);
    // JWT payload carries roles + permissions (already verified server-side)
    const jwtPayload = JSON.parse(atob(accessToken.split('.')[1]!)) as {
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
    toast.success('Signed in successfully');
    const { hasPermission } = useAuthStore.getState();
    const firstPath = getFirstAccessiblePath(NAV_GROUPS, hasPermission);
    navigate(firstPath ?? '/no-access');
  }

  async function performLogin(email: string, tenantId: number, password: string, orgName?: string) {
    setLoading(true);
    setFormError(null);
    try {
      const res = await authApi.login({ email, password, tenantId });

      if (rememberMe) {
        localStorage.setItem(REMEMBER_KEY, JSON.stringify({ tenantId, email, orgName }));
      } else {
        localStorage.removeItem(REMEMBER_KEY);
      }

      if (res.requiresMFA && res.mfaToken) {
        setMfaToken(res.mfaToken);
        return;
      }
      if (res.accessToken && res.refreshToken) {
        await completeLogin(res.accessToken, res.refreshToken);
      }
    } catch (err: unknown) {
      setFormError(loginErrorMessage(err));
    } finally {
      setLoading(false);
    }
  }

  async function onEmailSubmit(data: EmailFormData) {
    setLoading(true);
    setFormError(null);
    try {
      const res = await authApi.lookupTenants({ email: data.email });
      if (res.tenants.length === 0) {
        setFormError({
          message: "We couldn't find a workspace for that email.",
          tone: 'danger',
        });
        return;
      }
      setResolvedEmail(data.email);
      if (res.tenants.length === 1) {
        setResolvedTenantId(res.tenants[0]!.tenantId);
        setResolvedOrgName(res.tenants[0]!.name);
        setView('password');
      } else {
        setOrgOptions(res.tenants);
        setView('org-select');
      }
    } catch (err: unknown) {
      setFormError(loginErrorMessage(err));
    } finally {
      setLoading(false);
    }
  }

  function onSelectOrg(tenant: TenantOption) {
    setResolvedTenantId(tenant.tenantId);
    setResolvedOrgName(tenant.name);
    setFormError(null);
    setView('password');
  }

  async function onPasswordSubmit(data: PasswordFormData) {
    if (resolvedTenantId === null || !resolvedEmail) return;
    await performLogin(
      resolvedEmail,
      resolvedTenantId,
      data.password,
      resolvedOrgName ?? undefined
    );
  }

  async function onManualSubmit(data: ManualFormData) {
    await performLogin(data.email, data.tenantId, data.password);
  }

  function resetToEmailStep() {
    setResolvedEmail(null);
    setResolvedTenantId(null);
    setResolvedOrgName(null);
    setFormError(null);
    passwordForm.reset();
    setView('email');
  }

  async function onMfaSubmit(data: MfaFormData) {
    if (!mfaToken) return;
    setLoading(true);
    setMfaError(null);
    try {
      const res = await mfaApi.verify({ mfaToken, code: data.code });
      await completeLogin(res.accessToken, res.refreshToken);
    } catch (err: unknown) {
      setMfaError(err instanceof Error ? err.message : 'Invalid or expired code');
    } finally {
      setLoading(false);
    }
  }

  async function onForgotSubmit(data: ForgotFormData) {
    setLoading(true);
    setForgotError(null);
    try {
      await authApi.forgotPassword(data);
      setView('forgot-sent');
    } catch (err: unknown) {
      setForgotError(
        err instanceof Error ? err.message : 'Something went wrong. Please try again.'
      );
    } finally {
      setLoading(false);
    }
  }

  function goToForgot(defaults: { tenantId: number; email: string }) {
    setForgotError(null);
    forgotForm.setValue('email', defaults.email);
    forgotForm.setValue('tenantId', defaults.tenantId);
    setView('forgot');
  }

  if (mfaToken) {
    return (
      <AuthLayout>
        <div className="text-center mb-8">
          <h1 className="text-2xl font-bold text-primary">Two-Factor Verification</h1>
          <p className="text-sm text-secondary mt-1">
            Enter the code from your authenticator app, or a backup code
          </p>
        </div>

        <form onSubmit={mfaForm.handleSubmit(onMfaSubmit)} className="space-y-4">
          {mfaError && <FormAlert message={mfaError} onDismiss={() => setMfaError(null)} />}
          <Input
            label="Authentication Code"
            type="text"
            placeholder="123456"
            autoComplete="one-time-code"
            autoFocus
            {...mfaForm.register('code')}
            error={mfaForm.formState.errors.code?.message}
          />
          <Button type="submit" className="w-full justify-center" loading={loading} size="lg">
            Verify
          </Button>
          <button
            type="button"
            className="w-full text-sm text-secondary hover:text-primary"
            onClick={() => setMfaToken(null)}
          >
            Back to login
          </button>
        </form>
      </AuthLayout>
    );
  }

  if (view === 'forgot-sent') {
    return (
      <AuthLayout>
        <div className="text-center py-4">
          <div className="inline-flex items-center justify-center w-12 h-12 rounded-full bg-success-bg mb-4">
            <CheckCircle2 className="h-6 w-6 text-success" />
          </div>
          <h1 className="text-xl font-bold text-primary mb-2">Check your email</h1>
          <p className="text-sm text-secondary mb-6">
            If an account exists for that email, we&apos;ve sent a link to reset your password.
          </p>
          <Button
            variant="secondary"
            className="w-full justify-center"
            onClick={() => setView(resolvedTenantId !== null ? 'password' : 'email')}
          >
            <ArrowLeft className="h-4 w-4" /> Back to login
          </Button>
        </div>
      </AuthLayout>
    );
  }

  if (view === 'forgot') {
    return (
      <AuthLayout>
        <div className="mb-8">
          <button
            type="button"
            onClick={() => setView(resolvedTenantId !== null ? 'password' : 'email')}
            className="inline-flex items-center gap-1 text-sm text-secondary hover:text-primary mb-4"
          >
            <ArrowLeft className="h-4 w-4" /> Back to login
          </button>
          <h1 className="text-2xl font-bold text-primary">Reset your password</h1>
          <p className="text-sm text-secondary mt-1">
            Enter your tenant ID and email — we&apos;ll send you a reset link.
          </p>
        </div>

        <form onSubmit={forgotForm.handleSubmit(onForgotSubmit)} className="space-y-4">
          {forgotError && (
            <FormAlert message={forgotError} onDismiss={() => setForgotError(null)} />
          )}
          <Input
            label="Tenant ID"
            type="number"
            {...forgotForm.register('tenantId')}
            error={forgotForm.formState.errors.tenantId?.message}
          />
          <Input
            label="Email"
            type="email"
            placeholder="you@example.com"
            autoComplete="email"
            autoFocus
            {...forgotForm.register('email')}
            error={forgotForm.formState.errors.email?.message}
          />
          <Button type="submit" className="w-full justify-center" loading={loading} size="lg">
            Send reset link
          </Button>
        </form>
      </AuthLayout>
    );
  }

  if (view === 'org-select') {
    return (
      <AuthLayout>
        <div className="mb-8">
          <button
            type="button"
            onClick={() => setView('email')}
            className="inline-flex items-center gap-1 text-sm text-secondary hover:text-primary mb-4"
          >
            <ArrowLeft className="h-4 w-4" /> Back
          </button>
          <h1 className="text-2xl font-bold text-primary">Choose a workspace</h1>
          <p className="text-sm text-secondary mt-1">
            {resolvedEmail} has access to more than one workspace.
          </p>
        </div>

        <div className="space-y-2">
          {orgOptions.map((tenant) => (
            <button
              key={tenant.tenantId}
              type="button"
              onClick={() => onSelectOrg(tenant)}
              className="flex w-full items-center gap-3 rounded-lg border border-default px-3 py-2.5 text-left hover:bg-surface-hover"
            >
              <Building2 className="h-4 w-4 shrink-0 text-secondary" />
              <span className="flex-1 text-sm font-medium text-primary">{tenant.name}</span>
            </button>
          ))}
        </div>
      </AuthLayout>
    );
  }

  if (view === 'manual') {
    return (
      <AuthLayout>
        <div className="mb-8">
          <button
            type="button"
            onClick={() => setView('email')}
            className="inline-flex items-center gap-1 text-sm text-secondary hover:text-primary mb-4"
          >
            <ArrowLeft className="h-4 w-4" /> Back
          </button>
          <h1 className="text-2xl font-bold text-primary">Sign in with tenant ID</h1>
          <p className="text-sm text-secondary mt-1">For workspaces the lookup can't find yet</p>
        </div>

        <form onSubmit={manualForm.handleSubmit(onManualSubmit)} className="space-y-4">
          {formError && (
            <FormAlert
              message={formError.message}
              tone={formError.tone}
              onDismiss={() => setFormError(null)}
            />
          )}
          <Input
            label="Tenant ID"
            type="number"
            {...manualForm.register('tenantId')}
            error={manualForm.formState.errors.tenantId?.message}
          />
          <Input
            label="Email"
            type="email"
            placeholder="you@example.com"
            autoComplete="email"
            autoFocus
            {...manualForm.register('email')}
            error={manualForm.formState.errors.email?.message}
          />
          <PasswordInput
            label="Password"
            placeholder="••••••••"
            autoComplete="current-password"
            {...manualForm.register('password')}
            error={manualForm.formState.errors.password?.message}
          />
          <Checkbox
            label="Remember me on this device"
            checked={rememberMe}
            onChange={(e) => setRememberMe(e.target.checked)}
          />
          <Button type="submit" className="w-full justify-center" loading={loading} size="lg">
            Sign In
          </Button>
          <button
            type="button"
            onClick={() =>
              goToForgot({
                tenantId: manualForm.getValues('tenantId') || 1,
                email: manualForm.getValues('email'),
              })
            }
            className="w-full text-sm text-brand hover:underline"
          >
            Forgot password?
          </button>
        </form>
      </AuthLayout>
    );
  }

  if (view === 'password') {
    return (
      <AuthLayout>
        <div className="flex justify-center mb-8 lg:hidden">
          <BrandMark />
        </div>
        <div className="mb-8">
          <h1 className="font-display font-semibold text-2xl text-primary hidden lg:block">
            Welcome back
          </h1>
          <p className="text-sm text-secondary mt-1">
            Signing in as <span className="font-medium text-primary">{resolvedEmail}</span>
            {resolvedOrgName ? (
              <>
                {' '}
                to <span className="font-medium text-primary">{resolvedOrgName}</span>
              </>
            ) : null}
            {' · '}
            <button type="button" onClick={resetToEmailStep} className="text-brand hover:underline">
              Not you?
            </button>
          </p>
        </div>

        <form onSubmit={passwordForm.handleSubmit(onPasswordSubmit)} className="space-y-4">
          {formError && (
            <FormAlert
              message={formError.message}
              tone={formError.tone}
              onDismiss={() => setFormError(null)}
            />
          )}
          <div>
            <div className="flex items-center justify-between">
              <label htmlFor="password" className="text-sm font-medium text-primary">
                Password
              </label>
              <button
                type="button"
                onClick={() =>
                  goToForgot({ tenantId: resolvedTenantId ?? 1, email: resolvedEmail ?? '' })
                }
                className="text-sm text-brand hover:underline"
              >
                Forgot password?
              </button>
            </div>
            <PasswordInput
              id="password"
              placeholder="••••••••"
              autoComplete="current-password"
              wrapperClassName="mt-1"
              autoFocus
              onKeyUp={handlePasswordKeyEvent}
              onKeyDown={handlePasswordKeyEvent}
              {...passwordForm.register('password')}
              error={passwordForm.formState.errors.password?.message}
            />
            {capsLockOn && (
              <p className="flex items-center gap-1 text-xs text-warning mt-1">
                <AlertCircle className="h-3.5 w-3.5" /> Caps Lock is on
              </p>
            )}
          </div>

          <Checkbox
            label="Remember me on this device"
            checked={rememberMe}
            onChange={(e) => setRememberMe(e.target.checked)}
          />

          <Button type="submit" className="w-full justify-center" loading={loading} size="lg">
            Sign In
          </Button>
        </form>
      </AuthLayout>
    );
  }

  // Default: 'email' — first step of the org-lookup flow
  return (
    <AuthLayout>
      <div className="flex justify-center mb-8 lg:hidden">
        <BrandMark />
      </div>
      <div className="mb-8 hidden lg:block">
        <h1 className="font-display font-semibold text-2xl text-primary">Welcome back</h1>
        <p className="text-sm text-secondary mt-1">Sign in to your account</p>
      </div>

      <form onSubmit={emailForm.handleSubmit(onEmailSubmit)} className="space-y-4">
        {formError && (
          <FormAlert
            message={formError.message}
            tone={formError.tone}
            onDismiss={() => setFormError(null)}
          />
        )}
        <Input
          label="Email"
          type="email"
          placeholder="you@example.com"
          autoComplete="email"
          autoFocus
          {...emailForm.register('email')}
          error={emailForm.formState.errors.email?.message}
        />

        <Button type="submit" className="w-full justify-center" loading={loading} size="lg">
          Continue
        </Button>

        <p className="text-center text-sm text-secondary">
          <button
            type="button"
            onClick={() => setView('manual')}
            className="text-brand hover:underline"
          >
            Sign in with a tenant ID instead
          </button>
        </p>

        <p className="text-center text-sm text-secondary">
          New to NEXORAA ERP?{' '}
          <button
            type="button"
            onClick={() => navigate('/signup')}
            className="text-brand hover:underline"
          >
            Create a workspace
          </button>
        </p>
      </form>
    </AuthLayout>
  );
}
