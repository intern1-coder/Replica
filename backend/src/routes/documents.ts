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
import { requireAuth, requirePermission } from '../middleware/auth';
import { generatePdf, renderTemplate } from '../services/pdfService';
import { buildDocumentFilename } from '../lib/documentFilename';
import { formatJobNumber, formatPropertyAddress } from '../lib/utils';
import logger from '../lib/logger';
import { emitToJob } from '../lib/socket';
import { getMediaSignedUrl } from '../services/storageService';
import { getBase64Images } from '../services/imageEmbedder';
import { getVatRate } from './settings';
import juice from 'juice';

const router = Router();
router.use(requireAuth);
router.use(requirePermission('documents:view'));

// ── Stage-Gating: which statuses allow which documents ──────────────────────
const QUOTE_ALLOWED_STATUSES: JobStatus[] = [JobStatus.QUOTED, JobStatus.AUTHORISED, JobStatus.PENDING_INVOICE, JobStatus.COMPLETED];
const JOB_SHEET_ALLOWED_STATUSES: JobStatus[] = [JobStatus.AUTHORISED, JobStatus.PENDING_INVOICE, JobStatus.COMPLETED];
// Completion report unlocks at PENDING_INVOICE so Accounts can review it
// before signing the job off as COMPLETED.
const COMPLETION_ALLOWED_STATUSES: JobStatus[] = [JobStatus.PENDING_INVOICE, JobStatus.COMPLETED];

