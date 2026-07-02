import rateLimit from 'express-rate-limit';
import type { Request } from 'express';

const isDev = process.env.NODE_ENV !== 'production';

function isSearchRequest(req: Request): boolean {
  return req.method === 'GET' && !!(req.query.q || req.query.search);
}

// ── Global limiter ─────────────────────────────────────────────────────────────
// Applied to every route except search GETs (which have their own limiter).
// 100 requests per IP per 15-minute window. Disabled in development.
export const globalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  skip: (req) => isDev || isSearchRequest(req),
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: {
    error: 'Too Many Requests',
    message: 'Too many requests from this IP. Please try again later.',
  },
});

// ── Search limiter ─────────────────────────────────────────────────────────────
// Applied to list routes that accept ?q= or ?search= params.
// Higher ceiling than the global limiter to accommodate search-as-you-type UX. Disabled in development.
export const searchLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 300,
  skip: () => isDev,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: {
    error: 'Too Many Requests',
    message: 'Too many search requests from this IP. Please slow down.',
  },
});

// ── Auth limiter ───────────────────────────────────────────────────────────────
// Stricter — applied only to authentication endpoints.
// 10 requests per IP per 15-minute window to limit brute-force / magic-link spam.
export const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: {
    error: 'Too Many Requests',
    message: 'Too many login attempts. Please try again in 15 minutes.',
  },
});
