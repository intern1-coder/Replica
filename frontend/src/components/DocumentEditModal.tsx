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

export function DocumentEditModal({ documentId, documentType, initialSnapshot, onClose, onSaved }: DocumentEditModalProps) {
  const [snapshot, setSnapshot] = useState<any>(() => {
    // Strip out base64 images from the editable state
    const clean = { ...initialSnapshot };
    delete clean.diagnosticImages;
    delete clean.completionImages;
    return clean;
  });
  
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState('');

  const handleSave = async () => {
    setIsSaving(true);
    setError('');
    
    try {
      const payload = { ...snapshot };
      
      // Re-inject the images from the initial snapshot so we don't lose them
      if (initialSnapshot.diagnosticImages) payload.diagnosticImages = initialSnapshot.diagnosticImages;
      if (initialSnapshot.completionImages) payload.completionImages = initialSnapshot.completionImages;

      await apiFetch(`/documents/${documentId}`, {
        method: 'PATCH',
        body: JSON.stringify({ snapshotData: payload })
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
      <div className="modal-panel entering section-card" style={{ 
        width: '600px', 
        maxWidth: '90vw',
        maxHeight: '90vh', 
        display: 'flex', 
        flexDirection: 'column',
        padding: 0
      }}>
        <div className="flex justify-between items-center" style={{ padding: 'var(--space-md)', borderBottom: '1px solid var(--color-border)' }}>
          <h2 style={{ margin: 0, fontSize: '1.1rem' }}>Edit {documentType.replace(/_/g, ' ')}</h2>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--color-text-secondary)' }}><X size={20} /></button>
        </div>
        
        <div style={{ padding: 'var(--space-md)', overflowY: 'auto', flex: 1 }}>
          <div className="flex items-start gap-2" style={{ padding: '0.75rem', backgroundColor: '#fef2f2', color: '#991b1b', borderRadius: 'var(--radius-sm)', border: '1px solid #f87171', marginBottom: 'var(--space-md)', fontSize: '0.85rem', lineHeight: '1.4' }}>
            <AlertTriangle size={18} style={{ flexShrink: 0, marginTop: '2px' }} />
            <div>
              <strong>IMPORTANT:</strong> Editing this data will <strong>ONLY</strong> update the PDF document. It will <strong>NOT</strong> update your main database records (like Job details, line items, or client info). Please ensure you also update the main records to keep everything in sync!
            </div>
          </div>
          
          <p className="text-secondary" style={{ fontSize: '0.85rem', marginBottom: 'var(--space-md)' }}>
            Modify the fields below to correct any mistakes on the PDF.
          </p>
          
          {error && <div className="page-error">{error}</div>}
          
          <div className="flex" style={{ flexDirection: 'column', gap: 'var(--space-md)' }}>
            {Object.entries(snapshot).map(([key, value]) => {
              // Handle Arrays (like line items or work logs)
              if (Array.isArray(value)) {
                return (
                  <div key={key} style={{ padding: 'var(--space-sm)', backgroundColor: 'var(--color-bg)', borderRadius: 'var(--radius-sm)' }}>
                    <h4 style={{ margin: '0 0 var(--space-sm) 0', textTransform: 'capitalize' }}>{key.replace(/([A-Z])/g, ' $1').trim()}</h4>
                    {value.map((item, index) => (
                      <div key={index} className="section-card" style={{ padding: 'var(--space-sm)', marginBottom: 'var(--space-sm)' }}>
                        <div className="font-medium text-secondary" style={{ fontSize: '0.75rem', marginBottom: 'var(--space-xs)' }}>Item {index + 1}</div>
                        <div style={{ display: 'grid', gap: 'var(--space-sm)', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))' }}>
                          {Object.entries(item).map(([subKey, subVal]) => (
                            <div key={subKey}>
                              <label className="form-label" style={{ textTransform: 'capitalize' }}>{subKey}</label>
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

              // Handle simple string/number fields
              return (
                <div key={key}>
                  <label className="form-label" style={{ textTransform: 'capitalize' }}>
                    {key.replace(/([A-Z])/g, ' $1').trim()}
                  </label>
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
