import { SignJWT, jwtVerify, importPKCS8, importSPKI } from 'jose';
import type { KeyLike } from 'jose';

export interface AccessTokenPayload {
  sub: string;
  tenantId: number;
  email: string;
  roles: string[];
  permissions: string[];
}

export interface JwtConfig {
  privateKeyPem: string;
  publicKeyPem: string;
  issuer: string;
  accessTokenTtlSeconds: number;
}

let _privateKey: KeyLike | null = null;
let _publicKey: KeyLike | null = null;
let _config: JwtConfig | null = null;

export async function initializeJwt(config: JwtConfig): Promise<void> {
  _privateKey = await importPKCS8(config.privateKeyPem, 'RS256');
  _publicKey = await importSPKI(config.publicKeyPem, 'RS256');
  _config = config;
}

export async function signAccessToken(payload: AccessTokenPayload): Promise<string> {
  if (!_privateKey || !_config) throw new Error('JWT not initialized');

  return new SignJWT({
    tenantId: payload.tenantId,
    email: payload.email,
    roles: payload.roles,
    permissions: payload.permissions,
  })
    .setProtectedHeader({ alg: 'RS256' })
    .setSubject(payload.sub)
    .setIssuedAt()
    .setIssuer(_config.issuer)
    .setExpirationTime(`${_config.accessTokenTtlSeconds}s`)
    .sign(_privateKey);
}

export async function verifyAccessToken(token: string): Promise<AccessTokenPayload & { iat: number; exp: number }> {
  if (!_publicKey || !_config) throw new Error('JWT not initialized');

  const { payload } = await jwtVerify(token, _publicKey, {
    issuer: _config.issuer,
    algorithms: ['RS256'],
  });

  return {
    sub: payload.sub as string,
    tenantId: payload['tenantId'] as number,
    email: payload['email'] as string,
    roles: payload['roles'] as string[],
    permissions: payload['permissions'] as string[],
    iat: payload.iat as number,
    exp: payload.exp as number,
  };
}
