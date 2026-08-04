import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import morgan from 'morgan';
import config from './config';
import { morganStream } from './lib/logger';
import { globalLimiter, searchLimiter, mediaLimiter } from './middleware/rateLimiter';
import { errorHandler } from './middleware/errorHandler';
import { requestId } from './middleware/requestId';

// Route modules
import healthRouter from './routes/health';
import authRouter from './routes/auth';
import clientsRouter from './routes/clients';
import propertiesRouter from './routes/properties';
import tenantsRouter from './routes/tenants';
import jobsRouter from './routes/jobs';
import workLogsRouter from './routes/workLogs';
import workLogReceiptsRouter from './routes/workLogReceipts';
import jobMediaRouter from './routes/jobMedia';
import communicationLogsRouter from './routes/communicationLogs';
import pnlRouter from './routes/pnl';
import auditLogsRouter from './routes/auditLogs';
import documentsRouter from './routes/documents';
import dashboardRouter from './routes/dashboard';
import usersRouter from './routes/users';
import lineItemsRouter from './routes/lineItems';
import settingsRouter from './routes/settings';
import engineersRouter from './routes/engineers';
import remindersRouter from './routes/reminders';

const app = express();

// Behind one reverse-proxy hop (Caddy). Without this, req.ip is the proxy's
// address and every client shares a single rate-limit bucket.
app.set('trust proxy', 1);

// ── Security middleware ────────────────────────────────────────────────────────
app.use(helmet());

app.use(
  cors({
    origin: config.cors.origin,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
    allowedHeaders: ['Content-Type', 'Authorization'],
    credentials: true,
  })
);

// ── Request parsing ────────────────────────────────────────────────────────────
// 10 MB limit accommodates base64-encoded images embedded in document snapshot payloads.
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// ── Request correlation id (before logging so it can be included) ──────────────
app.use(requestId);

// ── HTTP request logging (Morgan → Winston) ────────────────────────────────────
// Custom tokens: `path` logs req.path WITHOUT the query string, so search terms
// (e.g. /api/clients?q=<name>) never reach the logs; `id` is the correlation id.
morgan.token('path', (req) => (req as express.Request).path);
morgan.token('id', (req) => (req as express.Request).id ?? '-');

// Production: structured, no query string, includes request id. Dev: concise.
const morganFormat = config.env === 'production'
  ? ':remote-addr :method :path :status :res[content-length] - :response-time ms :id'
  : ':method :path :status :response-time ms';

app.use(morgan(morganFormat, { stream: morganStream }));

// ── Request timeout ────────────────────────────────────────────────────────────
// Abort any request that takes longer than 30 seconds to prevent hung workers.
app.use((req, res, next) => {
  res.setTimeout(30_000, () => {
    res.status(503).json({ error: 'Service Unavailable', message: 'Request timed out.' });
  });
  next();
});

// ── Rate limiters ──────────────────────────────────────────────────────────────
// Search routes get a dedicated higher-ceiling limiter so search-as-you-type
// doesn't eat into the global budget for mutations and other API calls.
// Only GET list/autocomplete requests use the search limiter — mutations skip it.
function applySearchLimiter(req: express.Request, res: express.Response, next: express.NextFunction) {
  if (req.method === 'GET') return searchLimiter(req, res, next);
  next();
}
app.use('/api/clients', applySearchLimiter);
app.use('/api/properties', applySearchLimiter);
app.use('/api/tenants', applySearchLimiter);
app.use('/api/jobs', applySearchLimiter);
// Media/document URL routes fan out one request per item on job open.
app.use('/api/documents', mediaLimiter);
app.use('/api/job-media', mediaLimiter);
app.use(globalLimiter); // skips GET ?q= / ?search= requests (handled above)

// ── Routes ─────────────────────────────────────────────────────────────────────
app.use('/api/health', healthRouter);
app.use('/api/auth', authRouter);
app.use('/api/clients', clientsRouter);
app.use('/api/properties', propertiesRouter);
app.use('/api/tenants', tenantsRouter);
app.use('/api/jobs', jobsRouter);
// Receipts router first — its /:workLogId/receipts and /receipts/:id paths must
// match before workLogsRouter's generic /:id route.
app.use('/api/work-logs', workLogReceiptsRouter);
app.use('/api/work-logs', workLogsRouter);
app.use('/api/job-media', jobMediaRouter);
app.use('/api/communication-logs', communicationLogsRouter);
app.use('/api/pnl', pnlRouter);
app.use('/api/audit-logs', auditLogsRouter);
app.use('/api/documents', documentsRouter);
app.use('/api/dashboard', dashboardRouter);
app.use('/api/users', usersRouter);
app.use('/api/jobs/:jobId/line-items', lineItemsRouter);
app.use('/api/settings', settingsRouter);
app.use('/api/engineers', engineersRouter);
app.use('/api/reminders', remindersRouter);

// ── Local Uploads Serving ──────────────────────────────────────────────────────
// Only active when uploadPdfToStorage falls back to local disk (no S3 credentials).
// In production this path is never hit — files are served via signed S3 URLs.
import path from 'path';
app.use('/uploads', (req, res, next) => {
  res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
  if (req.query.download === 'true') {
    res.setHeader('Content-Disposition', 'attachment');
  }
  next();
}, express.static(path.join(__dirname, '../uploads')));

// ── 404 handler — must be after all routes ─────────────────────────────────────
app.use((req, res) => {
  res.status(404).json({
    error: 'Not Found',
    message: `Route ${req.method} ${req.path} not found.`,
  });
});

// ── Centralized error handler — must be last (4-argument signature) ────────────
app.use(errorHandler);

export default app;
