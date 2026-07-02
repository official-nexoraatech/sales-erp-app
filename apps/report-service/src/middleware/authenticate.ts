import { FastifyRequest, FastifyReply } from 'fastify';
import { createPublicKey } from 'crypto';
import { requireEnv } from '@erp/config';

export interface AuthPayload {
  sub: string;
  tenantId: number;
  email: string;
  roles: string[];
  permissions: string[];
  userId: number;
}

declare module 'fastify' {
  interface FastifyRequest {
    auth: AuthPayload;
  }
}

function base64urlDecode(str: string): Buffer {
  const base64 = str.replace(/-/g, '+').replace(/_/g, '/');
  const padded = base64.padEnd(base64.length + (4 - (base64.length % 4)) % 4, '=');
  return Buffer.from(padded, 'base64');
}

function verifyRS256(token: string, publicKeyPem: string): AuthPayload {
  const parts = token.split('.');
  if (parts.length !== 3) throw new Error('Invalid JWT structure');

  const [headerB64, payloadB64, signatureB64] = parts as [string, string, string];

  const header = JSON.parse(base64urlDecode(headerB64).toString('utf8')) as { alg: string };
  if (header.alg !== 'RS256') throw new Error('Expected RS256 algorithm');

  const { createVerify } = require('crypto') as typeof import('crypto');
  const verifier = createVerify('RSA-SHA256');
  verifier.update(`${headerB64}.${payloadB64}`);
  const sig = base64urlDecode(signatureB64);
  const key = createPublicKey(publicKeyPem);
  const valid = verifier.verify(key, sig);
  if (!valid) throw new Error('Invalid JWT signature');

  const payload = JSON.parse(base64urlDecode(payloadB64).toString('utf8')) as AuthPayload & { exp?: number };
  if (payload.exp && Date.now() / 1000 > payload.exp) throw new Error('Token expired');

  return payload;
}

let cachedPublicKey: string | null = null;

export async function authenticate(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const authHeader = request.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) {
    return reply.code(401).send({ error: { code: 'UNAUTHORIZED', message: 'Missing bearer token' } });
  }
  const token = authHeader.slice(7);
  try {
    if (!cachedPublicKey) {
      cachedPublicKey = requireEnv('JWT_PUBLIC_KEY').replace(/\\n/g, '\n');
    }
    request.auth = verifyRS256(token, cachedPublicKey);
  } catch {
    return reply.code(401).send({ error: { code: 'UNAUTHORIZED', message: 'Invalid or expired token' } });
  }
}
