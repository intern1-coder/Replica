import fs from 'fs';
import path from 'path';
import { generatePdf, renderTemplate } from '../services/pdfService';
import config from '../config';

// Mock playwright to avoid ESM import errors in jest and to avoid
// needing a real Chromium installation for unit tests. __mockPage is a
// test-only escape hatch (not part of the real playwright module) so a
// single test can force page.pdf() to reject and exercise the render-failure
// path without depending on other tests' execution order.
jest.mock('playwright', () => {
  const mockPage = {
    setContent: jest.fn().mockResolvedValue(undefined),
    pdf: jest.fn().mockResolvedValue(Buffer.from('mock-pdf-content')),
    close: jest.fn().mockResolvedValue(undefined),
  };
  const mockContext = {
    newPage: jest.fn().mockResolvedValue(mockPage),
    close: jest.fn().mockResolvedValue(undefined),
  };
  const mockBrowser = {
    isConnected: () => true,
    newContext: jest.fn().mockResolvedValue(mockContext),
    close: jest.fn().mockResolvedValue(undefined),
  };
  return {
    chromium: {
      launch: jest.fn().mockResolvedValue(mockBrowser),
    },
    __mockPage: mockPage,
  };
});

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { __mockPage: mockPdfPage } = require('playwright');

describe('PDF Generation Service', () => {
  it('quote template includes shared header partial (footer rendered by Puppeteer)', () => {
    const templatesDir = path.join(__dirname, '../../templates');
    const quote = fs.readFileSync(path.join(templatesDir, 'quote.hbs'), 'utf-8');
    const header = fs.readFileSync(path.join(templatesDir, 'partials/_company_header.hbs'), 'utf-8');
    const footer = fs.readFileSync(path.join(templatesDir, 'partials/_company_footer.hbs'), 'utf-8');

    expect(quote).toContain('_company_header');
    expect(quote).not.toContain('_company_footer');
    expect(header).toContain('logoSrc');
    expect(footer).toContain('www.affinityproperty.co.uk');
    expect(footer).toContain('info@affinityproperty.co.uk');
    expect(footer).toContain('0203 002 6344');
  });

  it('generates a Quote PDF', async () => {
    const data = {
      jobNumber: 'JOB-0001',
      date: '01/01/2026',
      clientName: 'Test Client',
      propertyAddress: '123 Test St',
      description: 'Fix the boiler',
      quotedValue: '500.00',
    };

    const pdfBuffer = await generatePdf('quote', data);
    expect(Buffer.isBuffer(pdfBuffer)).toBe(true);
    // Exact match against the mocked page.pdf() output — guards against the
    // real path silently falling through to the dummy-PDF error fallback,
    // which would also satisfy a looser "length > 10" check.
    expect(pdfBuffer).toEqual(Buffer.from('mock-pdf-content'));
  }, 10000); // 10s timeout for puppeteer launch

  it('generates a Job Sheet PDF', async () => {
    const data = {
      jobNumber: 'JOB-0002',
      scheduledDate: '02/01/2026',
      contractorName: 'Bob Builder',
      propertyAddress: '456 Another St',
      tenantName: 'Alice',
      tenantPhone: '555-1234',
      accessNotes: 'Key under the mat',
      description: 'Paint the walls',
      diagnosticNotes: 'Needs 2 coats',
    };

    const pdfBuffer = await generatePdf('job_sheet', data);
    expect(Buffer.isBuffer(pdfBuffer)).toBe(true);
    // Exact match against the mocked page.pdf() output — length > 10 would
    // also pass for the dummy fallback buffer, which is exactly the hole
    // that let a total render failure look like success.
    expect(pdfBuffer).toEqual(Buffer.from('mock-pdf-content'));
  }, 10000);

  it('generates a Completion Report PDF', async () => {
    const data = {
      jobNumber: 'JOB-0003',
      completedAt: '03/01/2026',
      clientName: 'Test Client',
      propertyAddress: '789 Done Ave',
      completionNotes: 'All walls painted',
    };

    const pdfBuffer = await generatePdf('completion_report', data);
    expect(Buffer.isBuffer(pdfBuffer)).toBe(true);
    expect(pdfBuffer).toEqual(Buffer.from('mock-pdf-content'));
  }, 10000);

  it('generatePdf rejects (does not fall back to a placeholder) when rendering fails and allowMockFallback is off', async () => {
    const originalFallback = config.puppeteer.allowMockFallback;
    (config.puppeteer as any).allowMockFallback = false;
    try {
      mockPdfPage.pdf.mockRejectedValueOnce(new Error('render crashed'));
      await expect(generatePdf('quote', { jobNumber: 'JOB-0099' })).rejects.toThrow('render crashed');
    } finally {
      (config.puppeteer as any).allowMockFallback = originalFallback;
    }
  }, 10000);

  it('job_sheet template renders an Hours Logged table with a total when includeHours is true', async () => {
    const html = await renderTemplate('job_sheet', {
      jobNumber: 'JOB-0004',
      contractorName: 'Bob Builder',
      propertyAddress: '1 Test St',
      status: 'AUTHORISED',
      includeHours: true,
      includeRates: false,
      hoursColSpan: 2,
      workLogs: [
        { date: '14/07/2026', contractorName: 'Bob Builder', hours: '4.00', notes: '' },
        { date: '15/07/2026', contractorName: 'Bob Builder', hours: '3.50', notes: '' },
      ],
      totalHours: '7.50',
    });
    expect(html).toContain('Hours Logged');
    expect(html).toContain('7.50');
    expect(html).not.toContain('Rate (£)');
  });

  it('job_sheet template includes the Rate column and labour total only when includeRates is true', async () => {
    const html = await renderTemplate('job_sheet', {
      jobNumber: 'JOB-0005',
      contractorName: 'Bob Builder',
      propertyAddress: '1 Test St',
      status: 'AUTHORISED',
      includeHours: true,
      includeRates: true,
      hoursColSpan: 3,
      workLogs: [{ date: '14/07/2026', contractorName: 'Bob Builder', hours: '4.00', rate: '35.00', lineTotal: '140.00', notes: '' }],
      totalHours: '4.00',
      totalLabour: '140.00',
    });
    expect(html).toContain('Rate (£)');
    expect(html).toContain('140.00');
  });

  it('Diagnostic Report template has bold main heading (item 13)', () => {
    const templatesDir = path.join(__dirname, '../../templates');
    const quote = fs.readFileSync(path.join(templatesDir, 'quote.hbs'), 'utf-8');

    expect(quote).toMatch(/\.report-title\s*\{[^}]*font-weight:\s*700/);
    expect(quote).toContain('<div class="report-title">Diagnostic Report</div>');
  });

  it('Completion Report template has bold main heading (item 13)', () => {
    const templatesDir = path.join(__dirname, '../../templates');
    const completion = fs.readFileSync(path.join(templatesDir, 'completion_report.hbs'), 'utf-8');

    expect(completion).toMatch(/\.report-title\s*\{[^}]*font-weight:\s*700/);
    expect(completion).toContain('<div class="report-title">Completion Report</div>');
  });
});
