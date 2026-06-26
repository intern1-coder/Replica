import { useState } from 'react';
import { apiFetch } from '../utils/api';
import { X, Save, AlertTriangle } from 'lucide-react';

interface DocumentEditModalProps {
  documentId: string;
  documentType: string;
  initialSnapshot: any;
  onClose: () => void;
  onSaved: () => void;
}

// snapshotData stores dates in two formats: ISO strings (from the DB) and
// human-readable strings like "Monday, 14 July 2025" (from a previous PDF edit).
// These parsers handle both so the date/time inputs are always pre-populated.
function parseSnapshotDate(str: string): string {
  if (!str || str === 'TBD') return '';
  const d = new Date(str);
  if (!isNaN(d.getTime()) && str.includes('T')) {
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }
  const parsed = Date.parse(str);
  if (!isNaN(parsed)) {
    const d2 = new Date(parsed);
    return `${d2.getFullYear()}-${String(d2.getMonth() + 1).padStart(2, '0')}-${String(d2.getDate()).padStart(2, '0')}`;
  }
  return '';
}

function parseSnapshotTime(str: string): string {
  if (!str || str === 'TBD') return '';
  const d = new Date(str);
  if (!isNaN(d.getTime()) && str.includes('T')) {
    return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  }
  const match = str.match(/(\d{1,2}):(\d{2})/);
  if (match) return `${match[1].padStart(2, '0')}:${match[2]}`;
  return '';
}

function formatSnapshotDate(isoDate: string): string {
  if (!isoDate) return 'TBD';
  const d = new Date(`${isoDate}T00:00:00`);
  return d.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
}

function formatSnapshotTime(time: string): string {
  if (!time) return 'TBD';
  const [h, m] = time.split(':');
  const d = new Date();
  d.setHours(parseInt(h, 10), parseInt(m, 10), 0);
  return d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
}

