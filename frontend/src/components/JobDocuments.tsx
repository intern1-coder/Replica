import { useState, useEffect } from 'react';
import { apiFetch } from '../utils/api';
import { FileText, Lock, Edit, X, Copy } from 'lucide-react';
import { DocumentEditModal } from './DocumentEditModal';
import { useToast } from '../contexts/ToastContext';
import { useAuth } from '../contexts/AuthContext';

interface GeneratedDocument {
  id: string;
  type: 'QUOTE' | 'JOB_SHEET' | 'COMPLETION_REPORT';
  presignedUrl?: string;
  createdAt: string;
  generatedBy?: { name: string };
  snapshotData?: any;
}

// Mirrors the stage-gating constants in backend/src/routes/documents.ts.
// If you update one, update the other — the backend enforces the rule; this
// drives the UI lock/unlock state so users see the right affordances.
const DOCUMENT_STAGE_RULES: Record<string, { allowed: string[]; message: string }> = {
  QUOTE: {
    allowed: ['QUOTED', 'AUTHORISED', 'PENDING_INVOICE', 'COMPLETED'],
    message: 'Diagnostic Report can only be generated once the job reaches QUOTED stage.',
  },
  JOB_SHEET: {
    allowed: ['AUTHORISED', 'PENDING_INVOICE', 'COMPLETED'],
    message: 'Job Sheet can only be generated once the job reaches AUTHORISED stage.',
  },
  COMPLETION_REPORT: {
    allowed: ['PENDING_INVOICE', 'COMPLETED'],
    message: 'Completion Report can only be generated once the job reaches PENDING INVOICE stage.',
  },
};

interface Engineer {
  id: string;
  name: string;
}

