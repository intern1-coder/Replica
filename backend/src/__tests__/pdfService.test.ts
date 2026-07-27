import fs from 'fs';
import path from 'path';
import { generatePdf } from '../services/pdfService';

// Mock playwright to avoid ESM import errors in jest and to avoid
// needing a real Chromium installation for unit tests.
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
  };
});

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
    expect(pdfBuffer.length).toBeGreaterThan(10);
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
    expect(pdfBuffer.length).toBeGreaterThan(10);
  }, 10000);
});
