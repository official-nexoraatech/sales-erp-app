import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { ShieldCheck, ShieldOff, Smartphone, Monitor } from 'lucide-react';
import { authApi, mfaApi, sessionsApi } from '../../api/endpoints.js';
import { useAuthStore } from '../../store/auth.store.js';
import ERPPageHeader from '../../components/erp/ERPPageHeader.js';
import Input from '../../components/ui/Input.js';
import Button from '../../components/ui/Button.js';
import { ERPFormSkeleton } from '../../components/erp/ERPSkeleton.js';
import ERPEmptyState from '../../components/erp/ERPEmptyState.js';
import { formatDate } from '../../lib/format.js';

interface Session {
  id: string;
  deviceInfo: string | null;
  ipAddress: string;
  createdAt: string;
  lastSeenAt: string;
  refreshTokenId: number | null;
}

export default function SecuritySettingsPage() {
  const qc = useQueryClient();
  const user = useAuthStore((s) => s.user);
  const setUser = useAuthStore((s) => s.setUser);
  const [enrollment, setEnrollment] = useState<{
    qrCodeDataUrl: string;
    backupCodes: string[];
  } | null>(null);
  const [showDisableForm, setShowDisableForm] = useState(false);

  async function refreshUser(): Promise<void> {
    if (!user) return;
    const me = await authApi.me();
    setUser({ ...user, ...(me as object) } as Parameters<typeof setUser>[0]);
  }

  const confirmForm = useForm<{ code: string }>();
  const disableForm = useForm<{ code: string; password: string }>();

  const { data: sessionsData, isLoading: sessionsLoading } = useQuery({
    queryKey: ['auth-sessions'],
    queryFn: () => sessionsApi.list(),
  });
  const sessions = (sessionsData as unknown as Session[]) ?? [];

  const enrollMutation = useMutation({
    mutationFn: () => mfaApi.enroll(),
    onSuccess: (data) =>
      setEnrollment(data as unknown as { qrCodeDataUrl: string; backupCodes: string[] }),
    onError: (err: Error) => toast.error(err.message),
  });

  const confirmMutation = useMutation({
    mutationFn: (code: string) => mfaApi.confirm({ code }),
    onSuccess: async () => {
      toast.success('Two-factor authentication enabled');
      setEnrollment(null);
      confirmForm.reset();
      await refreshUser();
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const disableMutation = useMutation({
    mutationFn: (data: { code: string; password: string }) => mfaApi.disable(data),
    onSuccess: async () => {
      toast.success('Two-factor authentication disabled');
      setShowDisableForm(false);
      disableForm.reset();
      await refreshUser();
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const terminateMutation = useMutation({
    mutationFn: (sessionId: string) => sessionsApi.terminate(sessionId),
    onSuccess: () => {
      toast.success('Session terminated');
      void qc.invalidateQueries({ queryKey: ['auth-sessions'] });
    },
    onError: (err: Error) => toast.error(err.message),
  });

  async function terminateAllOthers(): Promise<void> {
    const others = sessions.filter((s) => s.id !== sessions[0]?.id);
    for (const s of others) {
      await sessionsApi.terminate(s.id);
    }
    toast.success('All other sessions terminated');
    void qc.invalidateQueries({ queryKey: ['auth-sessions'] });
  }

  return (
    <div className="space-y-6">
      <ERPPageHeader
        variant="list"
        title="Security Settings"
        subtitle="Manage two-factor authentication and active sessions."
      />

      {/* 2FA Section */}
      <div className="card p-6 max-w-2xl">
        <div className="flex items-start justify-between">
          <div className="flex items-start gap-3">
            {user?.totpEnabled ? (
              <ShieldCheck className="text-green-600 mt-0.5" size={20} />
            ) : (
              <ShieldOff className="text-secondary mt-0.5" size={20} />
            )}
            <div>
              <h3 className="text-sm font-semibold text-primary">Two-Factor Authentication</h3>
              <p className="text-sm text-secondary mt-1">
                {user?.totpEnabled
                  ? 'Enabled — your account is protected with an authenticator app.'
                  : 'Add an extra layer of security using an authenticator app (Google Authenticator, Authy, etc).'}
              </p>
            </div>
          </div>
          {!user?.totpEnabled && !enrollment && (
            <Button
              size="sm"
              onClick={() => enrollMutation.mutate()}
              loading={enrollMutation.isPending}
            >
              Enable 2FA
            </Button>
          )}
          {user?.totpEnabled && !showDisableForm && (
            <Button size="sm" variant="danger-outline" onClick={() => setShowDisableForm(true)}>
              Disable 2FA
            </Button>
          )}
        </div>

        {enrollment && (
          <div className="mt-6 border-t border-default pt-6 space-y-4">
            <div className="flex flex-col items-center gap-3">
              <img
                src={enrollment.qrCodeDataUrl}
                alt="2FA QR code"
                className="w-48 h-48 rounded-lg border border-default"
              />
              <p className="text-xs text-secondary text-center max-w-sm">
                Scan this QR code with your authenticator app, then enter the 6-digit code below to
                confirm.
              </p>
            </div>

            <div className="bg-surface-hover rounded-lg p-4">
              <p className="text-xs font-semibold text-primary mb-2">
                Backup Codes — save these somewhere safe, each works once
              </p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 font-mono text-xs text-secondary">
                {enrollment.backupCodes.map((code) => (
                  <span key={code}>{code}</span>
                ))}
              </div>
            </div>

            <form
              onSubmit={confirmForm.handleSubmit((d) => confirmMutation.mutate(d.code))}
              className="flex items-end gap-3"
            >
              <div className="flex-1">
                <Input
                  label="Confirmation Code"
                  placeholder="123456"
                  {...confirmForm.register('code', { required: true })}
                />
              </div>
              <Button type="submit" loading={confirmMutation.isPending}>
                Confirm
              </Button>
            </form>
          </div>
        )}

        {showDisableForm && (
          <form
            onSubmit={disableForm.handleSubmit((d) => disableMutation.mutate(d))}
            className="mt-6 border-t border-default pt-6 flex flex-col gap-3 max-w-sm"
          >
            <Input
              label="Authentication Code"
              placeholder="123456 or backup code"
              {...disableForm.register('code', { required: true })}
            />
            <Input
              label="Password"
              type="password"
              autoComplete="current-password"
              {...disableForm.register('password', { required: true })}
            />
            <div className="flex gap-2">
              <Button type="submit" variant="danger" loading={disableMutation.isPending}>
                Confirm Disable
              </Button>
              <Button type="button" variant="ghost" onClick={() => setShowDisableForm(false)}>
                Cancel
              </Button>
            </div>
          </form>
        )}
      </div>

      {/* Active Sessions Section */}
      <div className="card p-6 max-w-2xl">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-sm font-semibold text-primary">Active Sessions</h3>
          {sessions.length > 1 && (
            <Button size="sm" variant="secondary" onClick={() => void terminateAllOthers()}>
              Terminate All Other Sessions
            </Button>
          )}
        </div>

        {sessionsLoading ? (
          <ERPFormSkeleton />
        ) : sessions.length === 0 ? (
          <ERPEmptyState
            type="no-results"
            title="No active sessions"
            description="Sessions will appear here after you sign in."
          />
        ) : (
          <div className="divide-y divide-border">
            {sessions.map((session) => (
              <div key={session.id} className="flex items-center justify-between py-3">
                <div className="flex items-center gap-3">
                  {session.deviceInfo?.includes('Mobile') ? (
                    <Smartphone size={18} className="text-secondary" />
                  ) : (
                    <Monitor size={18} className="text-secondary" />
                  )}
                  <div>
                    <p className="text-sm text-primary">{session.deviceInfo ?? 'Unknown device'}</p>
                    <p className="text-xs text-secondary">
                      {session.ipAddress} — last seen {formatDate(session.lastSeenAt)}
                    </p>
                  </div>
                </div>
                <Button
                  size="sm"
                  variant="danger-outline"
                  loading={
                    terminateMutation.isPending && terminateMutation.variables === session.id
                  }
                  onClick={() => terminateMutation.mutate(session.id)}
                >
                  Terminate
                </Button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