// Uploads PDF to S3-compatible object storage. Falls back to local disk when
// credentials are absent or mocked (dev/CI environments). Returns the storage key
// used for later signed-URL retrieval.
async function uploadPdfToStorage(jobId: string, pdfBuffer: Buffer, docType: DocumentType): Promise<string> {
  const storageKey = `jobs/${jobId}/documents/${docType.toLowerCase()}_${crypto.randomUUID()}.pdf`;

  // Fallback to local storage if AWS credentials are not configured
  if (!config.storage.accessKeyId || config.storage.accessKeyId.includes('mock') || config.storage.accessKeyId.includes('your-') || config.storage.accessKeyId === '') {
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

// Accepts Prisma Decimal strings or plain numbers; rate comes from getVatRate().
function calculateVat(netValue: string | number, rate: number = 0.2): { vatAmount: string; totalWithVat: string } {
  const net = typeof netValue === 'string' ? parseFloat(netValue) : netValue;
  const vat = net * rate;
  return {
    vatAmount: vat.toFixed(2),
    totalWithVat: (net + vat).toFixed(2),
  };
}

function templateNameForDocType(type: DocumentType): string {
  switch (type) {
    case DocumentType.QUOTE: return 'quote';
    case DocumentType.JOB_SHEET: return 'job_sheet';
    case DocumentType.COMPLETION_REPORT: return 'completion_report';
    default: return '';
  }
}

// ── POST /api/documents/quote ──────────────────────────────────────────────────

router.post(
  '/quote',
  requirePermission('documents:create'),
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
      const vatRate = await getVatRate();
      const { vatAmount, totalWithVat } = calculateVat(quotedValue, vatRate);
      const vatPercent = (vatRate * 100).toString();

      const snapshotData = {
        jobNumber: formatJobNumber(job.sequence),
        date: new Date().toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit', year: 'numeric' }),
        clientName: job.client?.name || 'No Client Assigned',
        propertyAddress: job.property ? formatPropertyAddress(job.property) : 'No Property Assigned',
        description: job.description || 'No description provided.',
        quotedValue,
        vatAmount,
        totalWithVat,
        vatPercent,
        lineItems: job.quoteLineItems.map((item: any) => ({
          description: item.description,
          price: Number(item.price).toFixed(2),
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

      emitToJob(job.id, 'document:created', { jobId: job.id, ts: new Date().toISOString() });
      res.status(201).json(doc);
    } catch (err) {
      next(err);
    }
  }
);

// ── POST /api/documents/job-sheet ──────────────────────────────────────────────

router.post(
  '/job-sheet',
  requirePermission('documents:create'),
  [body('jobId').isUUID(), body('engineerName').optional().isString().trim()],
  validate,
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const job = await prisma.job.findUnique({
        where: { id: req.body.jobId, deletedAt: null },
        include: {
          property: true,
          assignedContractors: true,
          quoteLineItems: { where: { deletedAt: null }, orderBy: { createdAt: 'asc' } },
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

      // Use provided engineerName override or fall back to assigned engineers
      const contractorName = req.body.engineerName
        || (job.assignedContractors && job.assignedContractors.length > 0
          ? job.assignedContractors.map((c: any) => c.name).join(', ')
          : 'Unassigned');

      const snapshotData = {
        jobNumber: formatJobNumber(job.sequence),
        scheduledDate,
        scheduledTime,
        status: 'AUTHORISED',
        contractorName,
        propertyAddress: job.property ? formatPropertyAddress(job.property) : 'No Property Assigned',
        tenantName: job.tenantSnapshotName || 'N/A',
        tenantPhone: job.tenantSnapshotPhone || '',
        accessNotes: job.property?.accessNotes || '',
        materials: job.materials || 'N/A',
        description: job.description || 'No description provided.',
        diagnosticNotes: job.diagnosticNotes || '',
        lineItems: job.quoteLineItems.map((item: any) => ({
          description: item.description,
          price: Number(item.price).toFixed(2),
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

      emitToJob(job.id, 'document:created', { jobId: job.id, ts: new Date().toISOString() });
      res.status(201).json(doc);
    } catch (err) {
      next(err);
    }
  }
);

// ── POST /api/documents/completion-report ──────────────────────────────────────

router.post(
  '/completion-report',
  requirePermission('documents:create'),
  [
    body('jobId').isUUID(),
    // Logged hours are hidden from client reports unless explicitly opted in —
    // protects margins by default.
    body('includeWorkLogs').optional().isBoolean().toBoolean(),
    // Diagnostic (before) photos are included by default — opt out per report.
    body('includeDiagnosticImages').optional().isBoolean().toBoolean(),
  ],
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
          message: 'Completion Report can only be generated once the job reaches PENDING_INVOICE.',
        });
        return;
      }

      const includeDiagnosticImages = req.body.includeDiagnosticImages !== false;

      // Fetch completion images always; diagnostic images only when opted in.
      const diagnosticImages = includeDiagnosticImages ? await getBase64Images(job.id, 'DIAGNOSTIC') : [];
      const completionImages = await getBase64Images(job.id, 'COMPLETION');

      const quotedValue = job.quotedValue ? Number(job.quotedValue).toFixed(2) : '0.00';
      const vatRate = await getVatRate();
      const { vatAmount, totalWithVat } = calculateVat(quotedValue, vatRate);
      const vatPercent = (vatRate * 100).toString();

      const includeWorkLogs = req.body.includeWorkLogs === true;

      // Build work logs data — only when the report should show logged hours
      const workLogs = !includeWorkLogs ? [] : job.workLogs.map((wl: any) => ({
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
        propertyAddress: job.property ? formatPropertyAddress(job.property) : 'No Property Assigned',
        description: job.description || 'No description provided.',
        completionNotes: job.completionNotes || '',
        completedBy,
        quotedValue,
        vatAmount,
        totalWithVat,
        vatPercent,
        lineItems: job.quoteLineItems.map((item: any) => ({
          description: item.description,
          price: Number(item.price).toFixed(2),
        })),
        includeWorkLogs,
        workLogs,
        includeDiagnosticImages,
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

      emitToJob(job.id, 'document:created', { jobId: job.id, ts: new Date().toISOString() });
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
  requirePermission('documents:edit'),
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

      const templateName = templateNameForDocType(doc.type);

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
      const filename = buildDocumentFilename(doc);
      const url = await getMediaSignedUrl(doc.storageKey, isDownload, filename);
      res.json({ id: doc.id, url, type: doc.type, filename });
    } catch (err) {
      next(err);
    }
  }
);

// ── GET /api/documents/:id/html ─────────────────────────────────────────────────
// Re-renders the report as a standalone, email-safe HTML string for pasting
// directly into an email client. Not persisted — rebuilt on demand from the
// same snapshotData used to generate the PDF, so it always matches it exactly.

router.get(
  '/:id/html',
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

      const templateName = templateNameForDocType(doc.type);
      if (!templateName) {
        res.status(500).json({ error: 'Internal Server Error', message: 'Unknown document type.' });
        return;
      }

      const rawHtml = await renderTemplate(templateName, doc.snapshotData);
      // Most email clients strip <style> blocks on paste — inline the rules
      // onto each element so tables, borders and colours survive.
      const html = juice(rawHtml);

      res.json({ html });
    } catch (err) {
      next(err);
    }
  }
);

export default router;
