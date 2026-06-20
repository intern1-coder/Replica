import { Router, Request, Response, NextFunction } from 'express';
import { param, body } from 'express-validator';
import { DocumentType, Role } from '@prisma/client';
import { PutObjectCommand } from '@aws-sdk/client-s3';
import crypto from 'crypto';
import fs from 'fs/promises';
import path from 'path';
import prisma from '../lib/prisma';
import s3 from '../lib/s3';
import config from '../config';
import { validate } from '../middleware/errorHandler';
import { requireAuth, requireRole } from '../middleware/auth';
import { generatePdf } from '../services/pdfService';
import { formatJobNumber } from '../lib/utils';
import logger from '../lib/logger';
import { getMediaSignedUrl } from '../services/storageService';

const router = Router();
router.use(requireAuth);
router.use(requireRole(Role.PM, Role.ADMIN));

// Helper: upload PDF to Object Storage
async function uploadPdfToStorage(jobId: string, pdfBuffer: Buffer, docType: DocumentType): Promise<string> {
  const storageKey = `jobs/${jobId}/documents/${docType.toLowerCase()}_${crypto.randomUUID()}.pdf`;
  
  // Fallback to local storage if AWS credentials are not configured
  if (!config.storage.accessKeyId || config.storage.accessKeyId.includes('mock') || config.storage.accessKeyId === '') {
    const localPath = path.join(__dirname, '../../uploads', storageKey);
    await fs.mkdir(path.dirname(localPath), { recursive: true });
    await fs.writeFile(localPath, pdfBuffer);
    return storageKey;
  }

  await s3.send(
    new PutObjectCommand({
      Bucket: config.storage.bucket,
      Key: storageKey,
      Body: pdfBuffer,
      ContentType: 'application/pdf',
      ContentLength: pdfBuffer.length,
    })
  );

  return storageKey;
}

// ── POST /api/documents/quote ──────────────────────────────────────────────────

router.post(
  '/quote',
  [body('jobId').isUUID()],
  validate,
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const job = await prisma.job.findUnique({
        where: { id: req.body.jobId, deletedAt: null },
        include: { property: true, client: true },
      });

      if (!job) {
        res.status(404).json({ error: 'Not Found', message: 'Job not found.' });
        return;
      }

      const snapshotData = {
        jobNumber: formatJobNumber(job.sequence),
        date: new Date().toLocaleDateString(),
        clientName: job.client.name,
        propertyAddress: job.property.address,
        description: job.description || 'No description provided.',
        quotedValue: job.quotedValue ? Number(job.quotedValue).toFixed(2) : '0.00',
      };

      const pdfBuffer = await generatePdf('quote', snapshotData);
      const storageKey = await uploadPdfToStorage(job.id, pdfBuffer, DocumentType.QUOTE);

      const doc = await prisma.generatedDocument.create({
        data: {
          jobId: job.id,
          type: DocumentType.QUOTE,
          storageKey,
          snapshotData,
          generatedById: req.user!.id,
        },
      });

      res.status(201).json(doc);
    } catch (err) {
      next(err);
    }
  }
);

// ── POST /api/documents/job-sheet ──────────────────────────────────────────────

router.post(
  '/job-sheet',
  [body('jobId').isUUID()],
  validate,
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const job = await prisma.job.findUnique({
        where: { id: req.body.jobId, deletedAt: null },
        include: { property: true, assignedContractor: true },
      });

      if (!job) {
        res.status(404).json({ error: 'Not Found', message: 'Job not found.' });
        return;
      }

      const snapshotData = {
        jobNumber: formatJobNumber(job.sequence),
        scheduledDate: job.scheduledDate ? job.scheduledDate.toLocaleDateString() : 'TBD',
        contractorName: job.assignedContractor?.name || 'Unassigned',
        propertyAddress: job.property.address,
        tenantName: job.tenantSnapshotName || 'N/A',
        tenantPhone: job.tenantSnapshotPhone || 'N/A',
        accessNotes: job.property.accessNotes || 'None',
        description: job.description || 'No description provided.',
        diagnosticNotes: job.diagnosticNotes || 'None',
      };

      const pdfBuffer = await generatePdf('job_sheet', snapshotData);
      const storageKey = await uploadPdfToStorage(job.id, pdfBuffer, DocumentType.JOB_SHEET);

      const doc = await prisma.generatedDocument.create({
        data: {
          jobId: job.id,
          type: DocumentType.JOB_SHEET,
          storageKey,
          snapshotData,
          generatedById: req.user!.id,
        },
      });

      res.status(201).json(doc);
    } catch (err) {
      next(err);
    }
  }
);

// ── POST /api/documents/completion-report ──────────────────────────────────────

router.post(
  '/completion-report',
  [body('jobId').isUUID()],
  validate,
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const job = await prisma.job.findUnique({
        where: { id: req.body.jobId, deletedAt: null },
        include: { property: true, client: true },
      });

      if (!job) {
        res.status(404).json({ error: 'Not Found', message: 'Job not found.' });
        return;
      }

      const snapshotData = {
        jobNumber: formatJobNumber(job.sequence),
        completedAt: job.completedAt ? job.completedAt.toLocaleDateString() : new Date().toLocaleDateString(),
        clientName: job.client.name,
        propertyAddress: job.property.address,
        completionNotes: job.completionNotes || 'None',
      };

      const pdfBuffer = await generatePdf('completion_report', snapshotData);
      const storageKey = await uploadPdfToStorage(job.id, pdfBuffer, DocumentType.COMPLETION_REPORT);

      const doc = await prisma.generatedDocument.create({
        data: {
          jobId: job.id,
          type: DocumentType.COMPLETION_REPORT,
          storageKey,
          snapshotData,
          generatedById: req.user!.id,
        },
      });

      res.status(201).json(doc);
    } catch (err) {
      next(err);
    }
  }
);

// ── GET /api/documents/:id/url ─────────────────────────────────────────────────
// Get signed URL to download the generated document.

router.get(
  '/:id/url',
  [param('id').isUUID()],
  validate,
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const doc = await prisma.generatedDocument.findUnique({
        where: { id: req.params['id'] },
      });

      if (!doc) {
        res.status(404).json({ error: 'Not Found', message: 'Document not found.' });
        return;
      }

      const url = await getMediaSignedUrl(doc.storageKey);
      res.json({ id: doc.id, url, type: doc.type });
    } catch (err) {
      next(err);
    }
  }
);

export default router;
