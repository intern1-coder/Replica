import fs from 'fs';
import path from 'path';
import winston from 'winston';
import DailyRotateFile from 'winston-daily-rotate-file';

const LOG_DIR = path.join(__dirname, '../../logs');

// Ensure the logs directory exists before transports attempt to write
if (!fs.existsSync(LOG_DIR)) {
  fs.mkdirSync(LOG_DIR, { recursive: true });
}

const { combine, timestamp, errors, json, colorize, printf } = winston.format;

// ── PII redaction (defense in depth) ─────────────────────────────────────────────
// Primary control is NOT logging PII at call sites (see docs/PRODUCTION_HARDENING.md).
// This is the safety net: any log metadata whose key matches this deny-list is
// replaced with '[REDACTED]', at any nesting depth, regardless of call site.
// Note: Prisma query params are logged under the key `params` (a positional string),
// which is intentionally NOT in this list — dev query debugging stays intact.
const SENSITIVE_KEYS = new Set([
  'email', 'to', 'cc', 'bcc', 'phone', 'phonenumber', 'address',
  'accessnotes', 'keylocation', 'password', 'passwordhash', 'token',
  'secret', 'authorization', 'apikey', 'accesskey', 'secretaccesskey', 'ssn',
]);

const REDACTED = '[REDACTED]';

function redactValue(value: unknown, seen: WeakSet<object>): unknown {
  if (value === null || typeof value !== 'object') return value;
  if (seen.has(value as object)) return value;
  seen.add(value as object);

  if (Array.isArray(value)) {
    return value.map((v) => redactValue(v, seen));
  }
  const out: Record<string, unknown> = {};
  for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
    out[key] = SENSITIVE_KEYS.has(key.toLowerCase()) ? REDACTED : redactValue(val, seen);
  }
  return out;
}

const redactFormat = winston.format((info) => {
  const seen = new WeakSet<object>();
  for (const key of Object.keys(info)) {
    // Skip Winston's own control fields; redact everything else (the metadata).
    if (key === 'level' || key === 'message' || key === 'timestamp' || key === 'stack') continue;
    if (SENSITIVE_KEYS.has(key.toLowerCase())) {
      (info as Record<string, unknown>)[key] = REDACTED;
    } else {
      (info as Record<string, unknown>)[key] = redactValue((info as Record<string, unknown>)[key], seen);
    }
  }
  return info;
});

/**
 * Masks an email for safe logging: `john.doe@example.com` -> `j***@example.com`.
 * Use when you need SOME signal about which account (e.g. brute-force triage)
 * without storing the raw address in logs.
 */
export function maskEmail(email: string): string {
  const at = email.indexOf('@');
  if (at <= 0) return REDACTED;
  return `${email[0]}***${email.slice(at)}`;
}

// ── Formats ────────────────────────────────────────────────────────────────────

const jsonFormat = combine(
  redactFormat(),
  timestamp(),
  errors({ stack: true }),
  json()
);

const devFormat = combine(
  redactFormat(),
  colorize({ all: true }),
  timestamp({ format: 'HH:mm:ss' }),
  errors({ stack: true }),
  printf(({ level, message, timestamp, stack, ...meta }) => {
    const metaStr = Object.keys(meta).length
      ? `\n  ${JSON.stringify(meta, null, 2)}`
      : '';
    const stackStr = stack ? `\n${stack as string}` : '';
    return `${timestamp as string} [${level}] ${message as string}${metaStr}${stackStr}`;
  })
);

const isProduction = process.env.NODE_ENV === 'production';

// ── Logger ─────────────────────────────────────────────────────────────────────

const logger = winston.createLogger({
  level: process.env.LOG_LEVEL ?? (isProduction ? 'info' : 'debug'),
  exitOnError: false,
  transports: [
    // Console: pretty colours in dev, structured JSON in prod
    new winston.transports.Console({
      format: isProduction ? jsonFormat : devFormat,
    }),
    // All levels rotated daily, retained 30 days
    new DailyRotateFile({
      dirname: LOG_DIR,
      filename: 'combined-%DATE%.log',
      datePattern: 'YYYY-MM-DD',
      maxFiles: '30d',
      zippedArchive: true,
      format: jsonFormat,
    }),
    // Error-only log for quick triage
    new DailyRotateFile({
      dirname: LOG_DIR,
      filename: 'error-%DATE%.log',
      datePattern: 'YYYY-MM-DD',
      level: 'error',
      maxFiles: '30d',
      zippedArchive: true,
      format: jsonFormat,
    }),
  ],
});

// ── Morgan write stream (routes HTTP logs through Winston at 'http' level) ─────

export const morganStream = {
  write: (message: string): void => {
    logger.http(message.trim());
  },
};

export default logger;