export function DocumentEditModal({ documentId, documentType, initialSnapshot, onClose, onSaved }: DocumentEditModalProps) {
  const isJobSheet = documentType === 'JOB_SHEET';

  const [snapshot, setSnapshot] = useState<any>(() => {
    const clean = { ...initialSnapshot };
    // Images are base64 blobs — strip them from editable state to keep the form
    // lightweight; they are re-attached from initialSnapshot on save.
    delete clean.diagnosticImages;
    delete clean.completionImages;
    if (isJobSheet) clean.status = 'AUTHORISED';
    return clean;
  });

  const [dateInput, setDateInput] = useState(() => parseSnapshotDate(initialSnapshot.scheduledDate || ''));
  const [timeInput, setTimeInput] = useState(() => parseSnapshotTime(initialSnapshot.scheduledTime || initialSnapshot.scheduledDate || ''));

  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState('');

  const handleSave = async () => {
    setIsSaving(true);
    setError('');

    try {
      const payload = { ...snapshot };
      if ('scheduledDate' in payload || 'scheduledTime' in payload) {
        payload.scheduledDate = dateInput ? formatSnapshotDate(dateInput) : 'TBD';
        payload.scheduledTime = timeInput ? formatSnapshotTime(timeInput) : 'TBD';
      }
      if (isJobSheet) payload.status = 'AUTHORISED';

      if (initialSnapshot.diagnosticImages) payload.diagnosticImages = initialSnapshot.diagnosticImages;
      if (initialSnapshot.completionImages) payload.completionImages = initialSnapshot.completionImages;

      await apiFetch(`/documents/${documentId}`, {
        method: 'PATCH',
        body: JSON.stringify({ snapshotData: payload }),
      });

      onSaved();
    } catch (err: any) {
      setError('Failed to save: ' + err.message);
    } finally {
      setIsSaving(false);
    }
  };

  const handleFieldChange = (key: string, value: string) => {
    setSnapshot((prev: any) => ({ ...prev, [key]: value }));
  };

  const handleArrayChange = (arrayKey: string, index: number, subKey: string, value: string) => {
    setSnapshot((prev: any) => {
      const newArray = [...prev[arrayKey]];
      newArray[index] = { ...newArray[index], [subKey]: value };
      return { ...prev, [arrayKey]: newArray };
    });
  };

  const renderInput = (key: string, value: any, onChange: (val: string) => void) => {
    if (key === 'status' && isJobSheet) {
      return <input type="text" value="AUTHORISED" readOnly style={{ width: '100%', padding: '0.4rem', borderRadius: 'var(--radius-sm)', border: '1px solid var(--color-border)', backgroundColor: 'var(--color-bg)' }} />;
    }
    if (key === 'scheduledDate') {
      return (
        <input
          type="date"
          value={dateInput}
          onChange={(e) => setDateInput(e.target.value)}
          style={{ width: '100%', padding: '0.4rem', borderRadius: 'var(--radius-sm)', border: '1px solid var(--color-border)' }}
        />
      );
    }
    if (key === 'scheduledTime') {
      return (
        <input
          type="time"
          value={timeInput}
          onChange={(e) => setTimeInput(e.target.value)}
          style={{ width: '100%', padding: '0.4rem', borderRadius: 'var(--radius-sm)', border: '1px solid var(--color-border)' }}
        />
      );
    }
    const isLongText = typeof value === 'string' && value.length > 40;
    if (isLongText || key.toLowerCase().includes('description') || key.toLowerCase().includes('notes')) {
      return (
        <textarea
          value={value || ''}
          onChange={(e) => onChange(e.target.value)}
          style={{ width: '100%', padding: '0.4rem', borderRadius: 'var(--radius-sm)', border: '1px solid var(--color-border)', minHeight: '60px' }}
        />
      );
    }
    return (
      <input
        type="text"
        value={value || ''}
        onChange={(e) => onChange(e.target.value)}
        style={{ width: '100%', padding: '0.4rem', borderRadius: 'var(--radius-sm)', border: '1px solid var(--color-border)' }}
      />
    );
  };

  return (
    <div className="modal-backdrop entering" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div className="modal-panel entering section-card" style={{ width: '600px', maxWidth: '90vw', maxHeight: '90vh', display: 'flex', flexDirection: 'column', padding: 0 }}>
        <div className="flex justify-between items-center" style={{ padding: 'var(--space-md)', borderBottom: '1px solid var(--color-border)' }}>
          <h2 style={{ margin: 0, fontSize: '1.1rem' }}>Edit {documentType.replace(/_/g, ' ')}</h2>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--color-text-secondary)' }}><X size={20} /></button>
        </div>

        <div style={{ padding: 'var(--space-md)', overflowY: 'auto', flex: 1 }}>
          <div className="flex items-start gap-2" style={{ padding: '0.75rem', backgroundColor: 'var(--status-quoted-bg)', color: 'var(--status-quoted-text)', borderRadius: 'var(--radius-sm)', border: '1px solid var(--status-quoted-border)', marginBottom: 'var(--space-md)', fontSize: '0.85rem', lineHeight: '1.4' }}>
            <AlertTriangle size={18} style={{ flexShrink: 0, marginTop: '2px' }} />
            <div>
              <strong>Note:</strong> Changes here update the PDF only. Update Job Details for database records to stay in sync.
            </div>
          </div>

          {error && <div className="page-error">{error}</div>}

          <div className="flex" style={{ flexDirection: 'column', gap: 'var(--space-md)' }}>
            {Object.entries(snapshot).map(([key, value]) => {
              if (Array.isArray(value)) {
                return (
                  <div key={key} style={{ padding: 'var(--space-sm)', backgroundColor: 'var(--color-bg)', borderRadius: 'var(--radius-sm)' }}>
                    <h4 style={{ margin: '0 0 var(--space-sm) 0' }}>{key.replace(/([A-Z])/g, ' $1').trim()}</h4>
                    {value.map((item, index) => (
                      <div key={index} className="section-card" style={{ padding: 'var(--space-sm)', marginBottom: 'var(--space-sm)' }}>
                        <div className="font-medium text-secondary" style={{ fontSize: '0.75rem', marginBottom: 'var(--space-xs)' }}>Item {index + 1}</div>
                        <div style={{ display: 'grid', gap: 'var(--space-sm)', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))' }}>
                          {Object.entries(item).map(([subKey, subVal]) => (
                            <div key={subKey}>
                              <label className="form-label">{subKey}</label>
                              {renderInput(subKey, subVal, (val) => handleArrayChange(key, index, subKey, val))}
                            </div>
                          ))}
                        </div>
                      </div>
                    ))}
                    {value.length === 0 && <span className="text-muted" style={{ fontSize: '0.8rem' }}>No items.</span>}
                  </div>
                );
              }

              return (
                <div key={key}>
                  <label className="form-label">{key.replace(/([A-Z])/g, ' $1').trim()}</label>
                  {renderInput(key, value, (val) => handleFieldChange(key, val))}
                </div>
              );
            })}
          </div>
        </div>

        <div className="flex justify-end gap-2" style={{ padding: 'var(--space-md)', borderTop: '1px solid var(--color-border)' }}>
          <button onClick={onClose} className="button secondary" disabled={isSaving}>Cancel</button>
          <button onClick={handleSave} className="button primary flex items-center gap-2" disabled={isSaving}>
            <Save size={16} />
            {isSaving ? 'Regenerating...' : 'Save & Regenerate'}
          </button>
        </div>
      </div>
    </div>
  );
}
