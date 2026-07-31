import { DocumentType } from '@prisma/client';

// Filesystem-illegal on Windows; also awkward in a Content-Disposition header.
const ILLEGAL_FILENAME_CHARS = /[/\\:*?"<>|]/g;

/** Human-readable download filename built from the document's own snapshot. */
export function buildDocumentFilename(doc: { type: DocumentType; snapshotData: unknown }): string {
  const snapshot = (doc.snapshotData || {}) as Record<string, unknown>;
  const address = String(snapshot['propertyAddress'] || 'Property').replace(ILLEGAL_FILENAME_CHARS, '');

  let name: string;
  switch (doc.type) {
    case DocumentType.QUOTE:
      name = `Diagnostic Report – ${address}`;
      break;
    case DocumentType.COMPLETION_REPORT:
      name = `Completion Report – ${address}`;
      break;
    case DocumentType.JOB_SHEET: {
      const contractor = String(snapshot['contractorName'] || 'Contractor').replace(ILLEGAL_FILENAME_CHARS, '');
      name = `Job Sheet – ${contractor} – ${address}`;
      break;
    }
    default:
      name = `Document – ${address}`;
  }

  return `${name.slice(0, 200)}.pdf`;
}
