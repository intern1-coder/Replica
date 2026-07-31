import { Server as SocketIOServer, Socket } from 'socket.io';
import { Server as HttpServer } from 'http';
import jwt from 'jsonwebtoken';
import config from '../config';
import prisma from './prisma';
import logger from './logger';
import { resolveAuthenticatedUser, type ResolvedUser } from '../middleware/auth';

// ── Singleton ──────────────────────────────────────────────────────────────────
let io: SocketIOServer | null = null;

/**
 * Initialises Socket.io and attaches it to the HTTP server.
 * Call once from server.ts during startup — before listening.
 *
 * Authentication: clients pass their JWT in handshake.auth.token.
 * Invalid/missing tokens are rejected at the handshake stage; they never
 * reach the connection handler.
 */
export function initSocket(httpServer: HttpServer): SocketIOServer {
  io = new SocketIOServer(httpServer, {
    cors: {
      origin: config.cors.origin,
      methods: ['GET', 'POST'],
    },
  });

  // JWT auth middleware — runs before 'connection' event.
  // A socket can stay open for as long as its JWT is valid (up to
  // JWT_EXPIRES_IN, e.g. 7 days) — signature verification alone would let a
  // deactivated user, or one whose password was just reset/changed
  // (tokenVersion bump = the app's force-logout mechanism), keep receiving
  // live job data for the rest of that window. resolveAuthenticatedUser is
  // the same check requireAuth applies to every HTTP request, so a socket
  // can never be more trusting than an HTTP call made with the same token.
  io.use(async (socket: Socket, next) => {
    const token = socket.handshake.auth['token'] as string | undefined;
    if (!token) {
      return next(new Error('Authentication required.'));
    }
    let payload: jwt.JwtPayload;
    try {
      payload = jwt.verify(token, config.jwt.secret) as jwt.JwtPayload;
    } catch {
      return next(new Error('Invalid or expired token.'));
    }

    const resolved = await resolveAuthenticatedUser(payload);
    if (!resolved.ok) {
      return next(new Error(
        resolved.reason === 'stale_token'
          ? 'Session expired. Please log in again.'
          : 'User account not found or has been deactivated.'
      ));
    }

    socket.data['user'] = resolved.user;
    next();
  });

  io.on('connection', (socket: Socket) => {
    const user = socket.data['user'] as ResolvedUser;
    logger.info('Socket connected', { socketId: socket.id, userId: user.id });

    socket.join(`user:${user.id}`);

    // Re-checked here (not just at handshake) because a socket can stay open
    // far longer than a single request, and joining a job's room is what
    // actually grants access to that job's realtime data (description,
    // materials, quoted value, tenant snapshot fields, media storage keys).
    // Mirrors the same jobs:view permission + not-soft-deleted check the
    // HTTP job routes apply.
    socket.on('job:join', async (jobId: unknown) => {
      if (typeof jobId !== 'string' || !jobId) return;
      if (!user.can('jobs:view')) return;
      const job = await prisma.job.findFirst({ where: { id: jobId, deletedAt: null }, select: { id: true } });
      if (!job) return;
      socket.join(`job:${jobId}`);
    });
    socket.on('job:leave', (jobId: unknown) => {
      if (typeof jobId !== 'string' || !jobId) return;
      socket.leave(`job:${jobId}`);
    });

    socket.on('disconnect', (reason) => {
      logger.info('Socket disconnected', { socketId: socket.id, userId: user.id, reason });
    });
  });

  logger.info('Socket.io initialised');
  return io;
}

/**
 * Returns the active Socket.io server instance.
 * Throws if initSocket() has not been called yet.
 */
export function getIO(): SocketIOServer {
  if (!io) throw new Error('Socket.io not initialised — call initSocket() first.');
  return io;
}

// ── Generic emitters ──────────────────────────────────────────────────────────

/**
 * Broadcast an event to all connected clients.
 */
export function emitToAll(event: string, payload: object): void {
  if (!io) return;
  io.emit(event, payload);
}

/**
 * Emit an event only to clients that have joined the room for a specific job.
 */
export function emitToJob(jobId: string, event: string, payload: object): void {
  if (!io) return;
  io.to(`job:${jobId}`).emit(event, payload);
}

/**
 * Emit an event only to sockets belonging to a specific user.
 */
export function emitToUser(userId: string, event: string, payload: object): void {
  if (!io) return;
  io.to(`user:${userId}`).emit(event, payload);
}

// ── Typed event emitters ───────────────────────────────────────────────────────
// All realtime events go through these functions so event names and shapes
// remain consistent and can be diffed against the frontend in one place.
//
// Room-scoped payloads (emitToJob) commonly include:
// - workLog:created     → { jobId, actorId, workLog, ts }
// - communicationLog:created → { jobId, actorId, log, reminder?, ts }
// - job:updated         → { jobId, actorId, job: { description, materials, ... }, ts }
// - lineItems:changed   → { jobId, actorId, lineItem?, deletedLineItemId?, ts }
// - media:uploaded      → { jobId, actorId, media: { id, jobId, mediaType, storageKey, createdAt }, ts }
//
// Global payloads include:
// - job:statusChanged   → { jobId, status, version, ts }
// - job:created         → { jobId, ts }
// - job:deleted         → { jobId, ts }
// - reminder:changed    → { jobId, ts }
//
// User-scoped payloads (emitToUser):
// - user:permissionsChanged → { userId, actorId?, ts }

/**
 * Broadcast when a job's status changes.
 * Includes the new version so optimistic-lock holders know to refresh.
 */
export function emitJobStatusChanged(
  jobId: string,
  status: string,
  version: number
): void {
  try {
    getIO().emit('job:statusChanged', { jobId, status, version, ts: Date.now() });
  } catch {
    // If socket is not yet initialised (e.g. in tests), fail silently
  }
}

/**
 * Broadcast when a work log is added to a job.
 * Consumers should refetch P&L for the affected job.
 */
export function emitWorkLogCreated(jobId: string): void {
  try {
    getIO().emit('workLog:created', { jobId, ts: Date.now() });
  } catch { /* silent */ }
}

/**
 * Broadcast when the PM logs a communication event.
 */
export function emitCommunicationLogged(jobId: string): void {
  try {
    getIO().emit('communicationLog:created', { jobId, ts: Date.now() });
  } catch { /* silent */ }
}

/**
 * Broadcast when new media is uploaded to a job.
 */
export function emitMediaUploaded(jobId: string): void {
  try {
    getIO().emit('media:uploaded', { jobId, ts: Date.now() });
  } catch { /* silent */ }
}

/**
 * Broadcast when a follow-up reminder is created, resolved, or snoozed.
 */
export function emitReminderChanged(jobId: string): void {
  try {
    getIO().emit('reminder:changed', { jobId, ts: Date.now() });
  } catch { /* silent */ }
}

/**
 * Notify a member that their role or permission overrides changed.
 * Delivered only to that user's connected sessions.
 */
export function emitUserPermissionsChanged(userId: string, actorId?: string): void {
  try {
    emitToUser(userId, 'user:permissionsChanged', {
      userId,
      actorId,
      ts: Date.now(),
    });
  } catch { /* silent */ }
}
