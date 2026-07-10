// PG-012 regression guard: createTenantContextMiddleware sat exported-but-unregistered
// for an entire phase (ES-21) before anyone noticed — this test exists so that class of
// bug can't silently reappear if a future refactor removes assertTenantActive() from a
// service's authenticate.ts without anyone noticing until a suspended tenant reports they
// can still use the app.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '../../../..');

// Every backend service except api-gateway (still an unimplemented stub — see PG-001;
// it will need this wiring added as part of that package, not this one).
const SERVICES = [
  'auth-service',
  'tenant-service',
  'sales-service',
  'purchase-service',
  'inventory-service',
  'production-service',
  'accounting-service',
  'gst-service',
  'hr-service',
  'event-service',
  'notification-service',
  'scheduler-service',
  'search-service',
  'report-service',
];

describe('PG-012 — tenant-suspension enforcement registration', () => {
  it.each(SERVICES)('%s calls assertTenantActive() in its authenticate middleware', (service) => {
    const path = resolve(REPO_ROOT, 'apps', service, 'src', 'middleware', 'authenticate.ts');
    const contents = readFileSync(path, 'utf-8');
    expect(contents).toContain('assertTenantActive(');
  });

  it.each(SERVICES)('%s calls initTenantStatusEnforcement() at bootstrap', (service) => {
    const path = resolve(REPO_ROOT, 'apps', service, 'src', 'main.ts');
    const contents = readFileSync(path, 'utf-8');
    expect(contents).toContain('initTenantStatusEnforcement(');
  });
});
