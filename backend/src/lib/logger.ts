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

// ── Formats ────────────────────────────────────────────────────────────────────

const jsonFormat = combine(
  timestamp(),
  errors({ stack: true }),
  json()
);

const devFormat = combine(
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
