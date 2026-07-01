import { useState, useEffect } from 'react';
import { apiFetch } from '../utils/api';
import { FileText, Lock, Edit, X } from 'lucide-react';
import { DocumentEditModal } from './DocumentEditModal';
import { useToast } from '../contexts/ToastContext';

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
    allowed: ['QUOTED', 'AUTHORISED', 'COMPLETED'],
    message: 'Quote Report can only be generated once the job reaches QUOTED stage.',
  },
  JOB_SHEET: {
    allowed: ['AUTHORISED', 'COMPLETED'],
    message: 'Job Sheet can only be generated once the job reaches AUTHORISED stage.',
  },
  COMPLETION_REPORT: {
    allowed: ['COMPLETED'],
    message: 'Completion Report can only be generated once the job is marked COMPLETED.',
  },
};

interface Engineer {
  id: string;
  name: string;
}

export function JobDocuments({ jobId, jobStatus, scheduledDate, assignedContractors }: { jobId: string; jobStatus: string; scheduledDate?: string | null; assignedContractors?: Engineer[] }) {
  const { showToast } = useToast();
  const [docs, setDocs] = useState<GeneratedDocument[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isGenerating, setIsGenerating] = useState(false);
  const [error, setError] = useState('');

  const [editingDoc, setEditingDoc] = useState<GeneratedDocument | null>(null);
  const [confirmDialog, setConfirmDialog] = useState<{isOpen: boolean, message: string, onConfirm: () => void} | null>(null);

  // Job Sheet chooser dialog
  const [showJobSheetDialog, setShowJobSheetDialog] = useState(false);
  const [customEngineerName, setCustomEngineerName] = useState('');
  const [isGeneratingMultiple, setIsGeneratingMultiple] = useState(false);

  useEffect(() => {
    loadDocs();
  }, [jobId]);

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

  const generateJobSheet = async (engineerName?: string) => {
    setIsGenerating(true);
    setError('');
    try {
      const newDoc = await apiFetch('/documents/job-sheet', {
        method: 'POST',
        body: JSON.stringify({ jobId, engineerName: engineerName || undefined }),
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
          body: JSON.stringify({ jobId, engineerName: eng.name }),
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
            message: "You haven't uploaded any Diagnostic Photos for this job. Are you sure you want to generate the Quote without images?",
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
        body: JSON.stringify({ jobId })
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
        a.download = '';
        a.click();
      } else {
        window.open(response.url, '_blank');
      }
    } catch (err) {
      showToast('Failed to get document URL', 'error');
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
        {renderButton('QUOTE', 'Generate Quote', 'doc-btn-quote')}
        {renderButton('JOB_SHEET', 'Generate Job Sheet', 'doc-btn-jobsheet')}
        {renderButton('COMPLETION_REPORT', 'Generate Completion Report', 'doc-btn-completion')}
        {isGenerating && <span className="flex items-center text-secondary" style={{ fontSize: '0.85rem' }}>Generating PDF...</span>}
      </div>

      {!scheduledDate && isDocAllowed('JOB_SHEET') && (
        <div className="flex items-center gap-2" style={{ padding: '0.5rem 0.75rem', marginBottom: 'var(--space-sm)', backgroundColor: 'var(--status-quoted-bg)', color: 'var(--status-quoted-text)', borderRadius: 'var(--radius-sm)', fontSize: '0.8rem' }}>
          <Lock size={14} />
          Set a <strong>Job Date</strong> in Job Details before generating a Job Sheet.
        </div>
      )}

      {!isDocAllowed('QUOTE') && (
        <div className="flex items-center gap-2" style={{ padding: '0.5rem 0.75rem', marginBottom: 'var(--space-sm)', backgroundColor: '#fef3c7', color: '#92400e', borderRadius: 'var(--radius-sm)', fontSize: '0.8rem' }}>
          <Lock size={14} />
          Quote & Job Sheet will be available once job reaches <strong>QUOTED</strong> stage.
          {jobStatus !== 'COMPLETED' && <span>Completion Report requires <strong>COMPLETED</strong> stage.</span>}
        </div>
      )}

      {isLoading ? <p>Loading documents...</p> : (
        <table className="dense-table" style={{ fontSize: '0.85rem' }}>
          <thead>
            <tr>
              <th>Type</th>
              <th>Date</th>
              <th>Action</th>
            </tr>
          </thead>
          <tbody>
            {docs.map((doc) => (
              <tr key={doc.id}>
                <td className="font-medium">{doc.type.replace(/_/g, ' ')}</td>
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
                  </div>
                </td>
              </tr>
            ))}
            {docs.length === 0 && (
              <tr>
                <td colSpan={3} className="empty-state text-center" style={{ border: 'none' }}>No documents generated yet.</td>
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

              {assignedContractors && assignedContractors.length > 0 && (
                <>
                  <p className="text-secondary" style={{ fontSize: '0.85rem', margin: 0 }}>Select an engineer to generate their individual sheet:</p>
                  {assignedContractors.map((eng) => (
                    <div key={eng.id} className="flex justify-between items-center" style={{ padding: '0.5rem 0.75rem', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-sm)', backgroundColor: 'var(--color-bg)' }}>
                      <span className="font-medium">{eng.name}</span>
                      <button
                        onClick={async () => { setShowJobSheetDialog(false); await generateJobSheet(eng.name); }}
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

              <p className="text-secondary" style={{ fontSize: '0.85rem', margin: 0 }}>Or generate with a custom / additional name:</p>
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
                    await generateJobSheet(customEngineerName.trim() || undefined);
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
