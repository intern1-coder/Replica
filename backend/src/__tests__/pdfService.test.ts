import { generatePdf } from '../services/pdfService';

// Mock puppeteer-core to avoid ESM import errors in jest and to avoid
// needing a real Chrome installation for unit tests.
jest.mock('puppeteer-core', () => {
  return {
    launch: jest.fn().mockResolvedValue({
      newPage: jest.fn().mockResolvedValue({
        setContent: jest.fn().mockResolvedValue(undefined),
        pdf: jest.fn().mockResolvedValue(Buffer.from('mock-pdf-content')),
      }),
      close: jest.fn().mockResolvedValue(undefined),
    }),
  };
});

describe('PDF Generation Service', () => {
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
    expect(pdfBuffer.length).toBeGreaterThan(10); // Should be a substantial buffer
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
