import { DocumentType } from '@prisma/client';
import { buildDocumentFilename } from '../lib/documentFilename';

const SAMPLE_ADDRESS = '51 Tolcarne Drive, Pinner, Middlesex, HA5 2DH';

describe('buildDocumentFilename', () => {
  it('builds Diagnostic Report filename with property address (item 7)', () => {
    const filename = buildDocumentFilename({
      type: DocumentType.QUOTE,
      snapshotData: { propertyAddress: SAMPLE_ADDRESS },
    });
    expect(filename).toBe(`Diagnostic Report – ${SAMPLE_ADDRESS}.pdf`);
  });

  it('builds Completion Report filename with property address (item 8)', () => {
    const filename = buildDocumentFilename({
      type: DocumentType.COMPLETION_REPORT,
      snapshotData: { propertyAddress: SAMPLE_ADDRESS },
    });
    expect(filename).toBe(`Completion Report – ${SAMPLE_ADDRESS}.pdf`);
  });

  it('builds Job Sheet filename with contractor name and address (item 10)', () => {
    const filename = buildDocumentFilename({
      type: DocumentType.JOB_SHEET,
      snapshotData: {
        contractorName: 'Gabi',
        propertyAddress: SAMPLE_ADDRESS,
      },
    });
    expect(filename).toBe(`Job Sheet – Gabi – ${SAMPLE_ADDRESS}.pdf`);
  });

  it('falls back to Contractor when contractorName is missing from snapshot', () => {
    const filename = buildDocumentFilename({
      type: DocumentType.JOB_SHEET,
      snapshotData: { propertyAddress: SAMPLE_ADDRESS },
    });
    expect(filename).toBe(`Job Sheet – Contractor – ${SAMPLE_ADDRESS}.pdf`);
  });

  it('falls back to Property when propertyAddress is missing', () => {
    const filename = buildDocumentFilename({
      type: DocumentType.QUOTE,
      snapshotData: {},
    });
    expect(filename).toBe('Diagnostic Report – Property.pdf');
  });

  it('strips filesystem-illegal characters from address and contractor', () => {
    const filename = buildDocumentFilename({
      type: DocumentType.JOB_SHEET,
      snapshotData: {
        contractorName: 'Gabi/Test',
        propertyAddress: '51 Tolcarne Drive: Pinner',
      },
    });
    expect(filename).toBe('Job Sheet – GabiTest – 51 Tolcarne Drive Pinner.pdf');
  });

  it('truncates very long filenames to 200 characters plus .pdf extension', () => {
    const longAddress = 'A'.repeat(250);
    const filename = buildDocumentFilename({
      type: DocumentType.QUOTE,
      snapshotData: { propertyAddress: longAddress },
    });
    expect(filename.endsWith('.pdf')).toBe(true);
    expect(filename.length).toBe(204); // 200 chars + '.pdf'
  });
});
