/* global process */
import { jwtVerify, importSPKI } from 'jose';
import { PERMISSIONS } from '@erp/types';

export interface AuthPayload {
  sub: string;
  tenantId: number;
  email: string;
  roles: string[];
  permissions: string[];
  branchIds: number[];
  userId: number;
}

export class AuthTokenError extends Error {}

// Verifies an RS256-signed access token and decodes it into the shape every service's
// `request.auth` carries. Framework-agnostic (no Fastify import) so this SDK doesn't take
// a hard dependency on Fastify's types — each service's own middleware/authenticate.ts
// wraps this with its Fastify request/reply handling and `declare module 'fastify'`
// augmentation.
export async function verifyAccessToken(token: string): Promise<AuthPayload> {
  const publicKeyPem = process.env['JWT_PUBLIC_KEY'];
  if (!publicKeyPem) throw new AuthTokenError('JWT_PUBLIC_KEY not configured');
  const publicKey = await importSPKI(publicKeyPem.replace(/\\n/g, '\n'), 'RS256');
  const { payload } = await jwtVerify(token, publicKey, { algorithms: ['RS256'] });
  return {
    sub: payload.sub as string,
    tenantId: payload['tenantId'] as number,
    email: payload['email'] as string,
    roles: (payload['roles'] as string[]) ?? [],
    permissions: (payload['permissions'] as string[]) ?? [],
    branchIds: (payload['branchIds'] as number[]) ?? [],
    userId: parseInt(payload.sub as string, 10),
  };
}

export type BranchScope = number[] | 'all';

// Decides whether a caller is restricted to their assigned branches or can see every
// branch's data in the tenant. Bypasses restriction when the caller holds
// BRANCH_SCOPE_BYPASS (OWNER/ADMIN/SUPER_ADMIN get this automatically via their full
// permission set) or has no branch assignments at all — the latter keeps single-branch
// tenants and not-yet-branch-assigned users working exactly as before this feature
// existed, rather than silently locking them out of everything.
export function getBranchScope(auth: { permissions: string[]; branchIds: number[] }): BranchScope {
  if (auth.permissions.includes(PERMISSIONS.BRANCH_SCOPE_BYPASS)) return 'all';
  if (auth.branchIds.length === 0) return 'all';
  return auth.branchIds;
}

export type PermissionCheckResult = 'ok' | 'unauthenticated' | 'forbidden';

// Pure decision function behind every service's requirePermission() preHandler — kept
// separate from the actual Fastify preHandler so the authorization decision itself is
// unit-testable without spinning up a Fastify request/reply pair.
export function checkPermission(
  auth: { permissions: string[] } | undefined,
  permission: string
): PermissionCheckResult {
  if (!auth) return 'unauthenticated';
  return auth.permissions.includes(permission) ? 'ok' : 'forbidden';
}