export function JobDocuments({ jobId, jobStatus, scheduledDate, assignedContractors }: { jobId: string; jobStatus: string; scheduledDate?: string | null; assignedContractors?: Engineer[] }) {
  const { showToast } = useToast();
  const { socket, can } = useAuth();
  const [docs, setDocs] = useState<GeneratedDocument[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isGenerating, setIsGenerating] = useState(false);
  const [copyingId, setCopyingId] = useState<string | null>(null);
  const [error, setError] = useState('');

  const [editingDoc, setEditingDoc] = useState<GeneratedDocument | null>(null);
  // Hidden by default — logged hours are internal; opt in per report.
  const [includeWorkLogs, setIncludeWorkLogs] = useState(false);
  // Included by default — opt out when diagnostic photos shouldn't go to the client.
  const [includeDiagnosticImages, setIncludeDiagnosticImages] = useState(true);
  const [confirmDialog, setConfirmDialog] = useState<{isOpen: boolean, message: string, onConfirm: () => void} | null>(null);

  // Job Sheet chooser dialog
  const [showJobSheetDialog, setShowJobSheetDialog] = useState(false);
  const [customEngineerName, setCustomEngineerName] = useState('');
  const [isGeneratingMultiple, setIsGeneratingMultiple] = useState(false);
  // Hours ON by default (the sheet's whole purpose is showing the engineer
  // their own hours); rates OFF by default and only offered to users who can
  // already see rates elsewhere — both enforced again server-side.
  const [includeJobSheetHours, setIncludeJobSheetHours] = useState(true);
  const [includeJobSheetRates, setIncludeJobSheetRates] = useState(false);
  const [jobSheetHoursByEngineer, setJobSheetHoursByEngineer] = useState<Record<string, string>>({});

  useEffect(() => {
    loadDocs();
  }, [jobId]);

  // Real-time: reload when a document is generated for this job
  useEffect(() => {
    if (!socket) return;
    const handler = (payload: { jobId: string }) => {
      if (payload.jobId === jobId) loadDocs();
    };
    socket.on('document:created', handler);
    return () => { socket.off('document:created', handler); };
  }, [socket, jobId]);

  const loadDocs = async () => {
    try {
      const jobData = await apiFetch(`/jobs/${jobId}`);
      setDocs(jobData.generatedDocuments || []);
    } catch (err: any) {
      setError('Failed to load documents.');
    } finally {
      setIsLoading(false);
    }
  };

  const isDocAllowed = (type: string): boolean => {
    const rule = DOCUMENT_STAGE_RULES[type];
    return rule ? rule.allowed.includes(jobStatus) : false;
  };

  const generateJobSheet = async (engineerId?: string, engineerName?: string) => {
    setIsGenerating(true);
    setError('');
    try {
      const newDoc = await apiFetch('/documents/job-sheet', {
        method: 'POST',
        body: JSON.stringify({
          jobId,
          engineerId: engineerId || undefined,
          engineerName: engineerName || undefined,
          includeHours: includeJobSheetHours,
          includeRates: includeJobSheetRates,
        }),
      });
      setDocs((prev) => [newDoc, ...prev]);
      showToast('Job Sheet generated', 'success');
    } catch (err: any) {
      setError(err.message || 'Failed to generate Job Sheet');
      showToast(err.message || 'Failed to generate Job Sheet', 'error');
    } finally {
      setIsGenerating(false);
    }
  };

  const handleGenerateForAll = async () => {
    if (!assignedContractors || assignedContractors.length === 0) return;
    setIsGeneratingMultiple(true);
    setError('');
    const newDocs: GeneratedDocument[] = [];
    for (const eng of assignedContractors) {
      try {
        const doc = await apiFetch('/documents/job-sheet', {
          method: 'POST',
          body: JSON.stringify({
            jobId,
            engineerId: eng.id,
            includeHours: includeJobSheetHours,
            includeRates: includeJobSheetRates,
          }),
        });
        newDocs.push(doc);
      } catch (err: any) {
        setError(`Failed to generate sheet for ${eng.name}: ` + err.message);
      }
    }
    setDocs((prev) => [...newDocs.reverse(), ...prev]);
    setIsGeneratingMultiple(false);
    setShowJobSheetDialog(false);
  };

  const handleGenerate = async (type: 'QUOTE' | 'JOB_SHEET' | 'COMPLETION_REPORT') => {
    if (!isDocAllowed(type)) {
      const rule = DOCUMENT_STAGE_RULES[type];
      showToast(rule?.message || 'This document cannot be generated at this stage.', 'error');
      return;
    }

    if (type === 'JOB_SHEET' && !scheduledDate) {
      showToast('Set a Job Date in Job Details before generating a Job Sheet.', 'error');
      return;
    }

    if (type === 'JOB_SHEET') {
      setCustomEngineerName('');
      setShowJobSheetDialog(true);
      apiFetch(`/work-logs/summary?jobId=${jobId}`)
        .then((res) => {
          const byId: Record<string, string> = {};
          (res.byContractor || []).forEach((c: { contractorId: string; hours: string }) => { byId[c.contractorId] = c.hours; });
          setJobSheetHoursByEngineer(byId);
        })
        .catch(() => setJobSheetHoursByEngineer({}));
      return;
    }

    // Missing Image Alerts
    try {
      if (type === 'QUOTE' || type === 'COMPLETION_REPORT') {
        const media = await apiFetch(`/job-media?jobId=${jobId}`);
        const hasDiagnostic = media.some((m: any) => m.mediaType === 'DIAGNOSTIC');
        const hasCompletion = media.some((m: any) => m.mediaType === 'COMPLETION');
        
        if (type === 'QUOTE' && !hasDiagnostic) {
          setConfirmDialog({
            isOpen: true,
            message: "You haven't uploaded any Diagnostic Photos for this job. Are you sure you want to generate the Diagnostic Report without images?",
            onConfirm: () => { setConfirmDialog(null); executeGenerate(type); }
          });
          return;
        }
        if (type === 'COMPLETION_REPORT') {
          if (!hasDiagnostic && !hasCompletion) {
            setConfirmDialog({
              isOpen: true,
              message: "You haven't uploaded any Diagnostic (Before) or Completion (After) photos for this job. Are you sure you want to generate the Completion Report without them?",
              onConfirm: () => { setConfirmDialog(null); executeGenerate(type); }
            });
            return;
          } else if (!hasCompletion) {
            setConfirmDialog({
              isOpen: true,
              message: "You haven't uploaded any Completion (After) photos. Are you sure you want to generate the Completion Report without them?",
              onConfirm: () => { setConfirmDialog(null); executeGenerate(type); }
            });
            return;
          }
        }
      }

      executeGenerate(type);
    } catch (err: any) {
      setError('Failed to check media before generation.');
    }
  };

  const executeGenerate = async (type: 'QUOTE' | 'JOB_SHEET' | 'COMPLETION_REPORT') => {
    setIsGenerating(true);
    setError('');

    let endpoint = '';
    if (type === 'QUOTE') endpoint = '/documents/quote';
    if (type === 'JOB_SHEET') endpoint = '/documents/job-sheet';
    if (type === 'COMPLETION_REPORT') endpoint = '/documents/completion-report';

    try {
      const newDoc = await apiFetch(endpoint, {
        method: 'POST',
        body: JSON.stringify(
          type === 'COMPLETION_REPORT' ? { jobId, includeWorkLogs, includeDiagnosticImages } : { jobId }
        )
      });
      setDocs([newDoc, ...docs]);
      showToast(`${type.replace(/_/g, ' ')} generated`, 'success');
    } catch (err: any) {
      setError(err.message || `Failed to generate ${type}`);
      showToast(err.message || `Failed to generate ${type}`, 'error');
    } finally {
      setIsGenerating(false);
    }
  };

  const handleDocAction = async (id: string, action: 'preview' | 'download') => {
    try {
      const response = await apiFetch(`/documents/${id}/url?download=${action === 'download'}`);
      if (action === 'download') {
        const a = document.createElement('a');
        a.href = response.url;
        a.download = response.filename || '';
        a.click();
      } else {
        window.open(response.url, '_blank');
      }
    } catch (err) {
      showToast('Failed to get document URL', 'error');
    }
  };

  const handleCopyForEmail = async (id: string) => {
    setCopyingId(id);
    try {
      const response = await apiFetch(`/documents/${id}/html`);
      const html: string = response.html;
      const plainText = html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();

      if (typeof ClipboardItem !== 'undefined' && navigator.clipboard?.write) {
        await navigator.clipboard.write([
          new ClipboardItem({
            'text/html': new Blob([html], { type: 'text/html' }),
            'text/plain': new Blob([plainText], { type: 'text/plain' }),
          }),
        ]);
      } else {
        await navigator.clipboard.writeText(plainText);
      }
      showToast('Report copied — paste it into your email', 'success');
    } catch (err) {
      showToast('Failed to copy report for email', 'error');
    } finally {
      setCopyingId(null);
    }
  };

  const renderButton = (
    type: 'QUOTE' | 'JOB_SHEET' | 'COMPLETION_REPORT',
    label: string,
    btnClass: 'doc-btn-quote' | 'doc-btn-jobsheet' | 'doc-btn-completion'
  ) => {
    const allowed = isDocAllowed(type);
    const rule = DOCUMENT_STAGE_RULES[type];
    return (
      <button
        type="button"
        onClick={() => handleGenerate(type)}
        disabled={isGenerating}
        className={`button ${allowed ? `primary ${btnClass}` : 'locked'}`}
        title={allowed ? `Generate ${label}` : rule?.message}
        aria-label={allowed ? label : `${label} — ${rule?.message}`}
      >
        {allowed ? <FileText size={16} /> : <Lock size={16} />}
        {label}
        {!allowed && <span className="doc-btn-locked-hint">Locked</span>}
      </button>
    );
  };

  return (
    <div className="section-card">
      <div className="section-card-header">
        <h3 style={{ fontSize: '1rem', margin: 0 }}>Documents (PDF)</h3>
      </div>
      
      {error && <div className="page-error">{error}</div>}

      <div className="flex" style={{ gap: 'var(--space-sm)', marginBottom: 'var(--space-md)', flexWrap: 'wrap', alignItems: 'center' }}>
        {renderButton('QUOTE', 'Generate Diagnostic Report', 'doc-btn-quote')}
        {renderButton('JOB_SHEET', 'Generate Job Sheet', 'doc-btn-jobsheet')}
        {renderButton('COMPLETION_REPORT', 'Generate Completion Report', 'doc-btn-completion')}
        {isGenerating && <span className="flex items-center text-secondary" style={{ fontSize: '0.85rem' }}>Generating PDF...</span>}
      </div>

      {isDocAllowed('COMPLETION_REPORT') && (
        <div className="flex" style={{ flexDirection: 'column', gap: 'var(--space-xs)', marginBottom: 'var(--space-md)' }}>
          <label className="flex items-center gap-2" style={{ fontSize: '0.85rem', cursor: 'pointer' }}>
            <input
              type="checkbox"
              checked={includeWorkLogs}
              onChange={(e) => setIncludeWorkLogs(e.target.checked)}
            />
            Include Logged Hours on Client Report
          </label>
          <label className="flex items-center gap-2" style={{ fontSize: '0.85rem', cursor: 'pointer' }}>
            <input
              type="checkbox"
              checked={includeDiagnosticImages}
              onChange={(e) => setIncludeDiagnosticImages(e.target.checked)}
            />
            Include Diagnostic Photos on Completion Report
          </label>
        </div>
      )}

      {!scheduledDate && isDocAllowed('JOB_SHEET') && (
        <div className="flex items-center gap-2" style={{ padding: '0.5rem 0.75rem', marginBottom: 'var(--space-sm)', backgroundColor: 'var(--status-quoted-bg)', color: 'var(--status-quoted-text)', borderRadius: 'var(--radius-sm)', fontSize: '0.8rem' }}>
          <Lock size={14} />
          Set a <strong>Job Date</strong> in Job Details before generating a Job Sheet.
        </div>
      )}

      {!isDocAllowed('QUOTE') && (
        <div className="flex items-center gap-2" style={{ padding: '0.5rem 0.75rem', marginBottom: 'var(--space-sm)', backgroundColor: '#fef3c7', color: '#92400e', borderRadius: 'var(--radius-sm)', fontSize: '0.8rem' }}>
          <Lock size={14} />
          Diagnostic Report & Job Sheet will be available once job reaches <strong>QUOTED</strong> stage.
          {!isDocAllowed('COMPLETION_REPORT') && <span>Completion Report requires <strong>PENDING INVOICE</strong> stage.</span>}
        </div>
      )}

      {isLoading ? <p>Loading documents...</p> : (
        <table className="dense-table" style={{ fontSize: '0.85rem' }}>
          <thead>
            <tr>
              <th>Type</th>
              <th>For</th>
              <th>Date</th>
              <th>Action</th>
            </tr>
          </thead>
          <tbody>
            {docs.map((doc) => (
              <tr key={doc.id}>
                <td className="font-medium">{doc.type.replace(/_/g, ' ')}</td>
                <td className="text-secondary">
                  {doc.type === 'JOB_SHEET' ? (doc.snapshotData?.contractorName || '—') : '—'}
                </td>
                <td className="tabular-nums">{new Date(doc.createdAt).toLocaleString()}</td>
                <td>
                  <div className="flex gap-2">
                    <button onClick={() => setEditingDoc(doc)} className="button secondary small flex items-center gap-2">
                      <Edit size={12} /> Edit
                    </button>
                    <button onClick={() => handleDocAction(doc.id, 'preview')} className="button secondary small">
                      Preview
                    </button>
                    <button onClick={() => handleDocAction(doc.id, 'download')} className="button secondary small">
                      Download
                    </button>
                    <button
                      onClick={() => handleCopyForEmail(doc.id)}
                      disabled={copyingId === doc.id}
                      className="button secondary small flex items-center gap-2"
                    >
                      <Copy size={12} /> {copyingId === doc.id ? 'Copying...' : 'Copy for Email'}
                    </button>
                  </div>
                </td>
              </tr>
            ))}
            {docs.length === 0 && (
              <tr>
                <td colSpan={4} className="empty-state text-center" style={{ border: 'none' }}>No documents generated yet.</td>
              </tr>
            )}
          </tbody>
        </table>
      )}

      {editingDoc && editingDoc.snapshotData && (
        <DocumentEditModal
          documentId={editingDoc.id}
          documentType={editingDoc.type}
          initialSnapshot={editingDoc.snapshotData}
          onClose={() => setEditingDoc(null)}
          onSaved={() => {
            setEditingDoc(null);
            loadDocs();
          }}
        />
      )}

      {showJobSheetDialog && (
        <div className="modal-backdrop entering" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <div className="modal-panel entering section-card" style={{ width: '440px', maxWidth: '90vw', padding: 0 }}>
            <div className="flex justify-between items-center" style={{ padding: 'var(--space-md)', borderBottom: '1px solid var(--color-border)' }}>
              <h3 style={{ margin: 0, fontSize: '1rem' }}>Generate Job Sheet</h3>
              <button onClick={() => setShowJobSheetDialog(false)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--color-text-secondary)' }}>
                <X size={18} />
              </button>
            </div>
            <div style={{ padding: 'var(--space-md)', display: 'flex', flexDirection: 'column', gap: 'var(--space-sm)' }}>

              <div className="flex" style={{ flexDirection: 'column', gap: 'var(--space-xs)' }}>
                <label className="flex items-center gap-2" style={{ fontSize: '0.85rem', cursor: 'pointer' }}>
                  <input type="checkbox" checked={includeJobSheetHours} onChange={(e) => setIncludeJobSheetHours(e.target.checked)} />
                  Include Hours Logged table
                </label>
                {can('engineer_costs:view') && (
                  <label className="flex items-center gap-2" style={{ fontSize: '0.85rem', cursor: 'pointer' }}>
                    <input
                      type="checkbox"
                      checked={includeJobSheetRates}
                      onChange={(e) => setIncludeJobSheetRates(e.target.checked)}
                      disabled={!includeJobSheetHours}
                    />
                    Include rates / labour cost
                  </label>
                )}
              </div>
              <hr style={{ border: 'none', borderTop: '1px solid var(--color-border)', margin: '0.25rem 0' }} />

              {assignedContractors && assignedContractors.length > 0 && (
                <>
                  <p className="text-secondary" style={{ fontSize: '0.85rem', margin: 0 }}>Select an engineer to generate their individual sheet:</p>
                  {assignedContractors.map((eng) => (
                    <div key={eng.id} className="flex justify-between items-center" style={{ padding: '0.5rem 0.75rem', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-sm)', backgroundColor: 'var(--color-bg)' }}>
                      <span className="font-medium">
                        {eng.name}
                        {jobSheetHoursByEngineer[eng.id] !== undefined && (
                          <span className="text-secondary" style={{ fontWeight: 400, fontSize: '0.8rem' }}> — {Number(jobSheetHoursByEngineer[eng.id]).toFixed(1)} hrs logged</span>
                        )}
                      </span>
                      <button
                        onClick={async () => { setShowJobSheetDialog(false); await generateJobSheet(eng.id); }}
                        className="button secondary small"
                        disabled={isGenerating}
                      >
                        Generate
                      </button>
                    </div>
                  ))}
                  {assignedContractors.length > 1 && (
                    <button
                      onClick={handleGenerateForAll}
                      className="button primary"
                      disabled={isGeneratingMultiple || isGenerating}
                    >
                      {isGeneratingMultiple ? 'Generating…' : `Generate for All (${assignedContractors.length} separate sheets)`}
                    </button>
                  )}
                  <hr style={{ border: 'none', borderTop: '1px solid var(--color-border)', margin: '0.25rem 0' }} />
                </>
              )}

              <p className="text-secondary" style={{ fontSize: '0.85rem', margin: 0 }}>Or generate with a custom / additional name (not tied to a real engineer — hours can't be filtered to them):</p>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={customEngineerName}
                  onChange={(e) => setCustomEngineerName(e.target.value)}
                  placeholder="Engineer name"
                  style={{ flex: 1 }}
                />
                <button
                  onClick={async () => {
                    setShowJobSheetDialog(false);
                    await generateJobSheet(undefined, customEngineerName.trim() || undefined);
                  }}
                  className="button primary"
                  disabled={isGenerating}
                >
                  Generate
                </button>
              </div>
              {!assignedContractors?.length && (
                <p className="text-muted" style={{ fontSize: '0.8rem', margin: 0 }}>
                  No engineers assigned. Assign engineers in Job Details, or type a custom name above.
                </p>
              )}
            </div>
          </div>
        </div>
      )}

      {confirmDialog && confirmDialog.isOpen && (
        <div className="modal-backdrop entering" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <div className="modal-panel entering section-card" style={{ width: '400px', maxWidth: '90vw' }}>
            <h3 style={{ margin: '0 0 var(--space-sm) 0', fontSize: '1rem' }}>Missing Images Warning</h3>
            <p className="text-secondary" style={{ margin: '0 0 var(--space-md) 0', fontSize: '0.85rem', lineHeight: '1.4' }}>
              {confirmDialog.message}
            </p>
            <div className="flex justify-end gap-2">
              <button onClick={() => setConfirmDialog(null)} className="button secondary">Cancel</button>
              <button onClick={confirmDialog.onConfirm} className="button danger">Proceed Without Images</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
