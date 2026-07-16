import { useEffect, useRef } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { authFetch, getAccessToken } from '../../auth.js';
import { shiftLightness } from '../../lib/colorShade.js';

// Routed through api-gateway rather than calling tenant-service directly by port — see
// apps/web-frontend/src/api/client.ts's header comment for why.
const TENANT_API = import.meta.env['VITE_TENANT_API_URL'] ?? 'http://localhost:3000/api/tenant';

interface ThemeConfig {
  brandPrimary?: string;
  brandSecondary?: string;
  brandAccent?: string;
  fontSans?: string;
  radiusScale?: 'sharp' | 'default' | 'rounded';
}

const CHANNEL_NAME = 'nexoraa-tenant-theme';
const BRAND_VARS = [
  '--brand-primary',
  '--brand-primary-hover',
  '--brand-primary-active',
  '--brand-primary-subtle',
  '--brand-secondary',
  '--brand-accent',
  '--font-sans',
] as const;

function applyThemeConfig(config: ThemeConfig | undefined): void {
  const html = document.documentElement;
  const root = html.style;
  for (const v of BRAND_VARS) root.removeProperty(v);
  html.removeAttribute('data-radius-scale');
  if (!config) return;

  if (config.brandPrimary) {
    root.setProperty('--brand-primary', config.brandPrimary);
    root.setProperty('--brand-primary-hover', shiftLightness(config.brandPrimary, -8));
    root.setProperty('--brand-primary-active', shiftLightness(config.brandPrimary, -15));
    root.setProperty('--brand-primary-subtle', shiftLightness(config.brandPrimary, 42));
  }
  if (config.brandSecondary) root.setProperty('--brand-secondary', config.brandSecondary);
  if (config.brandAccent) root.setProperty('--brand-accent', config.brandAccent);
  if (config.fontSans)
    root.setProperty('--font-sans', `'${config.fontSans}', system-ui, sans-serif`);
  if (config.radiusScale && config.radiusScale !== 'default') {
    html.setAttribute('data-radius-scale', config.radiusScale);
  }
}

async function fetchOrganization(): Promise<{ themeConfig?: ThemeConfig } | null> {
  const res = await authFetch(`${TENANT_API}/organization`);
  if (res.status === 404) return null;
  if (!res.ok) throw new Error('Failed to load organization settings');
  const body = (await res.json()) as { data: { themeConfig?: ThemeConfig } };
  return body.data;
}

/**
 * POS counterpart to apps/web-frontend/src/components/erp/TenantThemeSync.tsx — same
 * brand color/font application, same `BroadcastChannel` name. Note this does NOT sync
 * live between web-frontend and POS: `BroadcastChannel` is scoped to same-origin tabs
 * only, and these are two separate apps on separate origins/ports. It syncs multiple open
 * *POS* tabs with each other. A branding change made in the desktop ERP's Settings page
 * (POS has no Settings UI of its own — ERP-PLANNING/02_ERP_NAVIGATION_ARCHITECTURE.md §16)
 * reaches an open POS terminal on next `staleTime` refetch (60s) or page reload, not
 * instantly — an honest limitation of the two-origin architecture, not a bug to fix here.
 * Mount once, inside the authenticated shell only (never on /login).
 */
export default function TenantThemeSync(): null {
  const isAuthenticated = !!getAccessToken();
  const qc = useQueryClient();
  const channelRef = useRef<BroadcastChannel | null>(null);

  const { data } = useQuery({
    queryKey: ['organization'],
    queryFn: fetchOrganization,
    enabled: isAuthenticated,
    staleTime: 60_000,
  });

  useEffect(() => {
    applyThemeConfig(data?.themeConfig);
  }, [data]);

  useEffect(() => {
    if (!isAuthenticated || typeof BroadcastChannel === 'undefined') return undefined;
    const channel = new BroadcastChannel(CHANNEL_NAME);
    channelRef.current = channel;
    channel.onmessage = () => {
      void qc.invalidateQueries({ queryKey: ['organization'] });
    };
    return () => channel.close();
  }, [isAuthenticated, qc]);

  return null;
}
