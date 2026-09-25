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
import { getMediaBuffer } from '../services/storageService';
import { sendReportEmail } from '../services/emailService';
import { getBase64Images } from '../services/imageEmbedder';
import { getVatRate } from './settings';
import juice from 'juice';
import { ACTIVE_ASSIGNED_CONTRACTORS } from '../lib/prismaSelects';
import { buildJobSheetSnapshot, resolveJobSheetContractor } from '../services/jobSheetSnapshot';
import { summariseWorkLogs } from '../services/workLogSummary';

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

function escapeHtml(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function formatInternalWorkLogsHtml(workLogs: Array<any>): string {
  if (workLogs.length === 0) return '';

  const rows = workLogs.map((workLog) => `
    <tr>
      <td style="border:1px solid #d1d5db;padding:8px 12px;">${escapeHtml(workLog.contractor?.name || 'Unknown')}</td>
      <td style="border:1px solid #d1d5db;padding:8px 12px;">${escapeHtml(new Date(workLog.workDate).toLocaleDateString('en-GB'))}</td>
      <td style="border:1px solid #d1d5db;padding:8px 12px;text-align:right;">${escapeHtml(workLog.hoursWorked)} hours</td>
      <td style="border:1px solid #d1d5db;padding:8px 12px;text-align:right;">£${escapeHtml(Number(workLog.rateApplied).toFixed(2))}</td>
      <td style="border:1px solid #d1d5db;padding:8px 12px;text-align:right;">£${escapeHtml(Number(workLog.materialCost).toFixed(2))}</td>
      <td style="border:1px solid #d1d5db;padding:8px 12px;">${escapeHtml(workLog.notes || '')}</td>
    </tr>`).join('');

  return `
    <section id="working-logs" style="margin-top:32px;border-top:2px solid #e5e7eb;padding-top:16px;font-family:Arial,sans-serif;color:#374151;">
      <div style="display:inline-block;background:#fef3c7;color:#92400e;border:1px solid #f59e0b;border-radius:999px;padding:3px 8px;font-size:11px;font-weight:600;margin-bottom:8px;">Included in Email Only</div>
      <h2 style="font-size:16px;margin:0 0 8px;">Working Logs</h2>
      <p style="font-size:12px;color:#6b7280;margin:0 0 12px;">For internal reference only. This section is not included in the attached PDF.</p>
      <table style="border-collapse:collapse;width:100%;font-size:12px;">
        <thead>
          <tr style="background:#f3f4f6;">
            <th style="border:1px solid #d1d5db;padding:8px 12px;text-align:left;">Engineer</th>
            <th style="border:1px solid #d1d5db;padding:8px 12px;text-align:left;">Work date</th>
            <th style="border:1px solid #d1d5db;padding:8px 12px;text-align:right;">Hours</th>
            <th style="border:1px solid #d1d5db;padding:8px 12px;text-align:right;">Rate</th>
            <th style="border:1px solid #d1d5db;padding:8px 12px;text-align:right;">Materials</th>
            <th style="border:1px solid #d1d5db;padding:8px 12px;text-align:left;">Notes</th>
          </tr>
        </thead>
        <tbody>${rows}
        </tbody>
      </table>
    </section>`;
}

async function buildDocumentEmailHtml(doc: { type: DocumentType; jobId: string; snapshotData: any }): Promise<string> {
  const templateName = templateNameForDocType(doc.type);
  const rawHtml = await renderTemplate(templateName, doc.snapshotData);
  let html = juice(rawHtml);

  if (doc.type === DocumentType.QUOTE) {
    const workLogs = await prisma.workLog.findMany({
      where: { jobId: doc.jobId, deletedAt: null },
      include: { contractor: { select: { name: true } } },
      orderBy: { workDate: 'asc' },
    });
    html = html.replace('</body>', `${formatInternalWorkLogsHtml(workLogs)}</body>`);
  }

  return html;
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
// engineerId (preferred) ties the sheet to a real, currently-assigned
// Engineer row and filters the Hours Logged table to that engineer's own
// entries. engineerName is a legacy free-text override — kept for
// backwards compatibility, but it has no FK and never filters hours.

router.post(
  '/job-sheet',
  requirePermission('documents:create'),
  [
    body('jobId').isUUID(),
    body('engineerId').optional().isUUID(),
    body('engineerName').optional().isString().trim(),
    body('includeHours').optional().isBoolean().toBoolean(),
    body('includeRates').optional().isBoolean().toBoolean(),
  ],
  validate,
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const job = await prisma.job.findUnique({
        where: { id: req.body.jobId, deletedAt: null },
        include: {
          property: true,
          assignedContractors: ACTIVE_ASSIGNED_CONTRACTORS,
          quoteLineItems: { where: { deletedAt: null }, orderBy: { createdAt: 'asc' } },
          workLogs: {
            where: { deletedAt: null },
            include: { contractor: { select: { id: true, name: true } } },
            orderBy: { workDate: 'asc' },
          },
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
          message: 'Job Sheet can only be generated once the job reaches AUTHORISED stage.',
        });
        return;
      }

      const resolution = resolveJobSheetContractor(job.assignedContractors, {
        engineerId: req.body.engineerId,
        engineerName: req.body.engineerName,
      });
      if ('error' in resolution) {
        res.status(422).json({ error: 'Unprocessable Entity', message: resolution.error });
        return;
      }

      // Fetch diagnostic images as base64
      const diagnosticImages = await getBase64Images(job.id, 'DIAGNOSTIC');

      const includeHours = req.body.includeHours !== false;
      // Rates are margin-sensitive — opt-in, and gated server-side regardless
      // of what the request body asks for.
      const includeRates = req.body.includeRates === true && req.user!.can('engineer_costs:view');

      const snapshotData = buildJobSheetSnapshot(job, {
        contractorName: resolution.contractorName,
        matchedEngineerId: resolution.matchedEngineerId,
        includeHours,
        includeRates,
        diagnosticImages,
      });

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
          assignedContractors: ACTIVE_ASSIGNED_CONTRACTORS,
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
      const totalHours = includeWorkLogs
        ? summariseWorkLogs(
            job.workLogs.map((wl: any) => ({
              contractorId: wl.contractorId,
              hoursWorked: wl.hoursWorked,
              rateApplied: 0,
              materialCost: 0,
            }))
          ).totals.hours
        : '0.00';

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
        totalHours,
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
// Edits a document's snapshot data and regenerates the PDF as a NEW
// GeneratedDocument row — the original row and its storageKey are left
// untouched and still downloadable. A new version of a report is a new row,
// never an overwrite in place (Rules.md).

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
      const templateName = templateNameForDocType(doc.type);

      // Re-generate PDF with the edited snapshot
      const pdfBuffer = await generatePdf(templateName, newSnapshotData);
      const storageKey = await uploadPdfToStorage(doc.jobId, pdfBuffer, doc.type);

      const newDoc = await prisma.generatedDocument.create({
        data: {
          jobId: doc.jobId,
          type: doc.type,
          storageKey,
          snapshotData: newSnapshotData,
          generatedById: req.user!.id,
        },
      });

      await prisma.auditLog.create({
        data: {
          jobId: doc.jobId,
          action: AuditAction.CREATE,
          performedById: req.user!.id,
          entityType: 'GeneratedDocument',
          entityId: newDoc.id,
          before: doc.snapshotData as any,
          after: newSnapshotData,
        }
      });

      emitToJob(doc.jobId, 'document:created', { jobId: doc.jobId, ts: new Date().toISOString() });
      res.json(newDoc);
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

      // Most email clients strip <style> blocks on paste — inline the rules
      // onto each element so tables, borders and colours survive.
      const html = await buildDocumentEmailHtml(doc);

      res.json({ html });
    } catch (err) {
      next(err);
    }
  }
);

// ── POST /api/documents/:id/email ─────────────────────────────────────────────
// Sends the clean stored PDF as an attachment. Internal work logs are added
// to the email body only, never to the PDF or persisted document snapshot.
router.post(
  '/:id/email',
  requirePermission('documents:create'),
  [
    param('id').isUUID(),
    body('toEmail').isEmail().normalizeEmail(),
    body('toName').optional().isString().trim().isLength({ max: 255 }),
  ],
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

      const html = await buildDocumentEmailHtml(doc);
      const pdfBuffer = await getMediaBuffer(doc.storageKey);
      const filename = buildDocumentFilename(doc);
      const reportName = doc.type.replace(/_/g, ' ');

      await sendReportEmail({
        toEmail: req.body.toEmail,
        toName: req.body.toName,
        subject: `${reportName} - ${doc.snapshotData && typeof doc.snapshotData === 'object' && 'jobNumber' in doc.snapshotData ? doc.snapshotData.jobNumber : 'Job'}`,
        html,
        attachment: {
          filename,
          content: pdfBuffer,
          contentType: 'application/pdf',
        },
      });

      res.json({ message: 'Report email sent.' });
    } catch (err) {
      next(err);
    }
  }
);

export default router;
