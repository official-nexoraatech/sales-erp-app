export interface UpstreamConfig {
  service: string;
  prefix: string;
  target: string;
  rewritePrefix: string;
}

// Mirrors BASE_URLS in apps/web-frontend/src/api/client.ts. envVar/default follow the
// <SERVICE>_SERVICE_URL convention already used for internal service-to-service calls
// (see INVENTORY_SERVICE_URL etc. in .env.example) rather than introducing a new
// <SERVICE>_UPSTREAM_URL convention.
const UPSTREAM_DEFAULTS: Array<{
  service: string;
  envVar: string;
  default: string;
  apiV2: boolean;
}> = [
  // PG-010: auth/notification/report/scheduler/search flipped to true — these 5 services
  // now register their primary route tree under /api/v2 (legacy unprefixed path stays
  // reachable directly on the service during the deprecation window, but the gateway
  // routes to the new /api/v2 path as the primary path per the versioning convention).
  { service: 'auth', envVar: 'AUTH_SERVICE_URL', default: 'http://localhost:3010', apiV2: true },
  {
    service: 'tenant',
    envVar: 'TENANT_SERVICE_URL',
    default: 'http://localhost:3011',
    apiV2: true,
  },
  {
    service: 'inventory',
    envVar: 'INVENTORY_SERVICE_URL',
    default: 'http://localhost:3012',
    apiV2: true,
  },
  { service: 'sales', envVar: 'SALES_SERVICE_URL', default: 'http://localhost:3013', apiV2: true },
  {
    service: 'notification',
    envVar: 'NOTIFICATION_SERVICE_URL',
    default: 'http://localhost:3014',
    apiV2: true,
  },
  // apiV2: false (unlike the other 11 wrapper-prefixed services) — report-service's
  // analytics/dashboard routes hardcode /api/v2 (and /api/v1, for the two aging reports)
  // directly into their literal route paths rather than via a wrapper prefix; its
  // reportRoutes family is dual-registered both unprefixed and under /api/v2. A gateway
  // rewritePrefix of '/api/v2' would double-prefix the former (see main.ts's own comment
  // on this) — passing the caller's suffix straight through (rewritePrefix: '') is correct
  // for all three of report-service's route families.
  {
    service: 'report',
    envVar: 'REPORT_SERVICE_URL',
    default: 'http://localhost:3015',
    apiV2: false,
  },
  {
    service: 'scheduler',
    envVar: 'SCHEDULER_SERVICE_URL',
    default: 'http://localhost:3016',
    apiV2: true,
  },
  {
    service: 'search',
    envVar: 'SEARCH_SERVICE_URL',
    default: 'http://localhost:3017',
    apiV2: true,
  },
  { service: 'gst', envVar: 'GST_SERVICE_URL', default: 'http://localhost:3018', apiV2: true },
  {
    service: 'accounting',
    envVar: 'ACCOUNTING_SERVICE_URL',
    default: 'http://localhost:3019',
    apiV2: true,
  },
  {
    service: 'purchase',
    envVar: 'PURCHASE_SERVICE_URL',
    default: 'http://localhost:3020',
    apiV2: true,
  },
  { service: 'hr', envVar: 'HR_SERVICE_URL', default: 'http://localhost:3021', apiV2: true },
  {
    service: 'production',
    envVar: 'PRODUCTION_SERVICE_URL',
    default: 'http://localhost:3022',
    apiV2: false,
  },
  { service: 'event', envVar: 'EVENT_SERVICE_URL', default: 'http://localhost:3023', apiV2: false },
];

export interface GatewayConfig {
  port: number;
  allowedOrigins: string[];
  upstreams: UpstreamConfig[];
}

export function loadGatewayConfig(): GatewayConfig {
  return {
    port: parseInt(process.env['API_GATEWAY_PORT'] ?? '3000', 10),
    allowedOrigins: process.env['ALLOWED_ORIGINS']?.split(',') ?? ['http://localhost:3000'],
    upstreams: UPSTREAM_DEFAULTS.map(({ service, envVar, default: def, apiV2 }) => ({
      service,
      prefix: `/api/${service}`,
      target: process.env[envVar] ?? def,
      rewritePrefix: apiV2 ? '/api/v2' : '',
    })),
  };
}
