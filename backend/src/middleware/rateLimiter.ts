import rateLimit from 'express-rate-limit';
import type { Request } from 'express';

const isDev = process.env.NODE_ENV !== 'production';

function isSearchRequest(req: Request): boolean {
  return req.method === 'GET' && !!(req.query.q || req.query.search);
}

// Routes covered by mediaLimiter — excluded from the global budget so media-heavy
// pages don't starve mutations and other API calls.
function isMediaRequest(req: Request): boolean {
  return req.originalUrl.startsWith('/api/documents') || req.originalUrl.startsWith('/api/job-media');
}

// ── Global limiter ─────────────────────────────────────────────────────────────
// Applied to every route except search GETs (which have their own limiter).
// 100 requests per IP per 15-minute window. Disabled in development.
export const globalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  skip: (req) => isDev || isSearchRequest(req) || isMediaRequest(req),
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

// ── Media limiter ──────────────────────────────────────────────────────────────
// Applied to routes that serve signed media/document URLs. Opening a job fetches
// one URL per media item in parallel, so these need more headroom than the
// global limiter. Disabled in development.
export const mediaLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 300,
  skip: () => isDev,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: {
    error: 'Too Many Requests',
    message: 'Too many media requests from this IP. Please try again later.',
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
