import { Router, Request, Response, NextFunction } from 'express';
import { param, body } from 'express-validator';
import { DocumentType, JobStatus, Role, AuditAction } from '@prisma/client';
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
import { getBase64Images } from '../services/imageEmbedder';

const router = Router();
router.use(requireAuth);
router.use(requireRole(Role.PM, Role.ADMIN, Role.OWNER));

// ── Stage-Gating: which statuses allow which documents ──────────────────────
const QUOTE_ALLOWED_STATUSES: JobStatus[] = [JobStatus.QUOTED, JobStatus.AUTHORISED, JobStatus.COMPLETED];
const JOB_SHEET_ALLOWED_STATUSES: JobStatus[] = [JobStatus.AUTHORISED, JobStatus.COMPLETED];
const COMPLETION_ALLOWED_STATUSES: JobStatus[] = [JobStatus.COMPLETED];

// Helper: upload PDF to Object Storage
async function uploadPdfToStorage(jobId: string, pdfBuffer: Buffer, docType: DocumentType): Promise<string> {
  const storageKey = `jobs/${jobId}/documents/${docType.toLowerCase()}_${crypto.randomUUID()}.pdf`;
  
  // Fallback to local storage if AWS credentials are not configured
  if (!config.storage.accessKeyId || config.storage.accessKeyId.includes('mock') || config.storage.accessKeyId.includes('your-oci') || config.storage.accessKeyId === '') {
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

// Helper: calculate VAT
function calculateVat(netValue: string | number, rate: number = 0.2): { vatAmount: string; totalWithVat: string } {
  const net = typeof netValue === 'string' ? parseFloat(netValue) : netValue;
  const vat = net * rate;
  return {
    vatAmount: vat.toFixed(2),
    totalWithVat: (net + vat).toFixed(2),
  };
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
        include: {
          property: true,
          client: true,
          quoteLineItems: { where: { deletedAt: null }, orderBy: { createdAt: 'asc' } },
        },
      });

      if (!job) {
        res.status(404).json({ error: 'Not Found', message: 'Job not found.' });
        return;
      }

      // Stage-gating
      if (!QUOTE_ALLOWED_STATUSES.includes(job.status)) {
        res.status(400).json({
          error: 'Bad Request',
          message: 'Quote Report can only be generated once the job reaches QUOTED stage.',
        });
        return;
      }

      // Fetch diagnostic images as base64
      const diagnosticImages = await getBase64Images(job.id, 'DIAGNOSTIC');

      const quotedValue = job.quotedValue ? Number(job.quotedValue).toFixed(2) : '0.00';
      const { vatAmount, totalWithVat } = calculateVat(quotedValue);

      const snapshotData = {
        jobNumber: formatJobNumber(job.sequence),
        date: new Date().toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit', year: 'numeric' }),
        clientName: job.client?.name || 'No Client Assigned',
        propertyAddress: job.property?.address || 'No Property Assigned',
        description: job.description || 'No description provided.',
        quotedValue,
        vatAmount,
        totalWithVat,
        lineItems: job.quoteLineItems.map((item: any) => ({
          description: item.description,
          price: Number(item.price).toFixed(2),
          status: item.status,
        })),
        diagnosticImages,
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
        include: {
          property: true,
          assignedContractors: true,
          quoteLineItems: { where: { deletedAt: null }, orderBy: { createdAt: 'asc' } },
          workLogs: { include: { contractor: true } },
        },
      });

      if (!job) {
        res.status(404).json({ error: 'Not Found', message: 'Job not found.' });
        return;
      }

      // Stage-gating
      if (!JOB_SHEET_ALLOWED_STATUSES.includes(job.status)) {
        res.status(400).json({
          error: 'Bad Request',
          message: 'Job Sheet can only be generated once the job reaches QUOTED stage.',
        });
        return;
      }

      // Fetch diagnostic images as base64
      const diagnosticImages = await getBase64Images(job.id, 'DIAGNOSTIC');

      // Calculate estimated hours from work logs
      const totalHours = job.workLogs.reduce((sum: number, wl: any) => sum + Number(wl.hoursWorked), 0);
      const estimatedHours = totalHours > 0 ? `${totalHours} Hour${totalHours !== 1 ? 's' : ''}` : null;

      // Format scheduled date and time separately
      let scheduledDate = 'TBD';
      let scheduledTime = 'TBD';
      if (job.scheduledDate) {
        scheduledDate = job.scheduledDate.toLocaleDateString('en-GB', {
          weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
        });
        scheduledTime = job.scheduledDate.toLocaleTimeString('en-GB', {
          hour: '2-digit', minute: '2-digit',
        });
      }

      const snapshotData = {
        jobNumber: formatJobNumber(job.sequence),
        scheduledDate,
        scheduledTime,
        status: job.status.replace(/_/g, ' '),
        contractorName: job.assignedContractors && job.assignedContractors.length > 0
          ? job.assignedContractors.map((c: any) => c.name).join(', ')
          : 'Unassigned',
        propertyAddress: job.property?.address || 'No Property Assigned',
        tenantName: job.tenantSnapshotName || 'N/A',
        tenantPhone: job.tenantSnapshotPhone || '',
        accessNotes: job.property?.accessNotes || '',
        materials: job.materials || 'N/A',
        description: job.description || 'No description provided.',
        diagnosticNotes: job.diagnosticNotes || '',
        estimatedHours,
        lineItems: job.quoteLineItems.map((item: any) => ({
          description: item.description,
          price: Number(item.price).toFixed(2),
          status: item.status,
        })),
        diagnosticImages,
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
        include: {
          property: true,
          client: true,
          assignedContractors: true,
          quoteLineItems: { where: { deletedAt: null }, orderBy: { createdAt: 'asc' } },
          workLogs: {
            where: { deletedAt: null },
            include: { contractor: true },
            orderBy: { workDate: 'asc' },
          },
        },
      });

      if (!job) {
        res.status(404).json({ error: 'Not Found', message: 'Job not found.' });
        return;
      }

      // Stage-gating
      if (!COMPLETION_ALLOWED_STATUSES.includes(job.status)) {
        res.status(400).json({
          error: 'Bad Request',
          message: 'Completion Report can only be generated once the job is marked COMPLETED.',
        });
        return;
      }

      // Fetch both diagnostic and completion images as base64
      const diagnosticImages = await getBase64Images(job.id, 'DIAGNOSTIC');
      const completionImages = await getBase64Images(job.id, 'COMPLETION');

      const quotedValue = job.quotedValue ? Number(job.quotedValue).toFixed(2) : '0.00';
      const { vatAmount, totalWithVat } = calculateVat(quotedValue);

      // Build work logs data
      const workLogs = job.workLogs.map((wl: any) => ({
        contractorName: wl.contractor?.name || 'Unknown',
        date: wl.workDate.toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit', year: 'numeric' }),
        hours: `${Number(wl.hoursWorked)} Hour${Number(wl.hoursWorked) !== 1 ? 's' : ''}`,
      }));

      // Build "completed by" string from contractors
      const completedBy = job.assignedContractors && job.assignedContractors.length > 0
        ? job.assignedContractors.map((c: any) => c.name).join(' & ')
        : 'N/A';

      const snapshotData = {
        jobNumber: formatJobNumber(job.sequence),
        dateLogged: job.createdAt.toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit', year: 'numeric' }),
        completedAt: job.completedAt
          ? job.completedAt.toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit', year: 'numeric' })
          : new Date().toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit', year: 'numeric' }),
        clientName: job.client?.name || 'No Client Assigned',
        propertyAddress: job.property?.address || 'No Property Assigned',
        description: job.description || 'No description provided.',
        completionNotes: job.completionNotes || '',
        completedBy,
        quotedValue,
        vatAmount,
        totalWithVat,
        lineItems: job.quoteLineItems.map((item: any) => ({
          description: item.description,
          price: Number(item.price).toFixed(2),
          status: item.status,
        })),
        workLogs,
        diagnosticImages,
        completionImages,
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

// ── PATCH /api/documents/:id ───────────────────────────────────────────────────
// Edit a document's snapshot data and regenerate the PDF

router.patch(
  '/:id',
  [
    param('id').isUUID(),
    body('snapshotData').isObject(),
  ],
  validate,
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const doc = await prisma.generatedDocument.findUnique({
        where: { id: req.params['id'] },
        include: { job: true }
      });

      if (!doc) {
        res.status(404).json({ error: 'Not Found', message: 'Document not found.' });
        return;
      }

      const newSnapshotData = req.body.snapshotData;
      
      // We log the change
      await prisma.auditLog.create({
        data: {
          jobId: doc.jobId,
          action: AuditAction.UPDATE,
          performedById: req.user!.id,
          entityType: 'GeneratedDocument',
          entityId: doc.id,
          before: doc.snapshotData as any,
          after: newSnapshotData,
        }
      });

      // We need the template name
      let templateName = '';
      if (doc.type === 'QUOTE') templateName = 'quote';
      if (doc.type === 'JOB_SHEET') templateName = 'job_sheet';
      if (doc.type === 'COMPLETION_REPORT') templateName = 'completion_report';

      // Re-generate PDF with the updated snapshot
      const pdfBuffer = await generatePdf(templateName, newSnapshotData);
      
      // Re-upload (we can reuse the same storageKey to overwrite, or create a new one. Overwrite is easier)
      const storageKey = await uploadPdfToStorage(doc.jobId, pdfBuffer, doc.type);

      const updatedDoc = await prisma.generatedDocument.update({
        where: { id: doc.id },
        data: {
          snapshotData: newSnapshotData,
          storageKey, // in case it changed
        }
      });

      res.json(updatedDoc);
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

      const isDownload = req.query.download === 'true';
      const url = await getMediaSignedUrl(doc.storageKey, isDownload);
      res.json({ id: doc.id, url, type: doc.type });
    } catch (err) {
      next(err);
    }
  }
);

export default router;
