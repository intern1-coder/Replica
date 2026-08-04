import rateLimit from 'express-rate-limit';
import type { NextFunction, Request, Response } from 'express';
import { verifyJWT } from '../services/authService';
import logger from '../lib/logger';

const isDev = process.env.NODE_ENV !== 'production';

const GLOBAL_MAX = Number(process.env.RATE_LIMIT_GLOBAL_MAX) || 500;
const SEARCH_MAX = Number(process.env.RATE_LIMIT_SEARCH_MAX) || 600;
const MEDIA_MAX = Number(process.env.RATE_LIMIT_MEDIA_MAX) || 600;

function isSearchRequest(req: Request): boolean {
  return req.method === 'GET' && !!(req.query.q || req.query.search);
}

// Routes covered by mediaLimiter — excluded from the global budget so media-heavy
// pages don't starve mutations and other API calls.
function isMediaRequest(req: Request): boolean {
  return req.originalUrl.startsWith('/api/documents') || req.originalUrl.startsWith('/api/job-media');
}

/** Extract userId from Bearer JWT for rate-limit bucketing (no DB lookup). */
function userIdFromRequest(req: Request): string | undefined {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) return undefined;
  try {
    const payload = verifyJWT(authHeader.slice(7));
    const userId = payload['userId'];
    return typeof userId === 'string' ? userId : undefined;
  } catch {
    return undefined;
  }
}

/** Per-user bucket when authenticated; IP bucket otherwise (health, login, etc.). */
function rateLimitKey(req: Request): string {
  const userId = userIdFromRequest(req);
  if (userId) return `user:${userId}`;
  return `ip:${req.ip ?? 'unknown'}`;
}

function createLimitHandler(limiterName: string) {
  return (req: Request, res: Response, _next: NextFunction, options: { statusCode?: number; message?: unknown }) => {
    logger.warn('Rate limit exceeded', {
      limiter: limiterName,
      ip: req.ip,
      userId: userIdFromRequest(req),
      path: req.path,
      method: req.method,
    });
    res.status(options.statusCode ?? 429).json(options.message);
  };
}

const sharedLimiterOptions = {
  windowMs: 15 * 60 * 1000,
  standardHeaders: 'draft-7' as const,
  legacyHeaders: false,
  keyGenerator: rateLimitKey,
};

// ── Global limiter ─────────────────────────────────────────────────────────────
// Applied to every route except search GETs (which have their own limiter).
// 500 requests per user (or IP when unauthenticated) per 15-minute window.
// Disabled in development.
export const globalLimiter = rateLimit({
  ...sharedLimiterOptions,
  max: GLOBAL_MAX,
  skip: (req) => isDev || isSearchRequest(req) || isMediaRequest(req),
  message: {
    error: 'Too Many Requests',
    message: 'Too many requests from this IP. Please try again later.',
  },
  handler: createLimitHandler('global'),
});

// ── Search limiter ─────────────────────────────────────────────────────────────
// Applied to list GET routes that accept ?q= or ?search= params.
// Higher ceiling than the global limiter to accommodate search-as-you-type UX.
// Disabled in development.
export const searchLimiter = rateLimit({
  ...sharedLimiterOptions,
  max: SEARCH_MAX,
  skip: () => isDev,
  message: {
    error: 'Too Many Requests',
    message: 'Too many search requests from this IP. Please slow down.',
  },
  handler: createLimitHandler('search'),
});

// ── Media limiter ──────────────────────────────────────────────────────────────
// Applied to routes that serve signed media/document URLs. Opening a job fetches
// one URL per media item in parallel, so these need more headroom than the
// global limiter. Disabled in development.
export const mediaLimiter = rateLimit({
  ...sharedLimiterOptions,
  max: MEDIA_MAX,
  skip: () => isDev,
  message: {
    error: 'Too Many Requests',
    message: 'Too many media requests from this IP. Please try again later.',
  },
  handler: createLimitHandler('media'),
});

// ── Auth limiter ───────────────────────────────────────────────────────────────
// Stricter — applied only to authentication endpoints.
// 10 requests per IP per 15-minute window to limit brute-force / magic-link spam.
// Always IP-based (never keyed by user) so invalid login attempts stay capped.
export const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: {
    error: 'Too Many Requests',
    message: 'Too many login attempts. Please try again in 15 minutes.',
  },
  handler: createLimitHandler('auth'),
});

/** Exported for tests — current global max in production mode. */
export const GLOBAL_RATE_LIMIT_MAX = GLOBAL_MAX;
