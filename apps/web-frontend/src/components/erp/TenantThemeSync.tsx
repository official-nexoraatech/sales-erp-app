import { useEffect, useRef } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { organizationApi } from '../../api/endpoints.js';
import { useAuthStore } from '../../store/auth.store.js';
import { ApiError } from '../../api/client.js';
import { shiftLightness } from '../../lib/colorShade.js';

interface ThemeConfig {
  brandPrimary?: string;
  brandSecondary?: string;
  brandAccent?: string;
  fontSans?: string;
  radiusScale?: 'sharp' | 'default' | 'rounded';
}

const CHANNEL_NAME = 'nexoraa-tenant-theme';
const BRAND_VARS = ['--brand-primary', '--brand-primary-hover', '--brand-primary-active', '--brand-primary-subtle', '--brand-secondary', '--brand-accent', '--font-sans'] as const;

function applyThemeConfig(config: ThemeConfig | undefined): void {
  const html = document.documentElement;
  const root = html.style;
  // Always start from a clean slate — a tenant that removes an override (empty string
  // from the color input, or clears the field) must fall back to the token default, not
  // keep stale inline overrides that would otherwise out-rank the .dark/.hc cascade.
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
  if (config.fontSans) root.setProperty('--font-sans', `'${config.fontSans}', system-ui, sans-serif`);
  // 'default' needs no attribute — packages/design-tokens/tokens.css's --radius-multiplier
  // already defaults to 1 with no [data-radius-scale] selector required.
  if (config.radiusScale && config.radiusScale !== 'default') {
    html.setAttribute('data-radius-scale', config.radiusScale);
  }
}

/**
 * Applies the logged-in tenant's brand color/font/radius overrides live, app-wide, with no
 * reload — ERP-PLANNING/05_ERP_THEME_SYSTEM.md §4 (tenant branding) and §9 (the dynamic
 * update guarantee: change it in Settings, every open tab picks it up instantly).
 * Mount once, inside the authenticated shell (Layout.tsx) — never on the login page.
 */
export default function TenantThemeSync(): null {
  const isAuthenticated = useAuthStore((s) => !!s.accessToken);
  const qc = useQueryClient();
  const channelRef = useRef<BroadcastChannel | null>(null);

  const { data } = useQuery({
    queryKey: ['organization'],
    queryFn: async () => {
      try {
        return await organizationApi.get();
      } catch (err) {
        if (err instanceof ApiError && err.statusCode === 404) return null;
        throw err;
      }
    },
    enabled: isAuthenticated,
    staleTime: 60_000,
  });

  useEffect(() => {
    const themeConfig = (data as { themeConfig?: ThemeConfig } | null)?.themeConfig;
    applyThemeConfig(themeConfig);
  }, [data]);

  // Cross-tab sync: when a Settings save invalidates ['organization'] in one tab, that
  // tab's own useQuery re-fetches and re-applies automatically — this channel is only for
  // *other* open tabs of the same tenant, which otherwise wouldn't know anything changed.
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

/** Call after a successful organization-settings save so other open tabs pick it up. */
export function broadcastTenantThemeChange(): void {
  if (typeof BroadcastChannel === 'undefined') return;
  const channel = new BroadcastChannel(CHANNEL_NAME);
  channel.postMessage('theme-updated');
  channel.close();
}
