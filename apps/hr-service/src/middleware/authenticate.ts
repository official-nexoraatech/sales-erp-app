import { jwtVerify, importSPKI } from 'jose';
import type { FastifyRequest, FastifyReply } from 'fastify';

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

export async function authenticate(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const authHeader = request.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) {
    await reply.code(401).send({ error: { code: 'UNAUTHORIZED', message: 'Missing or invalid Authorization header' } });
    return;
  }

  const token = authHeader.slice(7);
  try {
    const publicKeyPem = process.env['JWT_PUBLIC_KEY'];
    if (!publicKeyPem) throw new Error('JWT_PUBLIC_KEY not configured');
    const publicKey = await importSPKI(publicKeyPem.replace(/\\n/g, '\n'), 'RS256');
    const { payload } = await jwtVerify(token, publicKey, { algorithms: ['RS256'] });
    request.auth = {
      sub: payload.sub as string,
      tenantId: payload['tenantId'] as number,
      email: payload['email'] as string,
      roles: (payload['roles'] as string[]) ?? [],
      permissions: (payload['permissions'] as string[]) ?? [],
      userId: parseInt(payload.sub as string, 10),
    };
  } catch {
    await reply.code(401).send({ error: { code: 'UNAUTHORIZED', message: 'Invalid or expired token' } });
  }
}
