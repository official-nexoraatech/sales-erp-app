import type { FastifyReply } from 'fastify';
import type { AuthConfig } from './config.js';

// Scoped broadly to /api/auth (the path web-frontend/pos-frontend see through the
// gateway) rather than the narrower /api/auth/auth/refresh, so the browser also
// attaches it to /api/auth/auth/logout — logout needs to read the same cookie.
// httpOnly means it's never readable by JS (the whole point: an XSS payload can no
// longer exfiltrate a long-lived refresh token out of localStorage), and SameSite
// 'strict' means the browser withholds it on any cross-site request, which is what
// makes it safe to rely on for authentication without a separate CSRF token scheme —
// a third-party page cannot get this cookie attached to a request it triggers.
export const REFRESH_COOKIE_NAME = 'refresh_token';
const REFRESH_COOKIE_PATH = '/api/auth';

export function setRefreshCookie(
  reply: FastifyReply,
  refreshToken: string,
  config: AuthConfig
): void {
  void reply.setCookie(REFRESH_COOKIE_NAME, refreshToken, {
    httpOnly: true,
    secure: config.nodeEnv === 'production',
    sameSite: 'strict',
    path: REFRESH_COOKIE_PATH,
    maxAge: config.jwtRefreshTokenTtlDays * 24 * 60 * 60,
  });
}

export function clearRefreshCookie(reply: FastifyReply): void {
  void reply.clearCookie(REFRESH_COOKIE_NAME, { path: REFRESH_COOKIE_PATH });
}
