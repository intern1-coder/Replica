import { Server as SocketIOServer, Socket } from 'socket.io';
import { Server as HttpServer } from 'http';
import jwt from 'jsonwebtoken';
import config from '../config';
import logger from './logger';

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

  // JWT auth middleware — runs before 'connection' event
  io.use((socket: Socket, next) => {
    const token = socket.handshake.auth['token'] as string | undefined;
    if (!token) {
      return next(new Error('Authentication required.'));
    }
    try {
      const payload = jwt.verify(token, config.jwt.secret);
      socket.data['user'] = payload;
      next();
    } catch {
      next(new Error('Invalid or expired token.'));
    }
  });

  io.on('connection', (socket: Socket) => {
    const userId = (socket.data['user'] as { userId?: string })?.userId;
    logger.info('Socket connected', { socketId: socket.id, userId });

    socket.on('disconnect', (reason) => {
      logger.info('Socket disconnected', { socketId: socket.id, userId, reason });
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

// ── Typed event emitters ───────────────────────────────────────────────────────
// All realtime events go through these functions so event names and shapes
// remain consistent and can be diffed against the frontend in one place.

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
