import { useQuery } from '@tanstack/react-query';
import { organizationApi } from '../api/endpoints.js';
import { ApiError } from '../api/client.js';
import { useAuthStore } from '../store/auth.store.js';

export interface OrganizationSettings {
  themeConfig?: {
    brandPrimary?: string;
    brandSecondary?: string;
    brandAccent?: string;
    fontSans?: string;
    radiusScale?: 'sharp' | 'default' | 'rounded';
  };
  logoObjectKey?: string | null;
  [key: string]: unknown;
}

/** Shared ['organization'] query — used by TenantThemeSync (brand colors) and TenantLogo
 * (uploaded logo), so both read the same cache entry instead of each defining their own
 * 404-handling copy of the same fetch. */
export function useOrganization() {
  const isAuthenticated = useAuthStore((s) => !!s.accessToken);
  return useQuery({
    queryKey: ['organization'],
    queryFn: async (): Promise<OrganizationSettings | null> => {
      try {
        return (await organizationApi.get()) as OrganizationSettings;
      } catch (err) {
        if (err instanceof ApiError && err.statusCode === 404) return null;
        throw err;
      }
    },
    enabled: isAuthenticated,
    staleTime: 60_000,
  });
}
