import { Router, Request, Response, NextFunction } from 'express';
import { param } from 'express-validator';
import { Role } from '@prisma/client';
import prisma from '../lib/prisma';
import { validate } from '../middleware/errorHandler';
import { requireAuth, requirePermission } from '../middleware/auth';
import { receiptUpload, uploadReceipt } from '../services/mediaService';
import { getMediaSignedUrl, deleteMediaFromStorage } from '../services/storageService';
import { emitToJob } from '../lib/socket';
import logger from '../lib/logger';

const router = Router();
router.use(requireAuth);

// ── POST /api/work-logs/:workLogId/receipts ────────────────────────────────────
// Attaches a material receipt (image or PDF) to a work log entry.
// Stores only the storageKey in the DB — NEVER a local file path. (Rules.md)

router.post(
  '/:workLogId/receipts',
  requirePermission('worklogs:edit'),
  receiptUpload.single('file'),
  [param('workLogId').isUUID()],
  validate,
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      if (!req.file) {
        res.status(422).json({ error: 'Unprocessable Entity', message: 'No file provided.' });
        return;
      }

      const workLog = await prisma.workLog.findFirst({
        where: { id: req.params['workLogId'], deletedAt: null },
        select: { id: true, jobId: true },
      });
      if (!workLog) {
        res.status(422).json({ error: 'Unprocessable Entity', message: 'Work log not found.' });
        return;
      }

      const { storageKey, mimeType, sizeBytes, fileName } = await uploadReceipt(req.file, workLog.jobId);

      const receipt = await prisma.workLogReceipt.create({
        data: {
          workLogId: workLog.id,
          storageKey,
          fileName,
          mimeType,
          sizeBytes,
          uploadedById: req.user!.id,
        },
        include: {
          uploadedBy: { select: { id: true, name: true } },
        },
      });

      logger.info('Receipt uploaded', {
        receiptId: receipt.id,
        workLogId: workLog.id,
        jobId: workLog.jobId,
        storageKey,
        sizeBytes,
        uploadedById: req.user!.id,
      });

      emitToJob(workLog.jobId, 'workLog:created', {
        jobId: workLog.jobId,
        actorId: req.user!.id,
        ts: new Date().toISOString(),
      });
      res.status(201).json(receipt);
    } catch (err) {
      next(err);
    }
  }
);

// ── GET /api/work-logs/:workLogId/receipts ─────────────────────────────────────
// Lists receipts for a work log, each with a time-limited signed URL.

router.get(
  '/:workLogId/receipts',
  requirePermission('worklogs:view'),
  [param('workLogId').isUUID()],
  validate,
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const receipts = await prisma.workLogReceipt.findMany({
        where: { workLogId: req.params['workLogId'], deletedAt: null },
        include: {
          uploadedBy: { select: { id: true, name: true } },
        },
        orderBy: { createdAt: 'desc' },
      });

      const withUrls = await Promise.all(
        receipts.map(async (r) => ({
          ...r,
          url: await getMediaSignedUrl(r.storageKey),
        }))
      );

      res.json(withUrls);
    } catch (err) {
      next(err);
    }
  }
);

// ── GET /api/work-logs/receipts/:id/url ────────────────────────────────────────
// Signed download URL for a single receipt.

router.get(
  '/receipts/:id/url',
  requirePermission('worklogs:view'),
  [param('id').isUUID()],
  validate,
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const receipt = await prisma.workLogReceipt.findFirst({
        where: { id: req.params['id'], deletedAt: null },
        select: { id: true, storageKey: true, mimeType: true, fileName: true },
      });

      if (!receipt) {
        res.status(404).json({ error: 'Not Found', message: 'Receipt not found.' });
        return;
      }

      const isDownload = req.query.download === 'true';
      const url = await getMediaSignedUrl(receipt.storageKey, isDownload);
      res.json({ id: receipt.id, url, mimeType: receipt.mimeType, fileName: receipt.fileName });
    } catch (err) {
      next(err);
    }
  }
);

// ── DELETE /api/work-logs/receipts/:id ─────────────────────────────────────────
// Soft-deletes the DB record after removing the object from storage.
// Only the uploader or an ADMIN/OWNER may delete a receipt.

router.delete(
  '/receipts/:id',
  requirePermission('worklogs:edit'),
  [param('id').isUUID()],
  validate,
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const receipt = await prisma.workLogReceipt.findFirst({
        where: { id: req.params['id'], deletedAt: null },
        select: { id: true, storageKey: true, uploadedById: true, workLog: { select: { jobId: true } } },
      });

      if (!receipt) {
        res.status(404).json({ error: 'Not Found', message: 'Receipt not found.' });
        return;
      }

      const isPrivileged =
        req.user!.role === Role.SUPER_ADMIN ||
        req.user!.role === Role.ADMIN ||
        req.user!.role === Role.OWNER;
      if (receipt.uploadedById !== req.user!.id && !isPrivileged) {
        res.status(403).json({ error: 'Forbidden', message: 'Only the uploader or an admin can delete this receipt.' });
        return;
      }

      // Delete from storage first — if this fails, the DB row is preserved
      // so the delete can be retried without orphaning the object.
      await deleteMediaFromStorage(receipt.storageKey);

      await prisma.workLogReceipt.update({
        where: { id: receipt.id },
        data: { deletedAt: new Date() },
      });

      logger.info('Receipt deleted', { receiptId: receipt.id, storageKey: receipt.storageKey, deletedById: req.user!.id });
      emitToJob(receipt.workLog.jobId, 'workLog:created', {
        jobId: receipt.workLog.jobId,
        actorId: req.user!.id,
        ts: new Date().toISOString(),
      });
      res.status(204).send();
    } catch (err) {
      next(err);
    }
  }
);

export default router;
