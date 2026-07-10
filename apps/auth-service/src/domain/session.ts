import { eq } from 'drizzle-orm';
import { refreshTokens, activeSessions } from '@erp/db';
import type { ErpDatabase } from '@erp/db';
import { signAccessToken, type AccessTokenPayload } from '../jwt.js';
import { generateSecureToken, sha256Hex } from '../crypto.js';
import type { AuthConfig } from '../config.js';
import { inetParam } from '../db-helpers.js';

export interface IssuedTokens {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
  tokenType: 'Bearer';
}

export interface RequestContext {
  ip: string;
  userAgent: string | null;
}

// Issues a fresh access+refresh token pair, then records a new active_sessions row
// tied to the new refresh token (used at login and after a successful MFA challenge).
export async function issueTokensAndSession(
  db: ErpDatabase,
  config: AuthConfig,
  payload: AccessTokenPayload,
  ctx: RequestContext
): Promise<IssuedTokens> {
  const accessToken = await signAccessToken(payload);

  const plainRefreshToken = generateSecureToken(32);
  const tokenHash = sha256Hex(plainRefreshToken);
  const expiresAt = new Date(Date.now() + config.jwtRefreshTokenTtlDays * 24 * 60 * 60 * 1000);
  const userId = Number(payload.sub);

  const [refreshTokenRow] = await db
    .insert(refreshTokens)
    .values({
      userId,
      tenantId: payload.tenantId,
      tokenHash,
      expiresAt,
      userAgent: ctx.userAgent,
      ipAddress: ctx.ip,
    })
    .returning();

  if (refreshTokenRow) {
    await db.insert(activeSessions).values({
      tenantId: payload.tenantId,
      userId,
      deviceInfo: ctx.userAgent,
      ipAddress: inetParam(ctx.ip),
      refreshTokenId: refreshTokenRow.id,
    });
  }

  return {
    accessToken,
    refreshToken: plainRefreshToken,
    expiresIn: config.jwtAccessTokenTtl,
    tokenType: 'Bearer',
  };
}

// Re-points the active_sessions row that belonged to the just-rotated refresh token
// at the newly issued one, so "Active Sessions" reflects one entry per device/login,
// not a new row on every silent token refresh.
export async function rotateSession(
  db: ErpDatabase,
  oldRefreshTokenId: number,
  newRefreshTokenId: number,
  ctx: RequestContext
): Promise<void> {
  const [existing] = await db
    .select()
    .from(activeSessions)
    .where(eq(activeSessions.refreshTokenId, oldRefreshTokenId))
    .limit(1);

  if (existing) {
    await db
      .update(activeSessions)
      .set({ refreshTokenId: newRefreshTokenId, lastSeenAt: new Date(), ipAddress: inetParam(ctx.ip) })
      .where(eq(activeSessions.id, existing.id));
  }
}
