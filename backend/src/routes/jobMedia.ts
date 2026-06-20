import { Router, Request, Response, NextFunction } from 'express';
import { body, param, query } from 'express-validator';
import { MediaType, Role } from '@prisma/client';
import prisma from '../lib/prisma';
import { validate } from '../middleware/errorHandler';
import { requireAuth, requireRole } from '../middleware/auth';
import { upload, uploadMedia } from '../services/mediaService';
import { getMediaSignedUrl, deleteMediaFromStorage } from '../services/storageService';
import { emitMediaUploaded } from '../lib/socket';
import logger from '../lib/logger';

const router = Router();
router.use(requireAuth);

// ── POST /api/job-media ────────────────────────────────────────────────────────
// Handles file upload: multer → sharp → OCI Object Storage.
// Stores only the storageKey in the DB — NEVER a local file path. (Rules.md)

router.post(
  '/',
  requireRole(Role.PM, Role.ADMIN),
  // multer must run before express-validator so req.body is populated
  upload.single('file'),
  [
    body('jobId').isUUID().withMessage('jobId is required.'),
    body('mediaType')
      .isIn(Object.values(MediaType))
      .withMessage(`mediaType must be one of: ${Object.values(MediaType).join(', ')}`),
  ],
  validate,
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      if (!req.file) {
        res.status(422).json({ error: 'Unprocessable Entity', message: 'No file provided.' });
        return;
      }

      const { jobId, mediaType } = req.body as { jobId: string; mediaType: MediaType };

      const job = await prisma.job.findFirst({
        where: { id: jobId, deletedAt: null },
        select: { id: true },
      });
      if (!job) {
        res.status(422).json({ error: 'Unprocessable Entity', message: 'Job not found.' });
        return;
      }

      // Process (compress if image) + upload to OCI
      const { storageKey, mimeType, sizeBytes, fileName } = await uploadMedia(req.file, jobId);

      const media = await prisma.jobMedia.create({
        data: {
          jobId,
          storageKey,
          mediaType,
          fileName,
          mimeType,
          sizeBytes,
          uploadedById: req.user!.id,
        },
        include: {
          uploadedBy: { select: { id: true, name: true } },
        },
      });

      logger.info('Media uploaded', {
        mediaId: media.id,
        jobId,
        storageKey,
        sizeBytes,
        uploadedById: req.user!.id,
      });

      emitMediaUploaded(jobId);
      res.status(201).json(media);
    } catch (err) {
      next(err);
    }
  }
);

// ── GET /api/job-media?jobId=<uuid> ───────────────────────────────────────────
// Lists all media records for a job (no signed URLs — use /:id/url for those).

router.get(
  '/',
  [query('jobId').isUUID().withMessage('jobId is required.')],
  validate,
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { jobId } = req.query as { jobId: string };

      const media = await prisma.jobMedia.findMany({
        where: { jobId },
        include: {
          uploadedBy: { select: { id: true, name: true } },
        },
        orderBy: { createdAt: 'desc' },
      });

      res.json(media);
    } catch (err) {
      next(err);
    }
  }
);

// ── GET /api/job-media/:id/url ─────────────────────────────────────────────────
// Generates and returns a time-limited signed URL for the media object.
// Clients fetch media directly from OCI using this URL — no traffic proxied
// through the backend. Signed URL expires in config.storage.signedUrlExpiresSeconds.

router.get(
  '/:id/url',
  [param('id').isUUID()],
  validate,
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const media = await prisma.jobMedia.findUnique({
        where: { id: req.params['id'] },
        select: { id: true, storageKey: true, mimeType: true, fileName: true },
      });

      if (!media) {
        res.status(404).json({ error: 'Not Found', message: 'Media not found.' });
        return;
      }

      const url = await getMediaSignedUrl(media.storageKey);

      res.json({
        id: media.id,
        url,
        mimeType: media.mimeType,
        fileName: media.fileName,
      });
    } catch (err) {
      next(err);
    }
  }
);

// ── DELETE /api/job-media/:id ─────────────────────────────────────────────────
// Deletes the object from OCI Object Storage, then removes the DB record.
// Both steps are necessary to prevent orphaned objects in storage.

router.delete(
  '/:id',
  requireRole(Role.ADMIN, Role.OWNER),
  [param('id').isUUID()],
  validate,
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const media = await prisma.jobMedia.findUnique({
        where: { id: req.params['id'] },
        select: { id: true, storageKey: true, jobId: true },
      });

      if (!media) {
        res.status(404).json({ error: 'Not Found', message: 'Media not found.' });
        return;
      }

      // Delete from Object Storage first — if this fails, the DB row is preserved
      // so the admin can retry. The reverse (DB deleted, storage not) is unrecoverable.
      await deleteMediaFromStorage(media.storageKey);

      await prisma.jobMedia.delete({ where: { id: req.params['id'] } });

      logger.info('Media deleted', { mediaId: media.id, storageKey: media.storageKey });
      res.status(204).send();
    } catch (err) {
      next(err);
    }
  }
);

export default router;
