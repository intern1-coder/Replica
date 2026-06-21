import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import morgan from 'morgan';
import config from './config';
import { morganStream } from './lib/logger';
import { globalLimiter } from './middleware/rateLimiter';
import { errorHandler } from './middleware/errorHandler';

// Route modules
import healthRouter from './routes/health';
import authRouter from './routes/auth';
import clientsRouter from './routes/clients';
import propertiesRouter from './routes/properties';
import tenantsRouter from './routes/tenants';
import jobsRouter from './routes/jobs';
import workLogsRouter from './routes/workLogs';
import jobMediaRouter from './routes/jobMedia';
import communicationLogsRouter from './routes/communicationLogs';
import pnlRouter from './routes/pnl';
import auditLogsRouter from './routes/auditLogs';
import documentsRouter from './routes/documents';
import dashboardRouter from './routes/dashboard';
import usersRouter from './routes/users';
import lineItemsRouter from './routes/lineItems';

const app = express();

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
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// ── HTTP request logging (Morgan → Winston) ────────────────────────────────────
app.use(
  morgan(config.env === 'production' ? 'combined' : 'dev', {
    stream: morganStream,
  })
);

// ── Global rate limiter ────────────────────────────────────────────────────────
app.use(globalLimiter);

// ── Routes ─────────────────────────────────────────────────────────────────────
app.use('/api/health', healthRouter);
app.use('/api/auth', authRouter);
app.use('/api/clients', clientsRouter);
app.use('/api/properties', propertiesRouter);
app.use('/api/tenants', tenantsRouter);
app.use('/api/jobs', jobsRouter);
app.use('/api/work-logs', workLogsRouter);
app.use('/api/job-media', jobMediaRouter);
app.use('/api/communication-logs', communicationLogsRouter);
app.use('/api/pnl', pnlRouter);
app.use('/api/audit-logs', auditLogsRouter);
app.use('/api/documents', documentsRouter);
app.use('/api/dashboard', dashboardRouter);
app.use('/api/users', usersRouter);
app.use('/api/jobs/:jobId/line-items', lineItemsRouter);

// ── Local Uploads Serving ──────────────────────────────────────────────────────
import path from 'path';
app.use('/uploads', (req, res, next) => {
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
