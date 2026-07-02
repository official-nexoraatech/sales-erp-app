/**
 * Shared HTTP security configuration for all Fastify services.
 * Provides helmet options + Permissions-Policy header that helmet does not set.
 *
 * @fastify/helmet sets: CSP, HSTS, X-Frame-Options, X-Content-Type-Options,
 *   Referrer-Policy, X-DNS-Prefetch-Control, Cross-Origin-* headers.
 * This config enables full A+ security posture for API-only services.
 */

export const HELMET_OPTIONS = {
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'"],
      styleSrc: ["'self'"],
      imgSrc: ["'self'", 'data:'],
      connectSrc: ["'self'"],
      fontSrc: ["'self'"],
      objectSrc: ["'none'"],
      mediaSrc: ["'none'"],
      frameSrc: ["'none'"],
      baseUri: ["'self'"],
      formAction: ["'self'"],
    },
  },
  hsts: {
    maxAge: 63072000, // 2 years
    includeSubDomains: true,
    preload: true,
  },
  frameguard: { action: 'deny' as const },
  referrerPolicy: { policy: 'strict-origin-when-cross-origin' as const },
  crossOriginEmbedderPolicy: { policy: 'require-corp' as const },
  crossOriginOpenerPolicy: { policy: 'same-origin' as const },
  crossOriginResourcePolicy: { policy: 'same-origin' as const },
} as const;

/** Value for the Permissions-Policy response header (not set by @fastify/helmet). */
export const PERMISSIONS_POLICY = 'camera=(), microphone=(), geolocation=()';
