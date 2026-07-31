import { useMemo, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { portalApiClient, PortalApiError } from '../api/portalApiClient.js';

type Channel = 'SMS' | 'WHATSAPP' | 'EMAIL' | 'IN_APP';
type Category = 'PROMOTIONAL' | 'TRANSACTIONAL';

interface PreferenceRow {
  channel: Channel;
  category: Category;
  consented: boolean;
}

const CHANNELS: Channel[] = ['SMS', 'WHATSAPP', 'EMAIL', 'IN_APP'];
// Transactional (order/ticket updates) is deliberately not offered as a toggle here — same
// distinction the staff-side consent model draws between the two categories; a customer
// opting out of promotional messages should still receive order-status updates.
const CATEGORY: Category = 'PROMOTIONAL';

export function PortalPreferencesPage(): React.ReactElement {
  const queryClient = useQueryClient();
  const { data, isLoading } = useQuery({
    queryKey: ['portal', 'preferences'],
    queryFn: () =>
      portalApiClient.get<{ content: PreferenceRow[] }>('sales', '/portal/preferences'),
  });

  const consentByChannel = useMemo(() => {
    const map = new Map<Channel, boolean>();
    for (const row of data?.content ?? []) {
      if (row.category === CATEGORY) map.set(row.channel, row.consented);
    }
    return map;
  }, [data]);

  const [pending, setPending] = useState<Partial<Record<Channel, boolean>>>({});

  const saveMut = useMutation({
    mutationFn: (preferences: { channel: Channel; category: Category; consented: boolean }[]) =>
      portalApiClient.put('sales', '/portal/preferences', { preferences }),
    onSuccess: () => {
      toast.success('Preferences saved');
      setPending({});
      void queryClient.invalidateQueries({ queryKey: ['portal', 'preferences'] });
    },
    onError: (err) =>
      toast.error(err instanceof PortalApiError ? err.message : 'Could not save preferences'),
  });

  function toggle(channel: Channel): void {
    const current = pending[channel] ?? consentByChannel.get(channel) ?? true;
    setPending((p) => ({ ...p, [channel]: !current }));
  }

  function save(): void {
    const preferences = Object.entries(pending).map(([channel, consented]) => ({
      channel: channel as Channel,
      category: CATEGORY,
      consented: consented!,
    }));
    if (preferences.length === 0) return;
    saveMut.mutate(preferences);
  }

  if (isLoading) return <p className="text-sm text-[var(--text-secondary)]">Loading…</p>;

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold">Preferences</h1>
      <p className="text-sm text-[var(--text-secondary)]">
        Choose which channels we can use to send you promotional offers and updates. You&apos;ll
        still receive order and ticket updates regardless of these settings.
      </p>
      <div className="divide-y divide-[var(--border-default)] rounded-lg border border-[var(--border-default)]">
        {CHANNELS.map((channel) => {
          const consented = pending[channel] ?? consentByChannel.get(channel) ?? true;
          return (
            <label key={channel} className="flex items-center justify-between px-4 py-3 text-sm">
              <span>{channel.replace('_', ' ')}</span>
              <input type="checkbox" checked={consented} onChange={() => toggle(channel)} />
            </label>
          );
        })}
      </div>
      <button
        onClick={save}
        disabled={saveMut.isPending || Object.keys(pending).length === 0}
        className="rounded-md bg-[var(--action-primary,#2563eb)] px-3 py-1.5 text-sm font-medium text-white disabled:opacity-60"
      >
        {saveMut.isPending ? 'Saving…' : 'Save changes'}
      </button>
    </div>
  );
}
