import rateLimit from 'express-rate-limit';

// ── Global limiter ─────────────────────────────────────────────────────────────
// Applied to every route. 100 requests per IP per 15-minute window.
export const globalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 1000,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: {
    error: 'Too Many Requests',
    message: 'Too many requests from this IP. Please try again later.',
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
