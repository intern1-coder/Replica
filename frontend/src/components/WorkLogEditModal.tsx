import { useEffect, useState } from 'react';
import { apiFetch } from '../utils/api';
import { X } from 'lucide-react';

interface EditableWorkLog {
  id: string;
  workDate: string;
  hoursWorked: string | number;
  rateApplied?: string | number; // omitted server-side for callers without engineer_costs:view
  materialCost?: string | number | null;
  notes: string | null;
  contractor?: { id: string; name: string };
}

interface WorkLogEditModalProps {
  log: EditableWorkLog;
  onClose: () => void;
  onSaved: (updated: any) => void;
}

/**
 * Editing a work log is deliberately a separate component from the "Add Log"
 * form (JobWorkLogs.tsx) — a single shared form + `editingLogId` flag was the
 * root cause of edits silently overwriting a different log when a user meant
 * to add a second entry. This modal owns its own state, tied to one specific
 * log passed in by the caller, so there is no shared flag that can leak.
 *
 * Contractor and rate are read-only: both are frozen at log-creation time
 * (Rules.md) and the backend rejects any PATCH that includes rateApplied.
 * The only way to correct a rate is delete + re-add, which this modal's
 * hint text says explicitly.
 */
export function WorkLogEditModal({ log, onClose, onSaved }: WorkLogEditModalProps) {
  const [workDate, setWorkDate] = useState(log.workDate.split('T')[0]);
  const [hoursWorked, setHoursWorked] = useState<number | ''>(Number(log.hoursWorked));
  const [materialCost, setMaterialCost] = useState<number | ''>(
    log.materialCost !== undefined && log.materialCost !== null ? Number(log.materialCost) : ''
  );
  const [notes, setNotes] = useState(log.notes || '');
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSaving(true);
    setError('');
    try {
      const updated = await apiFetch(`/work-logs/${log.id}`, {
        method: 'PATCH',
        body: JSON.stringify({
          workDate: new Date(workDate).toISOString(),
          hoursWorked: String(hoursWorked),
          materialCost: materialCost !== '' ? String(materialCost) : '0',
          notes: notes || null,
        }),
      });
      onSaved(updated);
      onClose();
    } catch (err: any) {
      setError(err.message || 'Failed to update log');
    } finally {
      setIsSaving(false);
    }
  };

  const dateLabel = new Date(`${workDate}T00:00:00`).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });

  return (
    <div className="modal-backdrop entering" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div className="modal-panel entering section-card" style={{ width: '480px', maxWidth: '90vw', padding: 0 }}>
        <div className="flex justify-between items-center" style={{ padding: 'var(--space-md)', borderBottom: '1px solid var(--color-border)' }}>
          <h3 style={{ margin: 0, fontSize: '1rem' }}>
            Editing log — {log.contractor?.name || 'Unknown'}, {dateLabel}
          </h3>
          <button onClick={onClose} type="button" style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--color-text-secondary)' }}>
            <X size={18} />
          </button>
        </div>
        <form onSubmit={handleSave}>
          <div style={{ padding: 'var(--space-md)', display: 'flex', flexDirection: 'column', gap: 'var(--space-sm)' }}>
            {error && <div className="page-error">{error}</div>}

            <div className="form-grid-2">
              <div>
                <label className="form-label">Contractor</label>
                <input type="text" value={log.contractor?.name || 'Unknown'} readOnly disabled />
              </div>
              {log.rateApplied !== undefined && (
                <div>
                  <label className="form-label">Rate (£)</label>
                  <input type="text" value={Number(log.rateApplied).toFixed(2)} readOnly disabled />
                </div>
              )}
            </div>
            {log.rateApplied !== undefined && (
              <p className="text-secondary" style={{ fontSize: '0.8rem', margin: 0 }}>
                Rate frozen at £{Number(log.rateApplied).toFixed(2)} when this log was created. Delete this log and re-add it to correct the rate.
              </p>
            )}

            <div className="form-row">
              <label className="form-label">Date *</label>
              <input type="date" value={workDate} onChange={(e) => setWorkDate(e.target.value)} required />
            </div>
            <div className="form-row">
              <label className="form-label">Hours *</label>
              <input
                type="number"
                step="0.5"
                min="0.5"
                max="24"
                value={hoursWorked}
                onChange={(e) => setHoursWorked(e.target.value ? Number(e.target.value) : '')}
                required
              />
            </div>
            <div className="form-row">
              <label className="form-label">Materials (£)</label>
              <input
                type="number"
                step="0.01"
                min="0"
                value={materialCost}
                onChange={(e) => setMaterialCost(e.target.value ? Number(e.target.value) : '')}
                placeholder="0.00"
              />
            </div>
            <div className="form-row">
              <label className="form-label">Notes</label>
              <input type="text" value={notes} onChange={(e) => setNotes(e.target.value)} />
            </div>
          </div>
          <div className="flex justify-end gap-2" style={{ padding: 'var(--space-md)', borderTop: '1px solid var(--color-border)' }}>
            <button type="button" onClick={onClose} className="button secondary" disabled={isSaving}>Cancel</button>
            <button type="submit" className="button primary" disabled={isSaving}>{isSaving ? 'Saving...' : 'Save'}</button>
          </div>
        </form>
      </div>
    </div>
  );
}
