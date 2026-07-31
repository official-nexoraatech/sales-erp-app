import type { ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { organizationApi } from '../../api/endpoints.js';
import { useAuthStore } from '../../store/auth.store.js';
import { useOrganization } from '../../hooks/useOrganization.js';
import { useObjectUrl } from '../../hooks/useObjectUrl.js';

/** Renders the tenant's uploaded logo (Settings → Organization → Branding) if one exists,
 * falling back to `fallback` (the "N" lettermark) otherwise — used in both sidebar states.
 * Shares the ['organization'] query cache with TenantThemeSync, so this adds only one extra
 * request (the image bytes) beyond what the app already fetches for brand colors. */
export default function TenantLogo({
  className,
  fallback,
}: {
  className?: string;
  fallback: ReactNode;
}) {
  const isAuthenticated = useAuthStore((s) => !!s.accessToken);
  const { data: org } = useOrganization();
  const hasLogo = Boolean(org?.logoObjectKey);

  const { data: blob } = useQuery({
    queryKey: ['organization-logo'],
    queryFn: () => organizationApi.logoBlob(),
    enabled: isAuthenticated && hasLogo,
    staleTime: 60_000,
    retry: false,
  });
  const url = useObjectUrl(blob);

  if (!url) return <>{fallback}</>;
  return <img src={url} alt="" className={className} />;
}
